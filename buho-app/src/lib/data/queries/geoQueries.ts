import { query } from '../db';

/**
 * Consumption queries over the geo-enriched `google_maps_segments` (columns
 * country / region / department / nearest_city / city_km, added by
 * attributeZones). Counts/sums are CAST so rows come back as JS numbers.
 */

export interface ZoneStat {
    /** Zone name (country / region / department / city). */
    zone: string;
    segments: number;
    hours: number;
    days: number;
}

async function zoneStats(column: string, where = ''): Promise<ZoneStat[]> {
    const sql = `
        SELECT
            ${column} AS zone,
            CAST(COUNT(*) AS INTEGER) AS segments,
            CAST(SUM(duration_seconds) / 3600.0 AS DOUBLE) AS hours,
            CAST(COUNT(DISTINCT date) AS INTEGER) AS days
        FROM google_maps_segments
        WHERE ${column} IS NOT NULL ${where}
        GROUP BY ${column}
        ORDER BY hours DESC`;
    try {
        return await query<ZoneStat>(sql);
    } catch (error) {
        console.error(`Error fetching zone stats for ${column}:`, error);
        return [];
    }
}

/** Time spent per country, most to least. */
export function getCountryStats(): Promise<ZoneStat[]> {
    return zoneStats('country');
}

/** Regions, optionally scoped to one country (e.g. 'France'). */
export function getRegionStats(country?: string): Promise<ZoneStat[]> {
    const where = country ? `AND country = '${country.replace(/'/g, "''")}'` : '';
    return zoneStats('region', where);
}

/** Departments (France only, per current asset scope). */
export function getDepartmentStats(): Promise<ZoneStat[]> {
    return zoneStats('department');
}

/** Nearest-city ranking. */
export function getCityStats(): Promise<ZoneStat[]> {
    return zoneStats('nearest_city');
}

export interface AttributionCoverage {
    total: number;
    withCountry: number;
    withRegion: number;
    withDepartment: number;
    withCity: number;
}

/** Sanity/debug: how many segments got each level attributed. */
export async function getAttributionCoverage(): Promise<AttributionCoverage | null> {
    const sql = `
        SELECT
            CAST(COUNT(*) AS INTEGER) AS total,
            CAST(COUNT(country) AS INTEGER) AS withCountry,
            CAST(COUNT(region) AS INTEGER) AS withRegion,
            CAST(COUNT(department) AS INTEGER) AS withDepartment,
            CAST(COUNT(nearest_city) AS INTEGER) AS withCity
        FROM google_maps_segments`;
    try {
        const rows = await query<AttributionCoverage>(sql);
        return rows[0] ?? null;
    } catch (error) {
        console.error('Error fetching attribution coverage:', error);
        return null;
    }
}
