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
 * Assets are produced by `scripts/build-geo-assets.mjs`. Zone TopoJSON features
 * carry normalized `{ country_code, zone_id, name }` properties; cities are a
 * flat JSON array. Geometry is built SQL-side via ST_GeomFromGeoJSON / ST_Point.
 */

const ZONE_SOURCES = [
    { level: 'country', file: 'adm0.topojson' },
    { level: 'ocean', file: 'ocean.topojson' }, // fallback when not on land
    { level: 'region', file: 'adm1.topojson' }, // France régions (precise)
    { level: 'region', file: 'adm1-world.topojson' }, // other countries' states/provinces
    { level: 'department', file: 'adm2-fr.topojson' },
] as const;

interface ZoneRow {
    level: string;
    country_code: string;
    zone_id: string;
    name: string;
    geom_text: string;
}

interface CityRow {
    name: string;
    country_code: string;
    admin1: string;
    population: number;
    lat: number;
    lon: number;
}

let geoAssetsLoaded = false;

export async function loadGeoAssets(): Promise<void> {
    if (geoAssetsLoaded) return;

    await query(`CREATE TABLE IF NOT EXISTS geo_zones (
        level VARCHAR, country_code VARCHAR, zone_id VARCHAR, name VARCHAR, geom GEOMETRY)`);
    await query(`CREATE TABLE IF NOT EXISTS geo_cities (
        name VARCHAR, country_code VARCHAR, admin1 VARCHAR, population INTEGER,
        lat DOUBLE, lon DOUBLE, geom GEOMETRY)`);

    for (const { level, file } of ZONE_SOURCES) {
        const rows = await loadZoneRows(`${base}/geo/${file}`, level);
        if (rows.length === 0) continue;
        await withJsonRows(rows, (src) =>
            `INSERT INTO geo_zones
             SELECT level, country_code, zone_id, name, ST_GeomFromGeoJSON(geom_text) FROM ${src}`);
    }

    const cities = await fetchJson<CityRow[]>(`${base}/geo/cities5000.json`);
    if (cities && cities.length > 0) {
        await withJsonRows(cities, (src) =>
            `INSERT INTO geo_cities
             SELECT name, country_code, admin1, population, lat, lon, ST_Point(lon, lat) FROM ${src}`);
    }

    // RTREE indexes are essential: attributeZones spatial-joins against these
    // tables, and without an index DuckDB nested-loops the 4500+ world ADM1
    // polygons per point and blows the in-browser memory cap (OOM at ~3 GB).
    await query(`CREATE INDEX IF NOT EXISTS geo_zones_rtree ON geo_zones USING RTREE (geom)`);
    await query(`CREATE INDEX IF NOT EXISTS geo_cities_rtree ON geo_cities USING RTREE (geom)`);

    geoAssetsLoaded = true;
}

async function loadZoneRows(url: string, level: string): Promise<ZoneRow[]> {
    const topo = await fetchJson<Topology>(url);
    if (!topo) return [];

    const objectName = Object.keys(topo.objects)[0];
    const fc = feature(topo, topo.objects[objectName] as GeometryCollection) as FeatureCollection;

    return fc.features.map((f) => {
        const p = (f.properties ?? {}) as Partial<Pick<ZoneRow, 'country_code' | 'zone_id' | 'name'>>;
        return {
            level,
            country_code: p.country_code ?? '',
            zone_id: p.zone_id ?? '',
            name: p.name ?? '',
            geom_text: JSON.stringify(f.geometry),
        };
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
