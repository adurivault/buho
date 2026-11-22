import { scaleLinear } from 'd3';
import type { HealthMetricSummary } from '#lib/data/queries/healthQueries.ts';
import type { ColorStop } from './signalGrid';

/**
 * The colour scale health readings are painted on, and the bands it cuts them
 * into.
 *
 * Shared by every view that draws a reading — the health explorer's raster and
 * the calendar's heart-rate zones — so a zone is the same range of values, in
 * the same colour, wherever it appears. The bands themselves are cut by
 * `bandStacks` in `signalGrid.ts`, at these stops.
 */

/** Blue to red, laid evenly from a signal's 5th percentile to its 95th. */
export const RAMP = ['#3b82f6', '#38bdf8', '#4cc38a', '#e0c95a', '#e08a3c', '#e0503c'];

/**
 * Where the ramp goes past its red end.
 *
 * A heart rate spends most of its life resting, so the 95th percentile lands
 * not far above the median and everything from a brisk walk to a sprint used to
 * clamp onto the same red. Magenta is the one hue the ramp has not spent, so an
 * effort cannot be mistaken for an ordinary high.
 */
export const TAIL_COLOR = '#e0409a';

/**
 * How far past p95 the tail has to reach, as a share of the range below it,
 * before it earns a stop. A signal that stops dead at its 95th percentile —
 * stress is close — would otherwise get a magenta end standing for a couple of
 * points.
 */
export const TAIL_THRESHOLD = 0.1;

/**
 * The stops for one signal: the ramp from its 5th to its 95th percentile, then
 * one stop more out at the 99.5th.
 *
 * Min to max would hand the scale to a handful of outliers and paint three
 * years one colour; stopping at p95 clamps instead, which put a brisk walk and a
 * sprint on the same red.
 */
export function rampFor(summary: Pick<HealthMetricSummary, 'low' | 'high' | 'peak'>): ColorStop[] {
    const base = RAMP.map((color, i) => ({
        value: summary.low + ((summary.high - summary.low) * i) / (RAMP.length - 1),
        color,
    }));
    const tail = summary.peak - summary.high > (summary.high - summary.low) * TAIL_THRESHOLD;
    return tail ? [...base, { value: summary.peak, color: TAIL_COLOR }] : base;
}

/**
 * A reading's colour on the stops: blended between the two it falls between,
 * the end colours below the first and past the last.
 */
export function colorAt(stops: ColorStop[]): (value: number) => string {
    const scale = scaleLinear<string>()
        .domain(stops.map((s) => s.value))
        .range(stops.map((s) => s.color))
        .clamp(true);
    return (value) => scale(value);
}
