import {
    ACTIVITY_OTHER,
    type DayRaceSegmentRows,
    type DayRecord,
} from '#lib/data/queries/positionsQueries.ts';
import { logicalDay, anchorMs } from '#lib/data/geo/daysDataset.ts';

/**
 * Traces with the geography taken out: every one moved so its own starting
 * point sits at the origin, then all of them drawn over each other.
 *
 * A map answers where you went. It cannot answer what your outings *look* like,
 * because each is drawn somewhere else on it and the shapes never land on top
 * of one another. Overlaid, what survives is the shape: how far it reaches, in
 * how many directions, how long it takes to come back.
 *
 * Two things are built here, and they are deliberately not merged.
 *
 * A **day** (from a source that records continuously) is measured on the clock
 * of the day: t=0 is 04:00, and where a trace sits along the timeline says what
 * time it was. An **activity** (from a watch) is measured on its own duration:
 * t=0 is the moment you pressed start, so a run at 07:00 and one at 19:00 lie on
 * top of each other, which is the only way to compare them. One picture cannot
 * hold both meanings of t=0 — and it could not hold both point budgets either,
 * since an hour of watch fixes at 1 Hz outweighs a whole day of phone samples
 * about three to one, and the two would be fighting over the same 180 slots.
 *
 * Coordinates are metres east/north of the origin, not degrees: the point is to
 * compare an outing in Tokyo with one in Paris, and a degree of longitude is not
 * the same distance in the two. Over the span of one day the flat approximation
 * around the origin's own latitude is worth a fraction of a percent.
 *
 * Pure functions (no DB, no DOM) — the component drives the samplers into a
 * canvas.
 */

export interface RelativeTrack {
    /** Unique per trace: the logical day, plus an index where a day has several. */
    key: string;
    /** The logical day it belongs to, for the date colour ramp. */
    day: string;
    /** Minutes since this trace's own t=0, ascending. */
    times: Float32Array;
    /** Metres east of the origin. */
    xs: Float32Array;
    /** Metres north of the origin. */
    ys: Float32Array;
    /** 1 → hold across i→i+1, and never draw the jump. */
    gapAfter: Uint8Array;
    /** ACTIVITY_KINDS index of the leg starting here. */
    activity: Uint8Array;
    /**
     * Where the origin actually is on Earth, and the place it was nearest.
     *
     * The plot throws the geography away, which is the point — but "which of
     * these started somewhere else" is then unanswerable from the picture, and
     * it is one of the more interesting things in it.
     */
    originLat: number;
    originLon: number;
    /** Borrowed from the day record, and only when it describes *this* spot. */
    startCity: string;
}

/**
 * Where the playhead changes gear.
 *
 * `at` of the playhead covers the first `min` minutes; what is left of the
 * playhead covers everything after. It exists for the activity plot, where the
 * longest outing is many times the typical one: without it, either the tail is
 * cut off or nearly every trace has finished in the first tenth of the bar.
 * A knee keeps the whole range on the timeline and still spends most of the
 * playing time where the traces actually are.
 */
export interface Knee {
    min: number;
    at: number;
}

export interface RelativeDataset {
    tracks: RelativeTrack[];
    /** 98th-percentile distance from the origin, in metres. The default fit. */
    reachM: number;
    /** How many traces touch each activity kind, for the legend. */
    kindDays: number[];
    /** Length of the clock, in minutes. */
    span: number;
    /** Non-linear playhead, or null where the clock runs at one speed. */
    knee: Knee | null;
    /** What a position on the clock means, and so how it is written out. */
    timeBase: 'time-of-day' | 'elapsed';
}

/**
 * Metres per degree. Latitude is near enough constant; longitude shrinks with
 * the cosine of the latitude, taken at each trace's own origin.
 */
const M_PER_DEG_LAT = 110_574;
const M_PER_DEG_LON = 111_320;

const DAY_MINUTES = 1440;
/** Δt above this is a tracking gap: hold, then jump without drawing the jump. */
const GAP_MAX_MIN = 45;

