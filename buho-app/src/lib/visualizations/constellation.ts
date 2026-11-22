/**
 * The arithmetic behind `ConstellationChart`: domains, the two satellite bar
 * charts, paint order and hit-testing. Pure functions over plain data, so they
 * are tested here; the component keeps the canvases, D3 behaviours and events.
 */
import * as d3 from 'd3';
import type { ConnectablePoint } from '#lib/data/queries/behaviorQueries.ts';

export type Domain = [number, number];

const DAY_MS = 86_400_000;

/** A point placed on the plate, in CSS px, with the data point it stands for. */
export interface ScaledPoint {
    x: number;
    y: number;
    original: ConnectablePoint;
}

/**
 * The time axis: the caller's domain when it is usable, else the extent of the
 * points, else the last day — an empty or single-instant axis has no width.
 */
export function resolveTimeDomain(
    requested: Domain | null | undefined,
    points: ConnectablePoint[],
    now = Date.now()
): Domain {
    if (
        requested &&
        Number.isFinite(requested[0]) &&
        Number.isFinite(requested[1]) &&
        requested[0] < requested[1]
    ) {
        return requested;
    }
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (const point of points) {
        if (point.x < min) min = point.x;
        if (point.x > max) max = point.x;
    }
    if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) return [now - DAY_MS, now];
    return [min, max];
}

/**
 * A time window kept inside `bounds`, in order, and at least a day wide — a
 * zoom or brush can collapse it to nothing otherwise.
 */
export function clampTimeDomain(domain: Domain, bounds: Domain): Domain {
    const [minX, maxX] = bounds;
    let [start, end] = domain;
    if (start > end) [start, end] = [end, start];
    start = Math.min(Math.max(start, minX), maxX);
    end = Math.min(Math.max(end, minX), maxX);
    if (start >= end) {
        const safeStart = Math.max(minX, Math.min(start, maxX - DAY_MS));
        const safeEnd = Math.min(maxX, safeStart + DAY_MS);
        return [safeStart, safeEnd > safeStart ? safeEnd : maxX];
    }
    return [start, end];
}

/** An hour window kept inside [0, 24], in order, and at least an hour wide. */
export function clampHourDomain(domain: Domain): Domain {
    let [start, end] = domain;
    if (start > end) [start, end] = [end, start];
    start = Math.max(0, start);
    end = Math.min(24, end);
    if (start >= end) {
        const safeEnd = Math.min(24, start + 1);
        return [start, safeEnd > start ? safeEnd : 24];
    }
    return [start, end];
}

/** How the satellite bars weigh and split the matched points. */
export interface BarWeighting {
    /** A point's contribution — 1 to count, or its minutes, km… */
    weight: (point: ConnectablePoint) => number;
    /**
     * Colour mode: how many categories, and which one a point falls in (-1 for
     * none). Null when the chart is not coloured by a dimension.
     */
    segments: { count: number; of: (point: ConnectablePoint) => number } | null;
}

/** A label on the time axis, and the instant it marks. */
export interface TimeTick {
    value: Date;
    label: string;
}

/**
 * The time axis's ticks: as many as fit side by side without touching.
 *
 * A fixed count does not survive a narrow plot. d3 rounds the count it is
 * asked for to the nearest calendar interval, so eight over three years in
 * six hundred pixels came out as a label every quarter, run together. The
 * count follows the room instead, and any label that would still touch the
 * one before it is skipped. When every tick falls on New Year, the month says
 * nothing and only the year is written.
 *
 * `measure` is the label's width in the axis's font — the canvas's own
 * `measureText` in the chart.
 */
