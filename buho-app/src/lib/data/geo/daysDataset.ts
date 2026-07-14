import { haversineMeters } from './haversine';

/**
 * The derived per-day mobility dataset (`google_maps_days`). One row per logical
 * day, where a day runs 04:00 → 04:00 local so late evenings stay in the right
 * day. Built as a post-processing step once geo attribution has populated the
 * geo columns on `google_maps_segments`.
 *
 * The start place answers "where did the day begin": the position at the 04:00
 * mark (a spanning visit, else interpolated between the surrounding points, else
 * the nearest data edge) snapped to the geographically nearest known place.
 * `startFill` / `startPlaceKm` expose how reliable that snap is.
 *
 * This module is pure (no DB), so it can be unit-tested directly; `buildDays.ts`
 * wraps it with the DuckDB load/materialise.
 */
export interface DayRow {
    day: string;                 // 'YYYY-MM-DD' logical-day key
    startPlaceId: string;        // nearest known place to the 04:00 position ('' if none)
    startSemanticType: string;
    startLat: number;
    startLon: number;
    startCity: string;
    startCountry: string;
    startPlaceKm: number;        // distance from the 04:00 position to that place (confidence)
    startFill: 'visit' | 'interpolated' | 'edge';
    kmTraveled: number;
    maxDistFromStartKm: number;
    distinctPlaces: number;
    visitCount: number;
    movingMinutes: number;
    stationaryMinutes: number;
    segmentCount: number;
}

/** One segment as loaded for the day build (timestamps as epoch ms). */
export interface DaySegment {
    startMs: number;
    endMs: number;
    lat: number;
    lon: number;
    segmentType: string;   // 'stationary' | 'moving'
    placeId: string;       // '' when absent
    semanticType: string;  // '' when absent
    durationSeconds: number;
    distanceMeters: number;
    nearestCity: string;
    country: string;
}

const DAY_MS = 86_400_000;
const ANCHOR_HOUR = 4; // the 04:00 night boundary
const pad = (n: number) => String(n).padStart(2, '0');

