import { query } from '../db';
import type { ConnectablePoint, ConstellationTimeDomain } from './behaviorQueries';

/**
 * A constellation point for the Google Maps explorer, plus the normalized
 * dimension fields used to recompute `matched`/pies in JS (mirror of Spotify's
 * ExplorerBasePoint). Constellation x/y use the same scheme as Spotify:
 * x = day epoch (ms), y = fractional hour of day.
 */
export interface LocationBasePoint extends ConnectablePoint {
    fSegmentType: string; // stationary | moving
    fActivityType: string; // walking, in passenger vehicle, … (or Unknown)
    fSemanticType: string; // Home, Work, Unknown, …
    dow: string; // DAYOFWEEK as string, 0..6
    year: string; // YEAR as string
    mins: number; // segment duration in minutes
    distanceMeters: number; // 0 for stationary / missing
    placeId: string; // '' when absent
}

/**
 * All constellation points, loaded once. The point set never changes with
 * filters (the `matched` flag is recomputed in JS), so the quadtree is built
 * only once. Mirror of getExplorerBasePoints.
 */
export async function getGoogleMapsExplorerBasePoints(): Promise<LocationBasePoint[]> {
    const sql = `
        SELECT
            CAST(epoch(DATE(timestamp)) * 1000 AS BIGINT) as x,
            CAST(hour(timestamp) + (minute(timestamp) / 60.0) + (second(timestamp) / 3600.0) AS DOUBLE) as y,
            CAST(timestamp AS VARCHAR) as playedAt,
            segment_type as fSegmentType,
            COALESCE(NULLIF(TRIM(CAST(activity_type AS VARCHAR)), ''), 'Unknown') as fActivityType,
            COALESCE(NULLIF(TRIM(CAST(semantic_type AS VARCHAR)), ''), 'Unknown') as fSemanticType,
            CAST(DAYOFWEEK(timestamp) AS VARCHAR) as dow,
            CAST(YEAR(timestamp) AS VARCHAR) as year,
            CAST(duration_seconds / 60.0 AS DOUBLE) as mins,
            CAST(COALESCE(distance_meters, 0) AS DOUBLE) as distanceMeters,
            COALESCE(CAST(place_id AS VARCHAR), '') as placeId,
            lat,
            lon
        FROM google_maps_segments
        WHERE timestamp IS NOT NULL
        ORDER BY x ASC
    `;

    try {
        const result = await query<any>(sql);
        return result.map((row) => ({
            x: Number(row.x),
            y: Number(row.y),
            matched: true,
            metadata: {
                segmentType: row.fSegmentType,
                activityType: row.fActivityType,
                semanticType: row.fSemanticType,
                durationMinutes: Number(row.mins) || 0,
                playedAt: row.playedAt,
                lat: Number(row.lat),
                lon: Number(row.lon),
            },
            fSegmentType: row.fSegmentType || 'Unknown',
            fActivityType: row.fActivityType || 'Unknown',
            fSemanticType: row.fSemanticType || 'Unknown',
            dow: row.dow ?? 'Unknown',
            year: row.year ?? 'Unknown',
            mins: Number(row.mins) || 0,
            distanceMeters: Number(row.distanceMeters) || 0,
            placeId: row.placeId || '',
        }));
    } catch (error) {
        console.error('Error fetching Google Maps base points:', error);
        return [];
    }
}

/** Full time range of the constellation (loaded once, unfiltered). */
export async function getGoogleMapsConstellationTimeDomain(): Promise<ConstellationTimeDomain | null> {
    const sql = `
        SELECT
            CAST(epoch(MIN(timestamp)) * 1000 AS BIGINT) as minX,
            CAST(epoch(MAX(timestamp)) * 1000 AS BIGINT) as maxX
        FROM google_maps_segments
        WHERE timestamp IS NOT NULL
    `;

    try {
        const result = await query<any>(sql);
        if (!result.length) return null;
        const minX = Number(result[0].minX);
        const maxX = Number(result[0].maxX);
        if (!Number.isFinite(minX) || !Number.isFinite(maxX)) return null;
        return { minX, maxX };
    } catch (error) {
        console.error('Error fetching Google Maps time domain:', error);
        return null;
    }
}