/**
 * Keyframes kept per trace.
 *
 * The budget is per *trace*, which is the whole reason days and activities are
 * built separately: shared, an hour of 1 Hz watch fixes would take most of a
 * day's slots and leave the rest of the day coarse.
 */
export const MAX_KEYFRAMES = 180;

/** A watch is off between outings; this much silence ends one. */
const ACTIVITY_BREAK_MIN = 45;

/** Share of the playhead spent below the knee. */
const KNEE_AT = 0.8;

/** ~2 km cells. "Approximate" is the point: a home is not a coordinate. */
const ORIGIN_CELL_DEG = 0.02;

/**
 * How close two origins have to be to count as the same place.
 *
 * A phone fixes a position to a few tens of metres, and a watch acquires its
 * first one while you are still walking out of the door. Two mornings that
 * started from the same doorstep therefore start from two different
 * coordinates — and because everything here is measured *from* that coordinate,
 * that error does not stay at the origin: it slides the whole day sideways
 * against every other day. Snapping the ones that agree onto a common centre is
 * the difference between a hundred commutes falling into one strand and a
 * hundred commutes falling into a smear a hundred metres wide.
 */
export const ORIGIN_SNAP_M = 100;
/** How close the day record's start has to be to lend this trace its name. */
const CITY_BORROW_M = 2000;

const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);

interface Keyframe {
    t: number;
    x: number;
    y: number;
    prot: boolean; // protected from stride-drop (a stationary keyframe)
    kind: number;
}

/** One recorded activity, for stamping the points that fall inside it. */
interface Span {
    startMs: number;
    endMs: number;
    kind: number;
}

/* -------------------------------------------------------------- the clock */

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

/** Playhead position (0–1) → minutes on the clock. */
export function clockAt(p: number, span: number, knee: Knee | null): number {
    const q = clamp01(p);
    if (!knee || knee.min <= 0 || knee.min >= span) return q * span;
    if (q <= knee.at) return (q / knee.at) * knee.min;
    return knee.min + ((q - knee.at) / (1 - knee.at)) * (span - knee.min);
}

/** Minutes on the clock → playhead position (0–1). The exact inverse. */
export function progressOf(min: number, span: number, knee: Knee | null): number {
    if (span <= 0) return 0;
    const t = clamp(min, 0, span);
    if (!knee || knee.min <= 0 || knee.min >= span) return t / span;
    if (t <= knee.min) return (t / knee.min) * knee.at;
    return knee.at + ((t - knee.min) / (span - knee.min)) * (1 - knee.at);
}

/* ------------------------------------------------------------- the builders */

/**
 * One trace per logical day, from the sources that record continuously.
 *
 * t=0 is 04:00, so where a trace is along the clock says what time of day it
 * was — the question a phone's continuous record can answer and a watch's
 * cannot.
 *
 * The *position* origin is the day's first recorded point, not the position at
 * 04:00. That position is only known when a visit happened to span the night;
 * the rest of the time the day record interpolates it between the two points
 * either side, which is a place nobody was, at a distance from the truth nobody
 * can bound. Anchoring on a real fix instead is what makes every trace start at
 * the centre, drawn, rather than at a scatter of guesses around it — and
 * {@link snapOrigins} then pulls the fixes that agree onto one shared centre,
 * so the few tens of metres a phone is wrong by stop sliding whole days against
 * each other.
 */
export function buildDayTraces(rows: DayRaceSegmentRows, days: DayRecord[] = []): RelativeDataset {
    const record = new Map<string, DayRecord>();
    for (const d of days) record.set(d.day, d);

    const byDay = new Map<string, number[]>();
    for (let i = 0; i < rows.numRows; i++) {
        if (Number(rows.isContinuous[i]) !== 1) continue;
        const day = logicalDay(Number(rows.startMs[i]));
        const idx = byDay.get(day);
        if (idx) idx.push(i);
        else byDay.set(day, [i]);
    }

    const tracks: RelativeTrack[] = [];
    for (const [day, idx] of byDay) {
        const origin = idx[0];
        const track = buildFromRows(rows, idx, day, day, origin, anchorMs(day), record);
        if (track) tracks.push(track);
    }

    tracks.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    snapOrigins(tracks);
    return {
        tracks,
        reachM: computeReach(tracks),
        kindDays: countKinds(tracks),
        span: DAY_MINUTES,
        knee: null,
        timeBase: 'time-of-day',
    };
}

