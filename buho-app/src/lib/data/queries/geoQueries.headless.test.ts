// @vitest-environment node
//
// Headless test of the zone ROLLUP SQL. DuckDB-WASM's worker bundle can't run in
// JSDOM, but `duckdb-node-blocking` runs the same wasm core synchronously in Node,
// so the exact SQL from geoQueries.ts is exercised against the real engine — the
// only way to prove that ROLLUP + GROUPING() + COUNT(DISTINCT) behave as assumed.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';
import { ZONE_ROLLUP_SQL } from './geoQueries';
import {
    buildZoneRollup,
    zoneKey,
    normalizePath,
    MASK_FOR_DEPTH,
    TOTAL_MASK,
    type ZoneRollupRow,
} from '$lib/visualizations/zoneChoropleth';

const require = createRequire(import.meta.url);
const DIST = path.resolve(process.cwd(), 'node_modules/@duckdb/duckdb-wasm/dist');
const duckdb = require(path.join(DIST, 'duckdb-node-blocking.cjs'));
const BUNDLES = {
    mvp: { mainModule: path.join(DIST, 'duckdb-mvp.wasm'), mainWorker: null },
    eh: { mainModule: path.join(DIST, 'duckdb-eh.wasm'), mainWorker: null },
};

let db: any;
let conn: any;
let rows: ZoneRollupRow[];

/** Mirrors db.ts's camelCase mapping of result columns. */
const camel = (s: string) => s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());

beforeAll(async () => {
    db = await duckdb.createDuckDB(BUNDLES, new duckdb.VoidLogger(), duckdb.NODE_RUNTIME);
    await db.instantiate(() => {});
    conn = db.connect();

    // The rollup excludes seas by name against the ocean layer of geo_zones, which
    // loadGeoAssets always populates before this query can run.
    conn.query(`CREATE TABLE geo_zones (level VARCHAR, country VARCHAR)`);
    conn.query(`INSERT INTO geo_zones VALUES
        ('ocean', 'North Atlantic Ocean'), ('ocean', 'Arctic Ocean'),
        ('region', 'France')`);

    conn.query(`CREATE TABLE google_maps_segments (
        duration_seconds DOUBLE, distance_meters DOUBLE, country VARCHAR,
        region VARCHAR, department VARCHAR, arrondissement VARCHAR)`);

    // Two French arrondissements under one department, a French department with no
    // arrondissement, a non-FR region with no department, a sea, an unattributed
    // row, an unparented territory (Gibraltar), and a country repeating its region.
    conn.query(`INSERT INTO google_maps_segments VALUES
        (3600, 1000, 'France', 'Île-de-France', 'Paris', 'Paris 4e'),
        (1800, 500, 'France', 'Île-de-France', 'Paris', 'Paris 5e'),
        (7200, 2000, 'France', 'Île-de-France', 'Paris', 'Paris 4e'),
        (3600, 40000, 'France', 'Auvergne-Rhône-Alpes', 'Rhône', NULL),
        (10800, 1500, 'Spain', 'Comunidad de Madrid', NULL, NULL),
        (5400, 800000, 'North Atlantic Ocean', NULL, NULL, NULL),
        (900, 100, NULL, NULL, NULL, NULL),
        (3600, 300, NULL, 'Gibraltar', NULL, NULL),
        (1800, 200, 'Singapore', 'Singapore', NULL, NULL)`);

    rows = conn
        .query(ZONE_ROLLUP_SQL)
        .toArray()
        .map((r: any) => {
            const o = r.toJSON();
            return Object.fromEntries(
                Object.entries(o).map(([k, v]) => [camel(k), typeof v === 'bigint' ? Number(v) : v]),
            );
        }) as ZoneRollupRow[];
});

afterAll(() => {
    conn?.close();
    db?.terminate?.();
});

const at = (mask: number, p: Partial<Record<string, string | null>>) =>
    rows.find(
        (r) =>
            r.depthMask === mask &&
            r.country === (p.country ?? null) &&
            r.region === (p.region ?? null) &&
            r.department === (p.department ?? null) &&
            r.arrondissement === (p.arrondissement ?? null),
    );