export function timeAxisTicks(
    scale: d3.ScaleTime<number, number>,
    measure: (label: string) => number,
    gap = 16
): TimeTick[] {
    const [left, right] = scale.range();
    const room = Math.abs(right - left);
    const widest = measure('Sep 2026');
    const count = Math.max(2, Math.min(8, Math.floor(room / (widest + gap))));
    const ticks = scale.ticks(count);
    const yearly = ticks.every((tick) => tick.getMonth() === 0 && tick.getDate() === 1);
    const format = d3.timeFormat(yearly ? '%Y' : '%b %Y');

    const kept: TimeTick[] = [];
    let previousEnd = -Infinity;
    for (const value of ticks) {
        const label = format(value);
        const half = measure(label) / 2;
        const x = scale(value);
        if (x - half < previousEnd + gap) continue;
        kept.push({ value, label });
        previousEnd = x + half;
    }
    return kept;
}

export interface MonthBar {
    monthStartMs: number;
    count: number;
    /** Per-category totals, or null when no point of the month carried one. */
    segments: number[] | null;
}

/** Local month starts from the month of `start` through the month of `end`. */
export function monthStarts([start, end]: Domain): number[] {
    const cursor = new Date(start);
    cursor.setDate(1);
    cursor.setHours(0, 0, 0, 0);
    const last = new Date(end);
    last.setDate(1);
    last.setHours(0, 0, 0, 0);
    const starts: number[] = [];
    while (cursor <= last) {
        starts.push(cursor.getTime());
        cursor.setMonth(cursor.getMonth() + 1);
    }
    return starts;
}

/**
 * The bottom panel: matched points inside the hour window, per month of the
 * time axis. Every month of the axis gets a bar, empty or not, so the bars stay
 * aligned with the main time axis.
 *
 * Months are built first and each point placed by binary search: deriving its
 * month directly costs a Date and three mutations per point, which on a large
 * source was the most expensive thing a filter change did after the plate.
 */
export function monthlyBars(
    points: ConnectablePoint[],
    timeDomain: Domain,
    hourWindow: Domain,
    { weight, segments }: BarWeighting
): MonthBar[] {
    const starts = monthStarts(timeDomain);
    if (starts.length === 0) return [];

    const counts = new Float64Array(starts.length);
    const segs = segments ? starts.map(() => new Array<number>(segments.count).fill(0)) : null;

    for (const point of points) {
        if (!point.matched) continue;
        if (point.y < hourWindow[0] || point.y > hourWindow[1]) continue;
        const index = d3.bisectRight(starts, point.x) - 1;
        if (index < 0) continue; // before the first month: outside the axis
        const w = weight(point);
        counts[index] += w;
        if (segs && segments) {
            const si = segments.of(point);
            if (si >= 0) segs[index][si] += w;
        }
    }

    return starts.map((monthStartMs, index) => {
        const bar = segs?.[index];
        const hasSegments = bar?.some((value) => value > 0) ?? false;
        return { monthStartMs, count: counts[index], segments: hasSegments ? bar! : null };
    });
}

export interface HourBar {
    startHour: number;
    endHour: number;
    count: number;
    segments: number[] | null;
}

/** The side panel: matched points inside the time window, per `stepMinutes` of the day. */
export function hourBars(
    points: ConnectablePoint[],
    timeWindow: Domain,
    { weight, segments }: BarWeighting,
    stepMinutes = 15
): HourBar[] {
    const binCount = Math.ceil((24 * 60) / stepMinutes);
    const bins: HourBar[] = Array.from({ length: binCount }, (_, index) => ({
        startHour: (index * stepMinutes) / 60,
        endHour: Math.min(24, ((index + 1) * stepMinutes) / 60),
        count: 0,
        segments: segments ? new Array<number>(segments.count).fill(0) : null,
    }));

    for (const point of points) {
        if (!point.matched) continue;
        if (point.x < timeWindow[0] || point.x > timeWindow[1]) continue;
        const w = weight(point);
        const minuteOfDay = Math.max(0, Math.min(1439, Math.floor(point.y * 60)));
        const bin = bins[Math.min(binCount - 1, Math.floor(minuteOfDay / stepMinutes))];
        bin.count += w;
        if (bin.segments && segments) {
            const si = segments.of(point);
            if (si >= 0) bin.segments[si] += w;
        }
    }
    return bins;
}

