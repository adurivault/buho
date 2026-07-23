import type { DayRaceSegmentRows, DayRecord } from '$lib/data/queries/googleMapsQueries';
import type { MapBounds } from './locationMapData';
import { logicalDay, anchorMs } from '$lib/data/geo/daysDataset';

/**
 * "Day race" map data: every logical day (04:00 → 04:00) becomes one track that
 * plays against a shared 24-hour clock. Pure functions (no DB, no DOM) so the
 * bucketing/sampling can be unit-tested directly; `DayRaceMap.svelte` drives the
 * per-frame samplers into preallocated deck.gl buffers.
 */

export interface DayTrack {
    day: string; // 'YYYY-MM-DD' logical-day key
    times: Float32Array; // clock minutes since 04:00, ascending, [0, DAY_MINUTES]
    lats: Float32Array;
    lons: Float32Array;
    gapAfter: Uint8Array; // 1 → hold across i→i+1 (don't lerp/trail over the gap)
}

export interface DayRaceDataset {
    tracks: DayTrack[];
    bounds: MapBounds | null;
}

export const DAY_MINUTES = 1440;
export const GAP_MAX_MIN = 45; // Δt above this is a tracking gap: hold then jump.
export const MAX_KEYFRAMES_PER_DAY = 360;
export const TRAIL_WINDOW_MIN = 30; // clock-minutes the trail reaches back
export const TRAIL_MAX_SEG = 24; // max segments per track (fixed buffer bound)
const TRAIL_ALPHA_NEW = 165; // alpha at the dot (age 0)
const TRAIL_ALPHA_OLD = 10; // alpha at the tail (age TRAIL_WINDOW_MIN)

const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);

interface Keyframe {
    t: number;
    lat: number;
    lon: number;
    prot: boolean; // protected from stride-drop (seed or stationary keyframe)
}

/**
 * Bucket every segment into its logical day and turn each day present in
 * `cityDays` into a `DayTrack`. City filtering happens through `cityDays`: only
 * days whose `DayRecord` is passed in are built, and each track is seeded at t=0
 * with that record's home anchor.
 */
export function buildDayRaceDataset(
    rows: DayRaceSegmentRows,
    cityDays: DayRecord[],
): DayRaceDataset {
    const record = new Map<string, DayRecord>();
    for (const d of cityDays) record.set(d.day, d);

    const buckets = new Map<string, Keyframe[]>();
    const n = rows.numRows;
    for (let i = 0; i < n; i++) {
        const startMs = Number(rows.startMs[i]);
        const day = logicalDay(startMs);
        const rec = record.get(day);
        if (!rec) continue;

        const anchor = anchorMs(day);
        let kfs = buckets.get(day);
        if (!kfs) {
            // Seed at t=0 from the day's home anchor, so the dot sits home in the
            // morning even when the first segment only starts at 09:00.
            kfs = [{ t: 0, lat: rec.startLat, lon: rec.startLon, prot: true }];
            buckets.set(day, kfs);
        }

        const lat = Number(rows.lat[i]);
        const lon = Number(rows.lon[i]);
        const tStart = clamp((startMs - anchor) / 60000, 0, DAY_MINUTES);
        const stationary = Number(rows.isStationary[i]) === 1;
        kfs.push({ t: tStart, lat, lon, prot: stationary });
        if (stationary) {
            const endMs = Number(rows.endMs[i]);
            if (endMs > startMs) {
                // Same position at the visit's end (clamped to the day window) so
                // the dot holds put during the visit instead of drifting.
                const dayEnd = anchor + DAY_MINUTES * 60000;
                const tEnd = clamp((Math.min(endMs, dayEnd) - anchor) / 60000, 0, DAY_MINUTES);
                kfs.push({ t: tEnd, lat, lon, prot: true });
            }
        }
    }

    const tracks: DayTrack[] = [];
    for (const [day, kfs] of buckets) tracks.push(buildTrack(day, kfs));
    tracks.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));

    return { tracks, bounds: computePercentileBounds(tracks) };
}

function buildTrack(day: string, kfs: Keyframe[]): DayTrack {
    // Stable sort by time; JS Array.sort is stable, so equal-t keyframes keep
    // their insertion order and the dedupe below can keep the later one.
    kfs.sort((a, b) => a.t - b.t);

    const dedup: Keyframe[] = [];
    for (const kf of kfs) {
        const last = dedup[dedup.length - 1];
        if (last && last.t === kf.t) dedup[dedup.length - 1] = kf;
        else dedup.push(kf);
    }

    const final = dedup.length > MAX_KEYFRAMES_PER_DAY ? downsample(dedup, MAX_KEYFRAMES_PER_DAY) : dedup;

    const m = final.length;
    const times = new Float32Array(m);
    const lats = new Float32Array(m);
    const lons = new Float32Array(m);
    const gapAfter = new Uint8Array(m);
    for (let i = 0; i < m; i++) {
        times[i] = final[i].t;
        lats[i] = final[i].lat;
        lons[i] = final[i].lon;
    }
    for (let i = 0; i < m - 1; i++) {
        if (times[i + 1] - times[i] > GAP_MAX_MIN) gapAfter[i] = 1;
    }
    return { day, times, lats, lons, gapAfter };
}

