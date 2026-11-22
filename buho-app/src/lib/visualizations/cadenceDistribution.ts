import { CADENCE_BANDS } from '#lib/data/queries/stepsQueries.ts';

/**
 * The shape of a cadence distribution, one bar per step per minute.
 *
 * Cadence is steps ÷ active seconds (cf. lib/data/sources/garmin/stepPackets), a ratio
 * with no natural bucket width. It is rounded to the nearest whole step per
 * minute — the finest reading that means anything — and nothing is grouped after
 * that: bar 112 is the packets that ran at 112 spm, not a range standing in for
 * them.
 *
 * Weight is the measure the explorer is currently on (steps or active minutes),
 * never a packet count. A packet's cadence is only as reliable as the movement
 * behind it: 12 steps over 8 seconds can only land on a handful of ratios, and
 * counting packets would let that arithmetic speak as loudly as an hour's walk.
 */
export interface CadenceDistribution {
    /** Every series' weight summed, i.e. the silhouette they stack up to. */
    columns: Float64Array;
    /** One entry per input series, in the order given, over the same domain. */
    series: CadenceSeriesShape[];
    /** [0, top] in spm — `columns` covers it end to end, one entry per unit. */
    domain: [number, number];
    /** Largest stacked column, i.e. the y scale's upper bound. */
    peak: number;
    /** Weight carried by packets that have a cadence at all (overflow included). */
    total: number;
    /**
     * Weight past the axis. Accounting rather than display — the columns are
     * meant to sum to `total` minus this, and nothing else guarantees it.
     */
    overflow: number;
    /** Weight from packets that recorded no active time, so no cadence. */
    unknown: number;
    bands: CadenceBandShare[];
}

/**
 * One counter's worth of movement: the walking and running counters are read
 * apart because a window holding both has two paces, and the average of them
 * describes neither.
 */
export interface CadenceSeries {
    key: string;
    label: string;
    cadences: Float64Array;
    weights: Float64Array;
}

export interface CadenceSeriesShape {
    key: string;
    label: string;
    columns: Float64Array;
    total: number;
}

export interface CadenceBandShare {
    label: string;
    min: number;
    max: number;
    value: number;
}

/**
 * A packet writing 200 steps against one second of active time reports 12,000
 * steps/min. Those exist, and they are arithmetic rather than gait; the working
 * histogram stops here instead of sizing itself for them.
 */
const HISTOGRAM_MAX = 1000;

/** Domain tops land on a multiple of this, so the axis ticks stay round. */
const DOMAIN_GRAIN = 20;

/**
 * Where the axis stops, whatever the data does. Past this the readings are
 * sprint arithmetic off short packets rather than gait, and letting them set the
 * axis squeezes walking — where all the weight is — into a corner.
 */
const DOMAIN_MAX = 200;

/** Never crop below this: a domain that stops mid-walk hides the main mode. */
const DOMAIN_FLOOR = 60;

/**
 * The whole-spm reading of a raw cadence: what every column, band and selection
 * is expressed in. NaN when the packet recorded no active time, i.e. no pace.
 */
export function roundedCadence(spm: number | null | undefined): number {
    if (spm == null || !Number.isFinite(spm)) return NaN;
    return Math.round(spm);
}

/**
 * Whether a cadence falls in a selection. Half-open on the upper bound, so two
 * adjacent bands never both claim the same reading.
 */
export function inCadenceSelection(
    spm: number | null | undefined,
    min: number | null,
    max: number | null
): boolean {
    const c = roundedCadence(spm);
    // No active time means no pace, so no cadence selection can contain it.
    if (Number.isNaN(c)) return false;
    if (typeof min === 'number' && c < min) return false;
    if (typeof max === 'number' && c >= max) return false;
    return true;
}

/**
 * A brush selection, as whole bars: `from` is the first cadence it holds, `to`
 * the first one past it — the same half-open convention as the bands.
 */
export interface CadenceSpan {
    from: number;
    to: number;
}

/**
 * The span holding every bar between two bar indices, both included.
 *
 * Order does not matter, which is what lets a handle be dragged past the other
 * side: the caller passes the drag's fixed anchor and the pointer's bar, and the
 * anchor stays inside the result whichever side it ends up on. Deriving the
 * anchor from the previous span instead lets it drift a bar on every clamp.
 */