/** UTC calendar-day key of an epoch-ms instant (timestamps are naive-as-UTC). */
function dayKey(ms: number): string {
    const d = new Date(ms);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
/** Logical day a moment belongs to: the day of (instant − 04:00). */
function logicalDay(ms: number): string {
    return dayKey(ms - ANCHOR_HOUR * 3_600_000);
}
/** The 04:00 anchor instant (ms) of a 'YYYY-MM-DD' logical day. */
function anchorMs(day: string): number {
    const [y, m, d] = day.split('-').map(Number);
    return Date.UTC(y, m - 1, d, ANCHOR_HOUR);
}

/** Key of the most frequent value in a count map ('' if empty). */
function mode(counts: Map<string, number>): string {
    let best = '';
    let bestN = -1;
    for (const [k, n] of counts) {
        if (n > bestN) { bestN = n; best = k; }
    }
    return best;
}
function bump(counts: Map<string, number>, k: string): void {
    if (k) counts.set(k, (counts.get(k) ?? 0) + 1);
}

interface Place {
    placeId: string;
    lat: number;
    lon: number;
    semanticType: string;
    city: string;
    country: string;
}

/** Index of every known place (a place_id) → centroid + modal labels. */
function buildPlaces(segments: DaySegment[]): Place[] {
    const agg = new Map<string, {
        sumLat: number; sumLon: number; n: number;
        sem: Map<string, number>; city: Map<string, number>; country: Map<string, number>;
    }>();
    for (const s of segments) {
        if (s.segmentType !== 'stationary' || !s.placeId) continue;
        let a = agg.get(s.placeId);
        if (!a) {
            a = { sumLat: 0, sumLon: 0, n: 0, sem: new Map(), city: new Map(), country: new Map() };
            agg.set(s.placeId, a);
        }
        a.sumLat += s.lat; a.sumLon += s.lon; a.n += 1;
        bump(a.sem, s.semanticType);
        bump(a.city, s.nearestCity === 'Unknown' ? '' : s.nearestCity);
        bump(a.country, s.country === 'Unknown' ? '' : s.country);
    }
    const places: Place[] = [];
    for (const [placeId, a] of agg) {
        places.push({
            placeId,
            lat: a.sumLat / a.n,
            lon: a.sumLon / a.n,
            semanticType: mode(a.sem) || 'Unknown',
            city: mode(a.city) || 'Unknown',
            country: mode(a.country) || 'Unknown',
        });
    }
    return places;
}

const GRID_CELL_DEG = 0.05;    // ~5.5 km cells
const GRID_MAX_RING = 16;      // ~90 km reach before falling back to a full scan
const M_PER_DEG_LAT = 111_320; // meters per degree of latitude (approx)

/** Exact full scan — the fallback for far/sparse queries. */
function scanNearest(places: Place[], lat: number, lon: number): { place: Place; km: number } | null {
    let best: Place | null = null;
    let bestM = Infinity;
    for (const p of places) {
        const m = haversineMeters({ lat, lon }, { lat: p.lat, lon: p.lon });
        if (m < bestM) { bestM = m; best = p; }
    }
    return best ? { place: best, km: bestM / 1000 } : null;
}

/**
 * Build a nearest-place finder backed by a lat/lon grid, so each lookup scans a
 * handful of nearby cells instead of every place (~15 M haversine calls over a
 * full year of days otherwise). Rings expand outward and stop once no unscanned
 * ring can hold a closer place; a far/sparse query falls back to an exact scan,
 * so results match the plain scan.
 */
function makeNearestPlaceFinder(places: Place[]): (lat: number, lon: number) => { place: Place; km: number } | null {
    const grid = new Map<string, Place[]>();
    const key = (ci: number, cj: number) => `${ci},${cj}`;
    const cellI = (lat: number) => Math.floor(lat / GRID_CELL_DEG);
    const cellJ = (lon: number) => Math.floor(lon / GRID_CELL_DEG);
    for (const p of places) {
        const k = key(cellI(p.lat), cellJ(p.lon));
        (grid.get(k) ?? grid.set(k, []).get(k)!).push(p);
    }

    return function nearest(lat: number, lon: number) {
        if (places.length === 0) return null;
        const ci = cellI(lat), cj = cellJ(lon);
        const cosLat = Math.cos((lat * Math.PI) / 180);
        let best: Place | null = null;
        let bestM = Infinity;
        for (let r = 0; r <= GRID_MAX_RING; r++) {
            // Scan only the border cells of the r-th ring.
            for (let di = -r; di <= r; di++) {
                for (let dj = -r; dj <= r; dj++) {
                    if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
                    const cell = grid.get(key(ci + di, cj + dj));
                    if (!cell) continue;
                    for (const p of cell) {
                        const m = haversineMeters({ lat, lon }, { lat: p.lat, lon: p.lon });
                        if (m < bestM) { bestM = m; best = p; }
                    }
                }
            }
            // Any place in ring r+1 is ≥ r cells away on some axis; if that lower
            // bound already exceeds the best hit, no farther ring can beat it.
            if (best) {
                const lowerBoundM = r * GRID_CELL_DEG * M_PER_DEG_LAT * cosLat;
                if (lowerBoundM > bestM) return { place: best, km: bestM / 1000 };
            }
        }
        // Reached the ring cap without a proven-nearest (far or sparse): scan all.
        return scanNearest(places, lat, lon);
    };
}

/** Largest index i with keys[i] <= x, or -1. Assumes keys ascending. */
function lastAtOrBefore(keys: number[], x: number): number {
    let lo = 0, hi = keys.length - 1, res = -1;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (keys[mid] <= x) { res = mid; lo = mid + 1; } else { hi = mid - 1; }
    }
    return res;
}

/**
 * Build the per-day rows from time-ordered segments. Pure (no DB), so it can be
 * unit-tested directly. `segments` must be sorted ascending by `startMs`.
 */