/** Keep every protected keyframe and an even stride of the moving ones. */
function downsample(kfs: Keyframe[], max: number): Keyframe[] {
    const movingIdx: number[] = [];
    let protectedCount = 0;
    for (let i = 0; i < kfs.length; i++) {
        if (kfs[i].prot) protectedCount++;
        else movingIdx.push(i);
    }
    const keepMoving = Math.max(0, max - protectedCount);
    if (movingIdx.length <= keepMoving) return kfs;

    const keep = new Uint8Array(kfs.length);
    for (let i = 0; i < kfs.length; i++) keep[i] = kfs[i].prot ? 1 : 0;
    for (let j = 0; j < movingIdx.length; j++) {
        const a = Math.floor((j * keepMoving) / movingIdx.length);
        const b = Math.floor(((j + 1) * keepMoving) / movingIdx.length);
        if (b > a) keep[movingIdx[j]] = 1;
    }
    const out: Keyframe[] = [];
    for (let i = 0; i < kfs.length; i++) if (keep[i]) out.push(kfs[i]);
    return out;
}

/**
 * Robust viewport box: 2nd/98th percentile per axis (so a single travel day
 * doesn't blow out the frame) plus a padding fraction. Stride-samples above 50k
 * points to keep the sort cheap. Null when there are no points.
 */
export function computePercentileBounds(
    tracks: DayTrack[],
    pLow = 0.02,
    pHigh = 0.98,
    padFrac = 0.1,
): MapBounds | null {
    let total = 0;
    for (const t of tracks) total += t.times.length;
    if (total === 0) return null;

    const stride = total > 50000 ? Math.ceil(total / 50000) : 1;
    const lons: number[] = [];
    const lats: number[] = [];
    let c = 0;
    for (const t of tracks) {
        for (let i = 0; i < t.times.length; i++) {
            if (c % stride === 0) {
                lons.push(t.lons[i]);
                lats.push(t.lats[i]);
            }
            c++;
        }
    }
    lons.sort((a, b) => a - b);
    lats.sort((a, b) => a - b);

    const q = (arr: number[], p: number) =>
        arr[Math.min(arr.length - 1, Math.max(0, Math.floor(p * (arr.length - 1))))];

    const minLon = q(lons, pLow);
    const maxLon = q(lons, pHigh);
    const minLat = q(lats, pLow);
    const maxLat = q(lats, pHigh);
    const padLon = (maxLon - minLon) * padFrac || 0.01;
    const padLat = (maxLat - minLat) * padFrac || 0.01;
    return [
        [minLon - padLon, minLat - padLat],
        [maxLon + padLon, maxLat + padLat],
    ];
}

/** Last index with times[idx] <= t, or -1 if t precedes the first keyframe. */
function intervalIndex(times: Float32Array, t: number): number {
    let lo = 0;
    let hi = times.length - 1;
    let res = -1;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (times[mid] <= t) {
            res = mid;
            lo = mid + 1;
        } else {
            hi = mid - 1;
        }
    }
    return res;
}

/** Position at clock-minute t: hold before first / after last / across a gap; lerp otherwise. */
function samplePos(tr: DayTrack, t: number, out: [number, number]): void {
    const { times, lats, lons, gapAfter } = tr;
    const n = times.length;
    if (n === 0) {
        out[0] = 0;
        out[1] = 0;
        return;
    }
    if (t <= times[0]) {
        out[0] = lons[0];
        out[1] = lats[0];
        return;
    }
    if (t >= times[n - 1]) {
        out[0] = lons[n - 1];
        out[1] = lats[n - 1];
        return;
    }
    const idx = intervalIndex(times, t); // 0..n-2 in this branch
    if (gapAfter[idx] === 1) {
        out[0] = lons[idx];
        out[1] = lats[idx];
        return;
    }
    const t0 = times[idx];
    const t1 = times[idx + 1];
    const f = t1 > t0 ? (t - t0) / (t1 - t0) : 0;
    out[0] = lons[idx] + (lons[idx + 1] - lons[idx]) * f;
    out[1] = lats[idx] + (lats[idx + 1] - lats[idx]) * f;
}