/**
 * One trace per recorded activity, from the sources that only record in bursts.
 *
 * t=0 is the moment the watch was started, which is what lets a run at 07:00 and
 * one at 19:00 be laid over each other. The clock runs as long as the longest
 * outing, with a knee at the 98th percentile so the tail is kept without every
 * ordinary activity finishing in the first tenth of the bar.
 *
 * Where one activity ends is not a guess: the parser writes `end == start` on
 * the last fix of a `.fit` file, so that is an exact boundary. The silence rule
 * is only a safety net for an export that did not come through that parser.
 */
export function buildActivityTraces(
    rows: DayRaceSegmentRows,
    days: DayRecord[] = []
): RelativeDataset {
    const record = new Map<string, DayRecord>();
    for (const d of days) record.set(d.day, d);

    const episodic: number[] = [];
    for (let i = 0; i < rows.numRows; i++) {
        if (Number(rows.isContinuous[i]) === 0) episodic.push(i);
    }

    const tracks: RelativeTrack[] = [];
    const perDay = new Map<string, number>();
    let current: number[] = [];

    const flush = () => {
        if (current.length < 2) {
            current = [];
            return;
        }
        const origin = current[0];
        const startMs = Number(rows.startMs[origin]);
        const day = logicalDay(startMs);
        const nth = (perDay.get(day) ?? 0) + 1;
        perDay.set(day, nth);
        const track = buildFromRows(rows, current, `${day}#${nth}`, day, origin, startMs, record);
        if (track) tracks.push(track);
        current = [];
    };

    for (let j = 0; j < episodic.length; j++) {
        const i = episodic[j];
        current.push(i);
        const startMs = Number(rows.startMs[i]);
        const terminal = Number(rows.endMs[i]) <= startMs;
        const next = episodic[j + 1];
        const silence =
            next !== undefined &&
            (Number(rows.startMs[next]) - startMs) / 60000 > ACTIVITY_BREAK_MIN;
        if (terminal || silence) flush();
    }
    flush();

    tracks.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    snapOrigins(tracks);

    const durations = tracks
        .map((t) => (t.times.length ? t.times[t.times.length - 1] : 0))
        .sort((a, b) => a - b);
    const span = Math.max(1, durations[durations.length - 1] ?? 1);
    const p98 = durations.length
        ? durations[Math.min(durations.length - 1, Math.floor(0.98 * (durations.length - 1)))]
        : span;

    return {
        tracks,
        reachM: computeReach(tracks),
        kindDays: countKinds(tracks),
        span,
        // No knee where the tail is not actually long: a straight clock is
        // easier to read, and two gears for nothing is just a confusing bar.
        knee: p98 > 0 && p98 < span * 0.75 ? { min: p98, at: KNEE_AT } : null,
        timeBase: 'elapsed',
    };
}

/** True where a plot of that kind would have anything to show. */
export function hasContinuousRows(rows: DayRaceSegmentRows): boolean {
    for (let i = 0; i < rows.numRows; i++) if (Number(rows.isContinuous[i]) === 1) return true;
    return false;
}

export function hasEpisodicRows(rows: DayRaceSegmentRows): boolean {
    for (let i = 0; i < rows.numRows; i++) if (Number(rows.isContinuous[i]) === 0) return true;
    return false;
}

/**
 * Turn a set of rows into one trace: positions relative to `originRow`, times
 * relative to `originMs`.
 *
 * The two builders differ in how they group rows and in what they call t=0, and
 * in nothing else — everything from here down is the same for both.
 */