export interface PointPass {
    color: string;
    alpha: number;
    points: ScaledPoint[];
}

export interface PassStyle {
    unmatched: { color: string; alpha: number };
    /** The single colour of matched points when the chart is not coloured. */
    matched: { color: string; alpha: number };
    /** Colour mode: a matched point's colour, and the alpha of coloured passes. */
    colorOf: ((point: ConnectablePoint) => string) | null;
    coloredAlpha: number;
}

/**
 * The plate's fill passes, in paint order: dimmed non-matching points first,
 * matching points on top so the selection stays readable at high density.
 * Matching points are grouped by colour so the fill changes once per category
 * rather than once per point. Points outside the plate are dropped.
 */
export function pointPasses(
    points: ScaledPoint[],
    plate: { x: Domain; y: Domain },
    style: PassStyle
): PointPass[] {
    const [x0, x1] = plate.x;
    const [y0, y1] = plate.y;
    const dimmed: ScaledPoint[] = [];
    const matched: ScaledPoint[] = [];
    for (const point of points) {
        if (point.x < x0 || point.x > x1 || point.y < y0 || point.y > y1) continue;
        (point.original.matched ? matched : dimmed).push(point);
    }

    const passes: PointPass[] = [{ ...style.unmatched, points: dimmed }];
    if (!style.colorOf) {
        passes.push({ ...style.matched, points: matched });
        return passes;
    }

    const buckets = new Map<string, ScaledPoint[]>();
    for (const point of matched) {
        const color = style.colorOf(point.original);
        let bucket = buckets.get(color);
        if (!bucket) {
            bucket = [];
            buckets.set(color, bucket);
        }
        bucket.push(point);
    }
    for (const [color, bucket] of buckets) {
        passes.push({ color, alpha: style.coloredAlpha, points: bucket });
    }
    return passes;
}

export function buildQuadtree(points: ScaledPoint[]): d3.Quadtree<ScaledPoint> | null {
    if (!points.length) return null;
    return d3
        .quadtree<ScaledPoint>()
        .x((point) => point.x)
        .y((point) => point.y)
        .addAll(points);
}

/**
 * The matched point nearest to (mx, my) within `radius` px, or null.
 *
 * `quadtree.find` takes no predicate, and picking the nearest point then
 * rejecting it when dimmed lets a filtered-out neighbour mask a matching point
 * sitting right behind it — which makes a sparse selection nearly impossible to
 * aim at. This traversal keeps d3's pruning but only ever considers matching
 * points, so dimmed ones own no hover area at all. `matched` is read live, so
 * an in-place filter change needs no rebuild of the tree.
 */
export function nearestMatched(
    tree: d3.Quadtree<ScaledPoint> | null,
    mx: number,
    my: number,
    radius: number
): ScaledPoint | null {
    if (!tree) return null;
    let best: ScaledPoint | null = null;
    let bestDistance = radius * radius;

    tree.visit((node, x0, y0, x1, y1) => {
        if (!('length' in node)) {
            // A leaf chains the points sharing its exact coordinates.
            let leaf: typeof node | undefined = node;
            while (leaf) {
                const point = leaf.data;
                if (point.original.matched) {
                    const dx = point.x - mx;
                    const dy = point.y - my;
                    const distance = dx * dx + dy * dy;
                    if (distance < bestDistance) {
                        bestDistance = distance;
                        best = point;
                    }
                }
                leaf = leaf.next;
            }
        }
        return x0 > mx + radius || x1 < mx - radius || y0 > my + radius || y1 < my - radius;
    });
    return best;
}

/**
 * The colour sweep's "pop" for a bar revealed at `threshold` (0 = first, 1 =
 * last), given the sweep's `progress`: a half-sine over a window `span` wide,
 * zero outside it.
 */
export function barPop(progress: number, threshold: number, span: number): number {
    const phase = (progress - threshold) / span;
    if (phase < 0 || phase > 1) return 0;
    return Math.sin(Math.PI * phase);
}