/** Write one [lon, lat] per track into `out` (length ≥ tracks.length * 2). */
export function sampleDots(tracks: DayTrack[], t: number, out: Float32Array): void {
    const p: [number, number] = [0, 0];
    for (let i = 0; i < tracks.length; i++) {
        samplePos(tracks[i], t, p);
        out[i * 2] = p[0];
        out[i * 2 + 1] = p[1];
    }
}

/**
 * Write the fading comet trail behind each dot into fixed-size LineLayer buffers.
 *
 * The trail is the *actual travelled path* over the last `TRAIL_WINDOW_MIN`
 * clock-minutes, built newest-first: the segment at the dot, then one segment per
 * real keyframe crossed going back in time, and a partial segment closing at the
 * window edge. Interior vertices are the keyframes themselves (fixed points), so
 * as the clock advances only the two endpoints slide *along their own straight
 * segment* — the trail never pivots around a corner (no chord "jitter"). The walk
 * stops at the most recent gap so a teleport is never drawn.
 *
 * Buffers (length ≥ tracks.length * TRAIL_MAX_SEG * …): `src`/`dst` are 2-wide
 * endpoints, `colors` is 4-wide RGBA (`trackRgb` is a flat 3-per-track palette,
 * alpha fades with the segment's age). Unused slots collapse to a point.
 */
export function sampleTrails(
    tracks: DayTrack[],
    t: number,
    src: Float32Array,
    dst: Float32Array,
    colors: Uint8Array,
    trackRgb: ArrayLike<number>,
): void {
    const cur: [number, number] = [0, 0];
    const endp: [number, number] = [0, 0];
    const lower = t - TRAIL_WINDOW_MIN;

    for (let i = 0; i < tracks.length; i++) {
        const tr = tracks[i];
        const { times, lats, lons, gapAfter } = tr;
        const n = times.length;
        const r = trackRgb[i * 3];
        const g = trackRgb[i * 3 + 1];
        const b = trackRgb[i * 3 + 2];

        samplePos(tr, t, cur); // newest vertex = current dot position
        let seg = 0;

        const writeSeg = (older: [number, number], olderTime: number) => {
            const base = (i * TRAIL_MAX_SEG + seg) * 2;
            src[base] = older[0];
            src[base + 1] = older[1];
            dst[base] = cur[0];
            dst[base + 1] = cur[1];
            const age = clamp((t - olderTime) / TRAIL_WINDOW_MIN, 0, 1);
            const ci = (i * TRAIL_MAX_SEG + seg) * 4;
            colors[ci] = r;
            colors[ci + 1] = g;
            colors[ci + 2] = b;
            colors[ci + 3] = Math.round(TRAIL_ALPHA_NEW - (TRAIL_ALPHA_NEW - TRAIL_ALPHA_OLD) * age);
            seg++;
        };

        let j = intervalIndex(times, t); // last keyframe at/before t
        while (seg < TRAIL_MAX_SEG && j >= 0) {
            if (times[j] <= lower) {
                // Keyframe j is at/beyond the window edge: close with a partial
                // segment to P(lower). Interval j is guaranteed non-gap here (any
                // gap behind a kept keyframe stopped the walk below), so this
                // interpolation stays on a single straight segment.
                samplePos(tr, lower, endp);
                writeSeg(endp, lower);
                break;
            }
            endp[0] = lons[j];
            endp[1] = lats[j];
            writeSeg(endp, times[j]);
            cur[0] = endp[0];
            cur[1] = endp[1];
            // A gap just behind keyframe j is a teleport — stop; the trail begins
            // where the dot landed (keyframe j).
            if (j - 1 >= 0 && gapAfter[j - 1] === 1) break;
            j--;
        }

        // Collapse the unused slots to a zero-length segment at the tail vertex.
        for (; seg < TRAIL_MAX_SEG; seg++) {
            const base = (i * TRAIL_MAX_SEG + seg) * 2;
            src[base] = cur[0];
            src[base + 1] = cur[1];
            dst[base] = cur[0];
            dst[base + 1] = cur[1];
            const ci = (i * TRAIL_MAX_SEG + seg) * 4;
            colors[ci + 3] = 0;
        }
    }
}

/**
 * Position of a 'YYYY-MM-DD' day within its year, 0 on Jan 1 → 1 on Dec 31.
 * Feeds the continuous day-of-year colour scale.
 */
export function dayOfYearFraction(day: string): number {
    const [y, m, d] = day.split('-').map(Number);
    const start = Date.UTC(y, 0, 1);
    const doy = (Date.UTC(y, m - 1, d) - start) / 86400000;
    const yearDays = (Date.UTC(y + 1, 0, 1) - start) / 86400000 - 1; // 364 or 365
    return yearDays > 0 ? clamp(doy / yearDays, 0, 1) : 0;
}
