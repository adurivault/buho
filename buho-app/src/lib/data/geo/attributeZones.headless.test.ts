// @vitest-environment node
//
// Headless end-to-end test of the geo-attribution SQL. DuckDB-WASM's worker
// bundle can't run in JSDOM, but the `duckdb-node-blocking` bundle runs the same
// wasm core (+ the real `spatial` extension) synchronously in Node. We feed a
// synthetic "leaf" geo_zones layer + cities + user points and assert the exact
// SQL from attributionSql.ts (shared with the runtime) attributes them correctly.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';
import { ATTRIBUTION_STATEMENTS } from './attributionSql';

const require = createRequire(import.meta.url);
const DIST = path.resolve(process.cwd(), 'node_modules/@duckdb/duckdb-wasm/dist');
const duckdb = require(path.join(DIST, 'duckdb-node-blocking.cjs'));
const BUNDLES = {
    mvp: { mainModule: path.join(DIST, 'duckdb-mvp.wasm'), mainWorker: null },
    eh: { mainModule: path.join(DIST, 'duckdb-eh.wasm'), mainWorker: null },
};

let db: any;
let conn: any;
const q = (sql: string) => conn.query(sql).toArray().map((r: any) => r.toJSON());

beforeAll(async () => {
    db = await duckdb.createDuckDB(BUNDLES, new duckdb.VoidLogger(), duckdb.NODE_RUNTIME);
    await db.instantiate(() => {});
    conn = db.connect();
    conn.query('LOAD spatial');

    // Leaf layer: each polygon = finest unit, hierarchy in columns. A Paris
    // arrondissement leaf, a Rhône department leaf, a Madrid region leaf, a rural
    // FR department leaf, and one ocean leaf.
    conn.query(`CREATE TABLE geo_zones (level VARCHAR, country_code VARCHAR, country VARCHAR,
        region VARCHAR, department VARCHAR, arrondissement VARCHAR, geom GEOMETRY)`);
    conn.query(`INSERT INTO geo_zones VALUES
      ('arrondissement','FRA','France','Île-de-France','Paris','Paris 4e Arrondissement',
        ST_GeomFromText('POLYGON((2.2 48.8, 2.5 48.8, 2.5 48.9, 2.2 48.9, 2.2 48.8))')),
      ('department','FRA','France','Auvergne-Rhône-Alpes','Rhône',NULL,
        ST_GeomFromText('POLYGON((4.7 45.7, 5.0 45.7, 5.0 45.9, 4.7 45.9, 4.7 45.7))')),
      ('department','FRA','France','Occitanie','Tarn-et-Garonne',NULL,
        ST_GeomFromText('POLYGON((0.5 43.5, 1.5 43.5, 1.5 44.5, 0.5 44.5, 0.5 43.5))')),
      ('region','ESP','Spain','Madrid',NULL,NULL,
        ST_GeomFromText('POLYGON((-4 40, -3 40, -3 41, -4 41, -4 40))')),
      ('ocean','OCEAN','Test Sea',NULL,NULL,NULL,
        ST_GeomFromText('POLYGON((-1 -1, 0 -1, 0 0, -1 0, -1 -1))'))`);

    conn.query(`CREATE TABLE geo_cities (name VARCHAR, country_code VARCHAR, population INTEGER, geom GEOMETRY)`);
    conn.query(`INSERT INTO geo_cities VALUES
      ('Paris','FRA',2100000, ST_Point(2.3522,48.8566)),
      ('Lyon','FRA',500000,  ST_Point(4.8400,45.7600)),
      ('Madrid','ESP',3200000, ST_Point(-3.7038,40.4168))`);

    conn.query(`CREATE TABLE google_maps_segments (lat DOUBLE, lon DOUBLE, place_id VARCHAR, label VARCHAR)`);
    conn.query(`INSERT INTO google_maps_segments VALUES
      (48.8566, 2.3522, 'p1', 'paris'),
      (45.7600, 4.8400, 'p2', 'lyon'),
      (40.4168,-3.7038, 'p3', 'madrid'),
      (40.5000,-2.9700, NULL, 'coastal'),
      (-0.5000,-0.5000, NULL, 'ocean'),
      (44.0000, 1.0000, NULL, 'rural'),
      (60.0000,60.0000, NULL, 'nowhere')`);

    for (const sql of ATTRIBUTION_STATEMENTS) conn.query(sql);
});

afterAll(() => {
    conn?.close();
});

function row(label: string) {
    return q(`SELECT * FROM google_maps_segments WHERE label = '${label}'`)[0];
}

describe('geo attribution (headless DuckDB spatial, leaf model)', () => {
    it('reads the full hierarchy from an arrondissement leaf', () => {
        const r = row('paris');
        expect(r.country).toBe('France');
        expect(r.region).toBe('Île-de-France');
        expect(r.department).toBe('Paris');
        expect(r.arrondissement).toBe('Paris 4e Arrondissement');
        expect(r.nearest_city).toBe('Paris');
    });

    it('reads a department leaf (no arrondissement)', () => {
        const r = row('lyon');
        expect(r.country).toBe('France');
        expect(r.region).toBe('Auvergne-Rhône-Alpes');
        expect(r.department).toBe('Rhône');
        expect(r.arrondissement).toBeNull();
        expect(r.nearest_city).toBe('Lyon');
    });

    it('reads a foreign region leaf (department null)', () => {
        const r = row('madrid');
        expect(r.country).toBe('Spain');
        expect(r.region).toBe('Madrid');
        expect(r.department).toBeNull();
        expect(r.nearest_city).toBe('Madrid');
    });

    it('coastal buffer: a point just offshore inherits the nearest leaf', () => {
        const r = row('coastal');
        expect(r.country).toBe('Spain');
        expect(r.region).toBe('Madrid');
    });

    it('ocean fallback: country = sea name, no region', () => {
        const r = row('ocean');
        expect(r.country).toBe('Test Sea');
        expect(r.region).toBeNull();
        expect(r.nearest_city).toBeNull();
    });

    it('applies the 30 km guard: rural FR gets the zone but no city', () => {
        const r = row('rural');
        expect(r.country).toBe('France');
        expect(r.department).toBe('Tarn-et-Garonne');
        expect(r.nearest_city).toBeNull();
    });

    it('leaves a point in no leaf fully null', () => {
        const r = row('nowhere');
        expect(r.country).toBeNull();
        expect(r.nearest_city).toBeNull();
    });

    it('keeps original lat/lon intact (rounding is only a join key)', () => {
        const r = row('paris');
        expect(r.lat).toBe(48.8566);
        expect(r.lon).toBe(2.3522);
    });
});