function buildFromRows(
    rows: DayRaceSegmentRows,
    idx: number[],
    key: string,
    day: string,
    originRow: number,
    originMs: number,
    record: Map<string, DayRecord>
): RelativeTrack | null {
    if (idx.length === 0) return null;

    const lat0 = Number(rows.lat[originRow]);
    const lon0 = Number(rows.lon[originRow]);
    const mPerLon = M_PER_DEG_LON * Math.cos((lat0 * Math.PI) / 180);

    // Google labels the *semantic* leg, not the raw path points that trace its
    // shape, so a walk is one typed row spanning fifty untyped ones. Those spans
    // are what lends the type to the points inside them. A watch types every
    // fix, so this loop finds nothing to do there and costs nothing.
    const spans: Span[] = [];
    for (const i of idx) {
        const kind = Number(rows.activity[i]);
        if (kind === ACTIVITY_OTHER) continue;
        const s = Number(rows.startMs[i]);
        const e = Number(rows.endMs[i]);
        if (e > s) spans.push({ startMs: s, endMs: e, kind });
    }
    const kindAt = (ms: number): number => {
        for (const s of spans) if (ms >= s.startMs && ms <= s.endMs) return s.kind;
        return ACTIVITY_OTHER;
    };

    const kfs: Keyframe[] = [];
    for (const i of idx) {
        const startMs = Number(rows.startMs[i]);
        const x = (Number(rows.lon[i]) - lon0) * mPerLon;
        const y = (Number(rows.lat[i]) - lat0) * M_PER_DEG_LAT;
        const own = Number(rows.activity[i]);
        const kind = own === ACTIVITY_OTHER ? kindAt(startMs) : own;
        const stationary = Number(rows.isStationary[i]) === 1;
        kfs.push({ t: Math.max(0, (startMs - originMs) / 60000), x, y, prot: stationary, kind });

        if (stationary) {
            const endMs = Number(rows.endMs[i]);
            if (endMs > startMs) {
                // Same position at the visit's end, so the trace rests there
                // instead of drifting towards whatever comes next.
                kfs.push({
                    t: Math.max(0, (endMs - originMs) / 60000),
                    x,
                    y,
                    prot: true,
                    kind,
                });
            }
        }
    }

    return buildTrack(key, day, kfs, lat0, lon0, cityNear(record.get(day), lat0, lon0, mPerLon));
}

/**
 * The day record's place name, but only when it describes where this trace
 * started.
 *
 * The record's start position is the 04:00 one, which the trace no longer uses
 * and which is often interpolated. Kept as a label when it lands within a cell
 * of the real origin — a name for a spot you were at — and dropped otherwise,
 * rather than repeated as though it were the answer.
 */
function cityNear(rec: DayRecord | undefined, lat: number, lon: number, mPerLon: number): string {
    if (!rec || !rec.startCity || rec.startCity === 'Unknown') return 'Unknown';
    const dx = (rec.startLon - lon) * mPerLon;
    const dy = (rec.startLat - lat) * M_PER_DEG_LAT;
    return Math.hypot(dx, dy) <= CITY_BORROW_M ? rec.startCity : 'Unknown';
}

function buildTrack(
    key: string,
    day: string,
    kfs: Keyframe[],
    originLat: number,
    originLon: number,
    startCity: string
): RelativeTrack | null {
    // Stable sort, so equal-t keyframes keep insertion order and the dedupe can
    // keep the later one.
    kfs.sort((a, b) => a.t - b.t);

    const dedup: Keyframe[] = [];
    for (const kf of kfs) {
        const last = dedup[dedup.length - 1];
        if (last && last.t === kf.t) dedup[dedup.length - 1] = kf;
        else dedup.push(kf);
    }
    if (dedup.length < 2) return null;

    const final = dedup.length > MAX_KEYFRAMES ? downsample(dedup, MAX_KEYFRAMES) : dedup;

    const m = final.length;
    const times = new Float32Array(m);
    const xs = new Float32Array(m);
    const ys = new Float32Array(m);
    const gapAfter = new Uint8Array(m);
    const activity = new Uint8Array(m);
    for (let i = 0; i < m; i++) {
        times[i] = final[i].t;
        xs[i] = final[i].x;
        ys[i] = final[i].y;
        activity[i] = final[i].kind;
    }
    for (let i = 0; i < m - 1; i++) {
        if (times[i + 1] - times[i] > GAP_MAX_MIN) gapAfter[i] = 1;
    }
    return { key, day, times, xs, ys, gapAfter, activity, originLat, originLon, startCity };
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
    // The first and last moving keyframes are the trace's own ends; dropping
    // either would move where it starts from or stops at.
    keep[movingIdx[0]] = 1;
    keep[movingIdx[movingIdx.length - 1]] = 1;
    for (let j = 0; j < movingIdx.length; j++) {
        const a = Math.floor((j * keepMoving) / movingIdx.length);
        const b = Math.floor(((j + 1) * keepMoving) / movingIdx.length);
        if (b > a) keep[movingIdx[j]] = 1;
    }
    const out: Keyframe[] = [];
    for (let i = 0; i < kfs.length; i++) if (keep[i]) out.push(kfs[i]);
    return out;
}

