import type { LocationBasePoint } from '#lib/data/queries/positionsQueries.ts';

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
    return any
        ? [
              [minLon, minLat],
              [maxLon, maxLat],
          ]
        : null;
}

/*
 * Level of detail.
 *
 * A dezoomed map piles every point onto a few pixels, and drawing a million
 * instances into the same patch of screen is what stalls the GPU — the cost
 * follows how many points share the view, not how big they are. So below a
 * street-level zoom the map draws one point per screen pixel instead: a pixel
 * that already holds a point looks the same with a thousand more behind it.
 *
 * Cells are one pixel wide in Web Mercator at their level's zoom. A level is
 * used from two zooms below it up to its own zoom, so a cell never covers more
 * than one pixel on screen.
 */

/** Zooms that get a decimated point set; above the last one every point is drawn. */
export const LOD_LEVELS = [2, 4, 6, 8, 10, 12, 14] as const;

/** Below this many points the full set is cheap enough at any zoom. */
export const LOD_MIN_POINTS = 50_000;

/** maplibre's world is 512 px wide at zoom 0. */
const TILE_SIZE = 512;
const MAX_LAT = 85.051129;

/** The level whose cells stay under a pixel at `zoom`, or null to draw every point. */
export function lodLevel(zoom: number): number | null {
    for (const level of LOD_LEVELS) if (zoom <= level) return level;
    return null;
}

export interface CellIndex {
    /** Dense cell id of each point, `0 … count - 1`. */
    ids: Uint32Array;
    count: number;
}

/**
 * Assign each point of a flat [lon, lat, …] buffer to its one-pixel cell at
 * `level`. Built once per level and dataset, so a filter change only has to
 * walk these ids.
 */
export function cellIndex(positions: Float32Array, level: number): CellIndex {
    const n = positions.length / 2;
    const size = TILE_SIZE * 2 ** level;
    const ids = new Uint32Array(n);
    const dense = new Map<number, number>();
    for (let i = 0; i < n; i++) {
        const lon = positions[i * 2];
        const lat = Math.max(-MAX_LAT, Math.min(MAX_LAT, positions[i * 2 + 1]));
        const sin = Math.sin((lat * Math.PI) / 180);
        const x = Math.floor(((lon + 180) / 360) * size);
        const y = Math.floor((0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * size);
        // Exact in a double up to 2^53, far above size² at the finest level.
        const key = x * size + y;
        let id = dense.get(key);
        if (id === undefined) {
            id = dense.size;
            dense.set(key, id);
        }
        ids[i] = id;
    }
    return { ids, count: dense.size };
}

export interface Representatives {
    /** Indices (into the point set) drawn in the dimmed layer. */
    dimmed: Uint32Array;
    /** Indices drawn in the active layer, on top. */
    active: Uint32Array;
}

/**
 * One dimmed and one active point per cell, the first of each in point order.
 * A cell holding both keeps both, as the full set would: the active one paints
 * over the grey. With no cell index every point stands for itself.
 */
export function representatives(
    count: number,
    isActive: (index: number) => boolean,
    cells: CellIndex | null
): Representatives {
    const dimmed = new Uint32Array(count);
    const active = new Uint32Array(count);
    let nd = 0;
    let na = 0;
    // Bit 1: the cell has its dimmed point, bit 2: its active one.
    const taken = cells ? new Uint8Array(cells.count) : null;
    for (let i = 0; i < count; i++) {
        const on = isActive(i);
        if (cells && taken) {
            const cell = cells.ids[i];
            const bit = on ? 2 : 1;
            if (taken[cell] & bit) continue;
            taken[cell] |= bit;
        }
        if (on) active[na++] = i;
        else dimmed[nd++] = i;
    }
    return { dimmed: dimmed.slice(0, nd), active: active.slice(0, na) };
}