export function computeDays(segments: DaySegment[]): DayRow[] {
    if (segments.length === 0) return [];

    const places = buildPlaces(segments);
    const findNearestPlace = makeNearestPlaceFinder(places);

    // Position samples for interpolation: each segment contributes its start
    // point, and a stationary visit also its end point (same position), so the
    // 04:00 mark inside/near a visit resolves to that visit's position.
    const sampleT: number[] = [];
    const sampleLat: number[] = [];
    const sampleLon: number[] = [];
    // Stationary visits (sorted by start) to detect a visit spanning the anchor.
    const stStart: number[] = [];
    const stEnd: number[] = [];
    const stLat: number[] = [];
    const stLon: number[] = [];

    // Bucket segments by logical day.
    const byDay = new Map<string, DaySegment[]>();
    let maxEnd = -Infinity;
    for (const s of segments) {
        sampleT.push(s.startMs); sampleLat.push(s.lat); sampleLon.push(s.lon);
        if (s.segmentType === 'stationary' && s.endMs > s.startMs) {
            sampleT.push(s.endMs); sampleLat.push(s.lat); sampleLon.push(s.lon);
        }
        if (s.segmentType === 'stationary') {
            stStart.push(s.startMs); stEnd.push(s.endMs); stLat.push(s.lat); stLon.push(s.lon);
        }
        const d = logicalDay(s.startMs);
        (byDay.get(d) ?? byDay.set(d, []).get(d)!).push(s);
        if (s.endMs > maxEnd) maxEnd = s.endMs;
    }
    // Samples share segment order except for the interleaved stationary end
    // points; sort to guarantee ascending time for the binary searches.
    const order = sampleT.map((_, i) => i).sort((a, b) => sampleT[a] - sampleT[b]);
    const sT = order.map((i) => sampleT[i]);
    const sLat = order.map((i) => sampleLat[i]);
    const sLon = order.map((i) => sampleLon[i]);

    /** Resolve the physical position at the 04:00 anchor + how it was found. */
    function resolveStart(anchor: number): { lat: number; lon: number; fill: DayRow['startFill'] } | null {
        // A stationary visit spanning the anchor (visits don't overlap, so the
        // last one starting at/before the anchor is the only candidate).
        const si = lastAtOrBefore(stStart, anchor);
        if (si >= 0 && stEnd[si] >= anchor) {
            return { lat: stLat[si], lon: stLon[si], fill: 'visit' };
        }
        // Otherwise interpolate between the surrounding samples.
        const bi = lastAtOrBefore(sT, anchor);
        const ai = sT[bi] === anchor ? bi : bi + 1; // first sample at/after anchor
        const hasB = bi >= 0;
        const hasA = ai < sT.length;
        if (hasB && hasA) {
            const t0 = sT[bi], t1 = sT[ai];
            if (t1 === t0) return { lat: sLat[bi], lon: sLon[bi], fill: 'interpolated' };
            const f = (anchor - t0) / (t1 - t0);
            return { lat: sLat[bi] + (sLat[ai] - sLat[bi]) * f, lon: sLon[bi] + (sLon[ai] - sLon[bi]) * f, fill: 'interpolated' };
        }
        if (hasB) return { lat: sLat[bi], lon: sLon[bi], fill: 'edge' };
        if (hasA) return { lat: sLat[ai], lon: sLon[ai], fill: 'edge' };
        return null;
    }

    const rows: DayRow[] = [];
    const firstAnchor = anchorMs(logicalDay(segments[0].startMs));
    const lastAnchor = anchorMs(logicalDay(maxEnd));
    for (let a = firstAnchor; a <= lastAnchor; a += DAY_MS) {
        const day = dayKey(a); // a is already the 04:00 instant, so its date is the logical day
        const start = resolveStart(a);
        if (!start) continue;
        const snap = findNearestPlace(start.lat, start.lon);

        const segs = byDay.get(day) ?? [];
        let kmTraveled = 0, movingMin = 0, stationaryMin = 0, visitCount = 0, maxDistKm = 0;
        const distinctIds = new Set<string>();
        for (const s of segs) {
            if (s.segmentType === 'moving') {
                kmTraveled += s.distanceMeters / 1000;
                movingMin += s.durationSeconds / 60;
            } else {
                stationaryMin += s.durationSeconds / 60;
                visitCount += 1;
                if (s.placeId) distinctIds.add(s.placeId);
            }
            const d = haversineMeters({ lat: start.lat, lon: start.lon }, { lat: s.lat, lon: s.lon }) / 1000;
            if (d > maxDistKm) maxDistKm = d;
        }

        rows.push({
            day,
            startPlaceId: snap?.place.placeId ?? '',
            startSemanticType: snap?.place.semanticType ?? 'Unknown',
            startLat: start.lat,
            startLon: start.lon,
            startCity: snap?.place.city ?? 'Unknown',
            startCountry: snap?.place.country ?? 'Unknown',
            startPlaceKm: snap ? snap.km : -1,
            startFill: start.fill,
            kmTraveled,
            maxDistFromStartKm: maxDistKm,
            distinctPlaces: distinctIds.size,
            visitCount,
            movingMinutes: movingMin,
            stationaryMinutes: stationaryMin,
            segmentCount: segs.length,
        });
    }
    return rows;
}