function countKinds(tracks: RelativeTrack[]): number[] {
    const counts = new Array<number>(ACTIVITY_OTHER + 1).fill(0);
    for (const tr of tracks) {
        const seen = new Set<number>();
        for (let i = 0; i < tr.activity.length; i++) seen.add(tr.activity[i]);
        for (const k of seen) counts[k] += 1;
    }
    return counts;
}

/**
 * How far out the plot has to reach to hold the bulk of the data: the 98th
 * percentile of the distance from the origin, in metres. A percentile rather
 * than the maximum, so one flight does not shrink every ordinary outing to a
 * dot. Stride-samples above 50k points to keep the sort cheap.
 */
export function computeReach(tracks: RelativeTrack[], p = 0.98): number {
    let total = 0;
    for (const t of tracks) total += t.times.length;
    if (total === 0) return 0;

    const stride = total > 50000 ? Math.ceil(total / 50000) : 1;
    const d: number[] = [];
    let c = 0;
    for (const t of tracks) {
        for (let i = 0; i < t.times.length; i++) {
            if (c % stride === 0) d.push(Math.hypot(t.xs[i], t.ys[i]));
            c++;
        }
    }
    d.sort((a, b) => a - b);
    const q = d[Math.min(d.length - 1, Math.max(0, Math.floor(p * (d.length - 1))))];
    return q > 0 ? q : 1;
}

/* ------------------------------------------------------------- the samplers */

