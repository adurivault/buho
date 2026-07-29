import { base } from '$app/paths';
import { feature } from 'topojson-client';
import type { FeatureCollection } from 'geojson';
import type { GeometryCollection, Topology } from 'topojson-specification';
import { query, withJsonRows } from '../db';

/**
 * Load the geographic reference tables (`geo_zones`, `geo_cities`) into DuckDB
 * from the static assets in `/geo`. These are public reference data, independent
 * of the user's data, so they are loaded once per session (idempotent).
 *
 * v2: `geo_zones` is a single "leaf" layer — each polygon is the finest admin
 * unit of its territory and carries its full hierarchy in columns
 * (country/region/department/arrondissement). The ocean polygons are appended
 * (level = 'ocean') as the not-on-land fallback. Assets come from
 * `scripts/build-geo-assets.mjs`; geometry is built SQL-side via ST_GeomFromGeoJSON.
 */

const ZONE_FILES = ['geo_zones.topojson', 'ocean.topojson'];

const ZONE_COLS = ['level', 'country_code', 'country', 'region', 'department', 'arrondissement'] as const;
type ZoneProp = (typeof ZONE_COLS)[number];
type ZoneRow = Record<ZoneProp, string | null> & { geom_text: string };

interface CityRow {
    name: string;
    country_code: string;
    population: number;
    lat: number;
    lon: number;
}

let geoAssetsLoaded = false;

export async function loadGeoAssets(): Promise<void> {
    if (geoAssetsLoaded) return;

    await query(`CREATE TABLE IF NOT EXISTS geo_zones (
        level VARCHAR, country_code VARCHAR, country VARCHAR, region VARCHAR,
        department VARCHAR, arrondissement VARCHAR, geom GEOMETRY)`);
    await query(`CREATE TABLE IF NOT EXISTS geo_cities (
        name VARCHAR, country_code VARCHAR, population INTEGER,
        lat DOUBLE, lon DOUBLE, geom GEOMETRY)`);

    for (const file of ZONE_FILES) {
        const rows = await loadZoneRows(`${base}/geo/${file}`);
        if (rows.length === 0) continue;
        await withJsonRows(rows, (src) =>
            `INSERT INTO geo_zones
             SELECT level, country_code, country, region, department, arrondissement,
                    ST_GeomFromGeoJSON(geom_text) FROM ${src}`);
    }

    const cities = await fetchJson<CityRow[]>(`${base}/geo/cities5000.json`);
    if (cities && cities.length > 0) {
        await withJsonRows(cities, (src) =>
            `INSERT INTO geo_cities
             SELECT name, country_code, population, lat, lon, ST_Point(lon, lat) FROM ${src}`);
    }

    // RTREE indexes are essential: attributeZones spatial-joins against these
    // tables, and without an index DuckDB nested-loops the 4500+ leaf polygons
    // per point and blows the in-browser memory cap (OOM at ~3 GB).
    await query(`CREATE INDEX IF NOT EXISTS geo_zones_rtree ON geo_zones USING RTREE (geom)`);
    await query(`CREATE INDEX IF NOT EXISTS geo_cities_rtree ON geo_cities USING RTREE (geom)`);

    geoAssetsLoaded = true;
}

async function loadZoneRows(url: string): Promise<ZoneRow[]> {
    const topo = await fetchJson<Topology>(url);
    if (!topo) return [];

    const objectName = Object.keys(topo.objects)[0];
    const fc = feature(topo, topo.objects[objectName] as GeometryCollection) as FeatureCollection;

    return fc.features.map((f) => {
        const p = (f.properties ?? {}) as Partial<Record<ZoneProp, string>>;
        const row = { geom_text: JSON.stringify(f.geometry) } as ZoneRow;
        for (const col of ZONE_COLS) row[col] = p[col] ?? null;
        return row;
    });
}

async function fetchJson<T>(url: string): Promise<T | null> {
    try {
        const res = await fetch(url);
        if (!res.ok) return null;
        return (await res.json()) as T;
    } catch {
        // Assets may be absent in early dev; geo attribution then no-ops.
        return null;
    }
}
