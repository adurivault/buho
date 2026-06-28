// @vitest-environment node
//
// Headless end-to-end test of the geo-attribution SQL. DuckDB-WASM's worker
// bundle can't run in JSDOM, but the `duckdb-node-blocking` bundle runs the same
// wasm core (+ the real `spatial` extension) synchronously in Node. We feed
// synthetic reference zones/cities + user points and assert the exact SQL from
// attributionSql.ts (shared with the runtime) attributes them correctly.
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

    // Reference zones: France/UK countries, Île-de-France region, Paris department.
    conn.query(`CREATE TABLE geo_zones (level VARCHAR, country_code VARCHAR, zone_id VARCHAR, name VARCHAR, geom GEOMETRY)`);
    conn.query(`INSERT INTO geo_zones VALUES
      ('country','FRA','FRA','France',         ST_GeomFromText('POLYGON((-5 42, 8 42, 8 51, -5 51, -5 42))')),
      ('country','GBR','GBR','United Kingdom', ST_GeomFromText('POLYGON((-8 51, 2 51, 2 58, -8 58, -8 51))')),
      ('region','FRA','IDF','Île-de-France',   ST_GeomFromText('POLYGON((1.4 48.1, 3.6 48.1, 3.6 49.2, 1.4 49.2, 1.4 48.1))')),
      ('department','FRA','75','Paris',        ST_GeomFromText('POLYGON((2.2 48.8, 2.5 48.8, 2.5 48.9, 2.2 48.9, 2.2 48.8))'))`);

    conn.query(`CREATE TABLE geo_cities (name VARCHAR, country_code VARCHAR, admin1 VARCHAR, population INTEGER, lat DOUBLE, lon DOUBLE, geom GEOMETRY)`);
    conn.query(`INSERT INTO geo_cities VALUES
      ('Paris','FRA','IDF',2100000,48.8566,2.3522, ST_Point(2.3522,48.8566)),
      ('Lyon','FRA','ARA',500000,45.7600,4.8400,  ST_Point(4.8400,45.7600)),
      ('London','GBR','ENG',8900000,51.5074,-0.1278, ST_Point(-0.1278,51.5074))`);

    // User points (mirrors google_maps_segments lat/lon).
    conn.query(`CREATE TABLE google_maps_segments (lat DOUBLE, lon DOUBLE, place_id VARCHAR, label VARCHAR)`);
    conn.query(`INSERT INTO google_maps_segments VALUES
      (48.8566, 2.3522, 'p1', 'paris'),
      (45.7600, 4.8400, 'p2', 'lyon'),
      (51.5074,-0.1278, 'p3', 'london'),
      (0.0,     0.0,    NULL, 'ocean'),
      (44.0,    1.0,    NULL, 'rural-fr')`);

    for (const sql of ATTRIBUTION_STATEMENTS) conn.query(sql);
});

afterAll(() => {
    conn?.close();
});

function row(label: string) {
    return q(`SELECT * FROM google_maps_segments WHERE label = '${label}'`)[0];
}

describe('geo attribution (headless DuckDB spatial)', () => {
    it('attributes Paris to country/region/department/city', () => {
        const r = row('paris');
        expect(r.country).toBe('France');
        expect(r.region).toBe('Île-de-France');
        expect(r.department).toBe('Paris');
        expect(r.nearest_city).toBe('Paris');
        expect(r.city_km).toBeLessThan(1);
    });

    it('attributes Lyon to France + nearest city, no region/department', () => {
        const r = row('lyon');
        expect(r.country).toBe('France');
        expect(r.region).toBeNull();
        expect(r.department).toBeNull();
        expect(r.nearest_city).toBe('Lyon');
    });

    it('attributes a UK point to its country and city only', () => {
        const r = row('london');
        expect(r.country).toBe('United Kingdom');
        expect(r.region).toBeNull();
        expect(r.nearest_city).toBe('London');
    });

    it('leaves an ocean point fully null', () => {
        const r = row('ocean');
        expect(r.country).toBeNull();
        expect(r.nearest_city).toBeNull();
    });

    it('applies the 30 km guard: rural FR point gets country but no city', () => {
        const r = row('rural-fr');
        expect(r.country).toBe('France');
        expect(r.nearest_city).toBeNull();
    });

    it('keeps original lat/lon intact (rounding is only a join key)', () => {
        const r = row('paris');
        expect(r.lat).toBe(48.8566);
        expect(r.lon).toBe(2.3522);
    });
});