/** Last index with times[idx] <= t, or -1 if t precedes the first keyframe. */
export function intervalIndex(times: Float32Array, t: number): number {
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

/** Position at minute t: hold before first / after last / across a gap; lerp otherwise. */
export function samplePos(tr: RelativeTrack, t: number, out: [number, number]): void {
    const { times, xs, ys, gapAfter } = tr;
    const n = times.length;
    if (n === 0) {
        out[0] = 0;
        out[1] = 0;
        return;
    }
    if (t <= times[0]) {
        out[0] = xs[0];
        out[1] = ys[0];
        return;
    }
    if (t >= times[n - 1]) {
        out[0] = xs[n - 1];
        out[1] = ys[n - 1];
        return;
    }
    const idx = intervalIndex(times, t);
    if (gapAfter[idx] === 1) {
        out[0] = xs[idx];
        out[1] = ys[idx];
        return;
    }
    const t0 = times[idx];
    const t1 = times[idx + 1];
    const f = t1 > t0 ? (t - t0) / (t1 - t0) : 0;
    out[0] = xs[idx] + (xs[idx + 1] - xs[idx]) * f;
    out[1] = ys[idx] + (ys[idx + 1] - ys[idx]) * f;
}

/**
 * Where each trace's head is at minute `t`, which leg it is on, and whether it
 * is still going.
 *
 * Only the heads. The trails are built straight from the keyframes (see the
 * renderer), which is what lets them be built once and then merely *selected*
 * from as the clock moves — this is the part that genuinely has to be resampled
 * every frame, because a head sits between two keyframes.
 *
 * `seg` is the keyframe index the head is travelling from, rather than a colour
 * or an activity: the renderer colours by different things depending on what the
 * reader asked for, and the leg is the one fact all of them derive from.
 */
export function sampleHeads(
    tracks: RelativeTrack[],
    t: number,
    xy: Float32Array,
    seg: Int32Array,
    alive: Uint8Array
): void {
    const p: [number, number] = [0, 0];
    for (let i = 0; i < tracks.length; i++) {
        const tr = tracks[i];
        samplePos(tr, t, p);
        xy[i * 2] = p[0];
        xy[i * 2 + 1] = p[1];

        const n = tr.times.length;
        alive[i] = n > 0 && t <= tr.times[n - 1] ? 1 : 0;
        seg[i] = n === 0 ? 0 : Math.max(0, intervalIndex(tr.times, t));
    }
}

/* ------------------------------------------------------------- start places */

/**
 * Pull origins that agree onto one shared centre, in place.
 *
 * Leader clustering rather than single-link: a seed absorbs everything within
 * {@link ORIGIN_SNAP_M} of *itself*, so a cluster can never be wider than twice
 * the radius. Single-link would let a row of fixes down a street chain into one
 * group half a kilometre long, which is exactly the drift being corrected for.
 * Seeds are taken busiest-first, so the doorstep you leave from every morning
 * claims its neighbours rather than being claimed by a one-off passer-by.
 *
 * The traces keep their true shape: only the frame they are measured in moves,
 * by the same amount for every point of a trace. What used to be a whole day
 * shifted sideways becomes what it always was — a first fix that landed a few
 * metres off, now visible as a small scatter at the centre instead of a smear
 * across the entire picture.
 */
export function snapOrigins(tracks: RelativeTrack[], radiusM = ORIGIN_SNAP_M): void {
    const n = tracks.length;
    if (n < 2) return;

    // A grid at the linking radius, so finding neighbours scans a handful of
    // cells instead of every other trace. Cells are sized in degrees of
    // latitude for both axes; a cell is then narrower than the radius in the
    // east–west direction, which the per-query span below makes up for.
    const cellDeg = radiusM / M_PER_DEG_LAT;
    const grid = new Map<string, number[]>();
    const key = (i: number, j: number) => `${i},${j}`;
    const cellI = (lat: number) => Math.floor(lat / cellDeg);
    const cellJ = (lon: number) => Math.floor(lon / cellDeg);
    for (let t = 0; t < n; t++) {
        const k = key(cellI(tracks[t].originLat), cellJ(tracks[t].originLon));
        const bucket = grid.get(k);
        if (bucket) bucket.push(t);
        else grid.set(k, [t]);
    }

    /** Every trace whose origin is within the radius of this one. */
    const near = (t: number): number[] => {
        const { originLat: lat, originLon: lon } = tracks[t];
        const cosLat = Math.max(0.05, Math.cos((lat * Math.PI) / 180));
        const mPerLon = M_PER_DEG_LON * cosLat;
        const ci = cellI(lat);
        const cj = cellJ(lon);
        // A cell spans `radiusM` north–south but only `radiusM · cos(lat)`
        // east–west, so reaching a full radius takes more columns than rows.
        const spanJ = Math.ceil(1 / cosLat);
        const out: number[] = [];
        for (let di = -1; di <= 1; di++) {
            for (let dj = -spanJ; dj <= spanJ; dj++) {
                const bucket = grid.get(key(ci + di, cj + dj));
                if (!bucket) continue;
                for (const u of bucket) {
                    const dx = (tracks[u].originLon - lon) * mPerLon;
                    const dy = (tracks[u].originLat - lat) * M_PER_DEG_LAT;
                    if (dx * dx + dy * dy <= radiusM * radiusM) out.push(u);
                }
            }
        }
        return out;
    };

    const neighbours: number[][] = new Array(n);
    for (let t = 0; t < n; t++) neighbours[t] = near(t);

    // Busiest first; ties broken on the key so the result never depends on the
    // order rows happened to arrive in.
    const order = Array.from({ length: n }, (_, t) => t).sort((a, b) => {
        const d = neighbours[b].length - neighbours[a].length;
        return d !== 0 ? d : tracks[a].key < tracks[b].key ? -1 : 1;
    });

    const taken = new Uint8Array(n);
    for (const seed of order) {
        if (taken[seed]) continue;
        const members: number[] = [];
        for (const u of neighbours[seed]) {
            if (!taken[u]) {
                taken[u] = 1;
                members.push(u);
            }
        }
        if (members.length < 2) continue;

        let sumLat = 0;
        let sumLon = 0;
        for (const u of members) {
            sumLat += tracks[u].originLat;
            sumLon += tracks[u].originLon;
        }
        const lat = sumLat / members.length;
        const lon = sumLon / members.length;

        for (const u of members) {
            const tr = tracks[u];
            const mPerLon = M_PER_DEG_LON * Math.cos((tr.originLat * Math.PI) / 180);
            const dx = (lon - tr.originLon) * mPerLon;
            const dy = (lat - tr.originLat) * M_PER_DEG_LAT;
            if (dx === 0 && dy === 0) continue;
            for (let i = 0; i < tr.xs.length; i++) {
                tr.xs[i] -= dx;
                tr.ys[i] -= dy;
            }
            tr.originLat = lat;
            tr.originLon = lon;
        }
    }
}

/** One place traces set off from, and how many of them did. */
export interface OriginCluster {
    /** What the legend shows: the nearest known place, or bare coordinates. */
    label: string;
    days: number;
}

export interface OriginClusters {
    /** Busiest first, with a catch-all "Elsewhere" last when there is a tail. */
    clusters: OriginCluster[];
    /** Cluster index per track, parallel to `tracks`. */
    byTrack: Uint8Array;
    /** Whether that last entry is the catch-all rather than a real place. */
    hasElsewhere: boolean;
}

/**
 * Group traces by roughly where they started.
 *
 * Coordinates rather than the attributed city, because the cells have to exist
 * before geo attribution has run and for watch-only outings that never get a
 * city at all — the city is only borrowed for the label, and only when it
 * describes the spot (see `cityNear`). Everything past `max` collapses into one
 * grey "Elsewhere", which is what a colour scale can carry.
 */
export function clusterOrigins(tracks: RelativeTrack[], max = 6): OriginClusters {
    const cell = (lat: number, lon: number) =>
        `${Math.round(lat / ORIGIN_CELL_DEG)},${Math.round(lon / ORIGIN_CELL_DEG)}`;

    const groups = new Map<
        string,
        { days: number; cities: Map<string, number>; lat: number; lon: number }
    >();
    for (const tr of tracks) {
        const key = cell(tr.originLat, tr.originLon);
        let g = groups.get(key);
        if (!g) {
            g = { days: 0, cities: new Map(), lat: tr.originLat, lon: tr.originLon };
            groups.set(key, g);
        }
        g.days += 1;
        if (tr.startCity && tr.startCity !== 'Unknown') {
            g.cities.set(tr.startCity, (g.cities.get(tr.startCity) ?? 0) + 1);
        }
    }

    const ranked = [...groups.entries()].sort((a, b) => b[1].days - a[1].days);
    const kept = ranked.slice(0, max);
    const index = new Map<string, number>();
    kept.forEach(([key], i) => index.set(key, i));

    const clusters: OriginCluster[] = kept.map(([, g]) => {
        let label = '';
        let best = 0;
        for (const [city, n] of g.cities) {
            if (n > best) {
                best = n;
                label = city;
            }
        }
        return {
            label: label || `${g.lat.toFixed(2)}, ${g.lon.toFixed(2)}`,
            days: g.days,
        };
    });

    const elsewhere = ranked.slice(max).reduce((n, [, g]) => n + g.days, 0);
    const hasElsewhere = elsewhere > 0;
    if (hasElsewhere) clusters.push({ label: 'Elsewhere', days: elsewhere });

    const byTrack = new Uint8Array(tracks.length);
    for (let i = 0; i < tracks.length; i++) {
        byTrack[i] = index.get(cell(tracks[i].originLat, tracks[i].originLon)) ?? max;
    }
    return { clusters, byTrack, hasElsewhere };
}
