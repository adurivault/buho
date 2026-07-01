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
    country: string; // geo attribution; 'Unknown' when absent
    region: string;
    department: string;
    nearestCity: string;
    arrondissement: string; // Paris/Lyon/Marseille only; 'Unknown' otherwise
    presenceMins: number; // gap until the next point in time (capped at 24h)
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
            COALESCE(country, 'Unknown') as country,
            COALESCE(region, 'Unknown') as region,
            COALESCE(department, 'Unknown') as department,
            COALESCE(nearest_city, 'Unknown') as nearestCity,
            COALESCE(arrondissement, 'Unknown') as arrondissement,
            lat,
            lon
        FROM google_maps_segments
        WHERE timestamp IS NOT NULL
        ORDER BY x ASC
    `;

    try {
        const result = await query<any>(sql);
        const points: LocationBasePoint[] = result.map((row) => ({
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
                country: row.country || 'Unknown',
                region: row.region || 'Unknown',
                department: row.department || 'Unknown',
                nearestCity: row.nearestCity || 'Unknown',
                arrondissement: row.arrondissement || 'Unknown',
            },
            fSegmentType: row.fSegmentType || 'Unknown',
            fActivityType: row.fActivityType || 'Unknown',
            fSemanticType: row.fSemanticType || 'Unknown',
            dow: row.dow ?? 'Unknown',
            year: row.year ?? 'Unknown',
            mins: Number(row.mins) || 0,
            distanceMeters: Number(row.distanceMeters) || 0,
            placeId: row.placeId || '',
            country: row.country || 'Unknown',
            region: row.region || 'Unknown',
            department: row.department || 'Unknown',
            nearestCity: row.nearestCity || 'Unknown',
            arrondissement: row.arrondissement || 'Unknown',
            presenceMins: 0,
        }));
        annotatePresenceMinutes(points);
        return points;
    } catch (error) {
        console.error('Error fetching Google Maps base points:', error);
        return [];
    }
}

/** Reconstructed local instant (ms) of a point: midnight epoch + fractional hour. */
function instantMs(p: LocationBasePoint): number {
    return p.x + p.y * 3_600_000;
}

/**
 * Fill each point's `presenceMins` = the time until the NEXT point in the merged,
 * time-sorted series, capped at 24h (the last point gets 0). Treating the base
 * points as one piecewise-constant-position series makes Σ presence telescope to
 * the tracked span, so overlapping source layers can never double-count. Mutates
 * in place; the array order is left untouched — the chain is walked over a
 * time-sorted index because the SQL orders by day, not by instant.
 */
export function annotatePresenceMinutes(points: LocationBasePoint[]): void {
    const GAP_CAP_MIN = 24 * 60;
    const order = points.map((_, i) => i).sort((a, b) => instantMs(points[a]) - instantMs(points[b]));
    for (let k = 0; k < order.length; k++) {
        const p = points[order[k]];
        if (k + 1 >= order.length) {
            p.presenceMins = 0;
            continue;
        }
        const gapMin = (instantMs(points[order[k + 1]]) - instantMs(p)) / 60_000;
        p.presenceMins = Math.min(Math.max(0, gapMin), GAP_CAP_MIN);
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