export function spanFromBars(a: number, b: number, domain: [number, number]): CadenceSpan {
    const lo = Math.max(domain[0], Math.min(a, b));
    const hi = Math.min(domain[1], Math.max(a, b));
    return { from: lo, to: hi + 1 };
}

/** Slide a span to start at `from`, keeping its width and staying on the axis. */
export function shiftSpan(span: CadenceSpan, from: number, domain: [number, number]): CadenceSpan {
    const width = span.to - span.from;
    const start = Math.round(Math.max(domain[0], Math.min(from, domain[1] + 1 - width)));
    return { from: start, to: start + width };
}

/**
 * Lay out one distribution per series, all sharing an axis so they can be read
 * against each other and stacked into the total.
 */
export function buildCadenceDistribution(series: CadenceSeries[]): CadenceDistribution {
    const perSeries = series.map((s) => ({ series: s, ...histogram(s) }));

    const combined = new Float64Array(HISTOGRAM_MAX + 1);
    let total = 0;
    let unknown = 0;
    for (const s of perSeries) {
        for (let spm = 0; spm < combined.length; spm++) combined[spm] += s.counts[spm];
        total += s.total;
        unknown += s.unknown;
    }

    const top = domainTop(combined, total);
    const columns = combined.slice(0, top + 1);

    let overflow = 0;
    for (let spm = top + 1; spm < combined.length; spm++) overflow += combined[spm];

    let peak = 0;
    for (let i = 0; i < columns.length; i++) if (columns[i] > peak) peak = columns[i];

    return {
        columns,
        series: perSeries.map((s) => ({
            key: s.series.key,
            label: s.series.label,
            columns: s.counts.slice(0, top + 1),
            total: s.total,
        })),
        domain: [0, top],
        peak,
        total,
        overflow,
        unknown,
        bands: bandShares(combined, total),
    };
}

/** One series' weight per whole spm, before any axis is chosen. */
function histogram(series: CadenceSeries): {
    counts: Float64Array;
    total: number;
    unknown: number;
} {
    const counts = new Float64Array(HISTOGRAM_MAX + 1);
    const n = Math.min(series.cadences.length, series.weights.length);
    let total = 0;
    let unknown = 0;

    for (let i = 0; i < n; i++) {
        const w = series.weights[i];
        if (!(w > 0)) continue;
        const c = roundedCadence(series.cadences[i]);
        if (Number.isNaN(c)) {
            unknown += w;
            continue;
        }
        total += w;
        counts[c >= HISTOGRAM_MAX ? HISTOGRAM_MAX : Math.max(0, c)] += w;
    }

    return { counts, total, unknown };
}

/**
 * Where the axis stops: past the fastest reading, but never past DOMAIN_MAX.
 *
 * What falls beyond is counted in `overflow` rather than folded into the last
 * column, which would put a bar where no bar belongs. It stays reachable: a
 * brush taken to the right edge selects open-ended.
 */
function domainTop(counts: Float64Array, total: number): number {
    if (total <= 0) return DOMAIN_FLOOR * 2;
    for (let spm = DOMAIN_MAX; spm >= 0; spm--) {
        if (counts[spm] <= 0) continue;
        const rounded = Math.ceil((spm + 1) / DOMAIN_GRAIN) * DOMAIN_GRAIN;
        return Math.max(DOMAIN_FLOOR, Math.min(DOMAIN_MAX, rounded));
    }
    return DOMAIN_FLOOR * 2;
}

/**
 * The weight inside each gait band, summed over whole spm on the band's own
 * bounds — the same arithmetic the cross-filter runs, so a band's share and
 * what selecting it keeps can never disagree.
 */
function bandShares(counts: Float64Array, total: number): CadenceBandShare[] {
    return CADENCE_BANDS.map((band) => {
        let value = 0;
        if (total > 0) {
            const from = Math.max(0, Math.ceil(band.min));
            const to = Number.isFinite(band.max)
                ? Math.min(counts.length, band.max)
                : counts.length;
            for (let spm = from; spm < to; spm++) value += counts[spm];
        }
        return { label: band.label, min: band.min, max: band.max, value };
    });
}