describe('ZONE_ROLLUP_SQL', () => {
    it('returns numbers, not BigInt, for the CAST aggregates', () => {
        // db.ts does no BigInt coercion, so the CASTs in the SQL are what make the
        // rows usable; a regression here would surface as 0s in the UI.
        for (const r of rows) {
            expect(typeof r.depthMask).toBe('number');
            expect(typeof r.hours).toBe('number');
            expect(typeof r.km).toBe('number');
            expect(typeof r.points).toBe('number');
        }
    });

    it('emits one row per depth via the GROUPING bitmask', () => {
        expect(at(MASK_FOR_DEPTH[1], { country: 'France' })).toBeDefined();
        expect(at(MASK_FOR_DEPTH[2], { country: 'France', region: 'Île-de-France' })).toBeDefined();
        expect(
            at(MASK_FOR_DEPTH[3], { country: 'France', region: 'Île-de-France', department: 'Paris' }),
        ).toBeDefined();
        expect(
            at(MASK_FOR_DEPTH[4], {
                country: 'France',
                region: 'Île-de-France',
                department: 'Paris',
                arrondissement: 'Paris 4e',
            }),
        ).toBeDefined();
        expect(rows.filter((r) => r.depthMask === TOTAL_MASK)).toHaveLength(1);
    });

    it('sums hours correctly up the hierarchy', () => {
        // Paris: 1h + 0.5h + 2h; Île-de-France = Paris; France = +1h for Rhône.
        expect(
            at(MASK_FOR_DEPTH[3], { country: 'France', region: 'Île-de-France', department: 'Paris' })
                ?.hours,
        ).toBeCloseTo(3.5);
        expect(at(MASK_FOR_DEPTH[1], { country: 'France' })?.hours).toBeCloseTo(4.5);
    });

    it('sums km and counts points up the hierarchy', () => {
        // The Explorer's three measures: time, km, points.
        const paris = at(MASK_FOR_DEPTH[3], {
            country: 'France',
            region: 'Île-de-France',
            department: 'Paris',
        });
        expect(paris?.km).toBeCloseTo(3.5); // 1000 + 500 + 2000 m
        expect(paris?.points).toBe(3);

        const france = at(MASK_FOR_DEPTH[1], { country: 'France' });
        expect(france?.km).toBeCloseTo(43.5); // + the 40 km Rhône leg
        expect(france?.points).toBe(4);
    });

    it('excludes rows with no attributed zone at all', () => {
        // The 2024-01-05 segment (900s, everything NULL) must not reach the total,
        // while Gibraltar (1h, country NULL but region set) must.
        const total = rows.find((r) => r.depthMask === TOTAL_MASK)!;
        expect(total.hours).toBeCloseTo(4.5 + 3 + 1 + 0.5);
        expect(total.points).toBe(7); // 9 rows, minus the sea and the unattributed
        expect(rows.some((r) => r.country === null && r.depthMask !== TOTAL_MASK)).toBe(false);
    });

    it('mirrors normalizePath: country falls back to region, and repeats collapse', () => {
        // These two rows are the SQL half of the contract with normalizePath — if the
        // CTE and that function ever drift, the polygons stop joining the aggregates.
        const gib = at(MASK_FOR_DEPTH[1], { country: 'Gibraltar' });
        expect(gib?.hours).toBeCloseTo(1);
        // Collapsed, so it never appears as a region under itself.
        expect(at(MASK_FOR_DEPTH[2], { country: 'Gibraltar', region: 'Gibraltar' })).toBeUndefined();

        const sg = at(MASK_FOR_DEPTH[1], { country: 'Singapore' });
        expect(sg?.hours).toBeCloseTo(0.5);
        expect(at(MASK_FOR_DEPTH[2], { country: 'Singapore', region: 'Singapore' })).toBeUndefined();
    });

    it('drops sea rows entirely', () => {
        // A sea is not an administrative zone, and its area would dominate the map.
        expect(at(MASK_FOR_DEPTH[1], { country: 'North Atlantic Ocean' })).toBeUndefined();
        expect(rows.some((r) => r.country === 'North Atlantic Ocean')).toBe(false);
    });
});

describe('buildZoneRollup over real engine output', () => {
    it('indexes every depth, with the shallow-hierarchy fallback', () => {
        const { byDepth, total } = buildZoneRollup(rows);
        const p = (o: Partial<Record<string, string | null>>) => ({
            country: o.country ?? null,
            region: o.region ?? null,
            department: o.department ?? null,
            arrondissement: o.arrondissement ?? null,
        });

        expect(byDepth[1].get(zoneKey(p({ country: 'France' }), 1))?.hours).toBeCloseTo(4.5);
        expect(total?.hours).toBeCloseTo(9);

        // The engine's normalized l1 and normalizePath agree on the same key, which
        // is what lets a Gibraltar polygon find its aggregate.
        expect(byDepth[1].get(zoneKey(normalizePath({ region: 'Gibraltar' }), 1))?.hours)
            .toBeCloseTo(1);

        // Spain has no department, so its depth-3 and depth-4 keys collapse onto the
        // region — and both must resolve to the same aggregate.
        const madrid = p({ country: 'Spain', region: 'Comunidad de Madrid' });
        const k2 = zoneKey(madrid, 2);
        expect(zoneKey(madrid, 3)).toBe(k2);
        expect(byDepth[3].get(k2)?.hours).toBeCloseTo(3);
        expect(byDepth[4].get(k2)?.hours).toBeCloseTo(3);
        expect(byDepth[2].get(k2)?.hours).toBeCloseTo(3);
    });
});
