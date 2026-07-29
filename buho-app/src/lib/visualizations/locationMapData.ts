import type { LocationBasePoint } from '$lib/data/queries/googleMapsQueries';

/** [[minLon, minLat], [maxLon, maxLat]] — maplibre `LngLatBoundsLike`. */
export type MapBounds = [[number, number], [number, number]];

export interface BuiltPositions {
    /** Flat [lon, lat, lon, lat, …] for a deck.gl binary position attribute. */
    positions: Float32Array;
    /** The kept points, aligned so `mapPoints[i]` is the source of deck.gl index `i`. */
    mapPoints: LocationBasePoint[];
}

/** Finite [lon, lat] for a point, or null when its coordinates are missing/invalid. */
function coord(p: LocationBasePoint): [number, number] | null {
    const lon = p.metadata.lon;
    const lat = p.metadata.lat;
    if (typeof lon !== 'number' || typeof lat !== 'number') return null;
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
    return [lon, lat];
}

/**
 * Build the deck.gl position buffer once from the shared base points. Points
 * without finite coordinates are dropped, and `mapPoints` is realigned so the
 * deck.gl index maps back to a point for the highlight color and the tooltip.
 */
export function buildPositions(points: LocationBasePoint[]): BuiltPositions {
    let count = 0;
    for (const p of points) if (coord(p)) count++;

    const positions = new Float32Array(count * 2);
    const mapPoints: LocationBasePoint[] = new Array(count);
    let i = 0;
    for (const p of points) {
        const c = coord(p);
        if (!c) continue;
        positions[i * 2] = c[0];
        positions[i * 2 + 1] = c[1];
        mapPoints[i] = p;
        i++;
    }
    return { positions, mapPoints };
}

/** Bounding box over the finite-coordinate points, or null when there are none. */
export function computeBounds(points: LocationBasePoint[]): MapBounds | null {
    let minLon = Infinity;
    let minLat = Infinity;
    let maxLon = -Infinity;
    let maxLat = -Infinity;
    let any = false;
    for (const p of points) {
        const c = coord(p);
        if (!c) continue;
        any = true;
        const [lon, lat] = c;
        if (lon < minLon) minLon = lon;
        if (lon > maxLon) maxLon = lon;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
    }
    return any ? [[minLon, minLat], [maxLon, maxLat]] : null;
}
