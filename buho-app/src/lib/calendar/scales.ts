/**
 * How tall a day's figure stands in its module's lane — the one scale the
 * lanes, the parallel coordinates and the week calendar all read, so a bar, a
 * line and a cell of the same day always agree.
 *
 * Pure (no DB, no DOM).
 */
import type { ModuleId } from '#lib/data/modules.ts';

export interface LaneScaleSpec {
    kind: 'cap' | 'sqrt' | 'range';
    /** For `cap` and `range`: the percentile of the year's days whose figure fills the lane. */
    capAt: number;
    /** For `range`: the percentile of the year's days whose figure stands at the lane's floor. */
    floorAt?: number;
}

/**
 * Most lanes are scaled to a high percentile of the year's days rather than to
 * the busiest one, so a single concert or New Year's Eve does not flatten the
 * rest of the year; the few days above it fill the lane. Distances take the
 * square root instead: one long trip is a hundred times an ordinary day, and
 * still has to share the lane with them.
 *
 * Health ranks a day on its heartbeats (see `dayBeats`), which barely move
 * from one day to the next next to their sum: its lane runs from the year's
 * calmest days to its busiest instead of from zero, or every bar would stand
 * nearly as tall as the rest.
 */
export const LANE_SCALES: Record<ModuleId, LaneScaleSpec> = {
    listening: { kind: 'cap', capAt: 0.98 },
    positions: { kind: 'sqrt', capAt: 1 },
    messages: { kind: 'cap', capAt: 0.98 },
    activity: { kind: 'cap', capAt: 0.98 },
    steps: { kind: 'cap', capAt: 0.99 },
    health: { kind: 'range', capAt: 0.98, floorAt: 0.02 },
};

export interface LaneScale {
    /** The figure that fills the lane; 0 for a year with nothing in it. */
    top: number;
    /** A figure's height in the lane, 0–1. */
    fill: (value: number) => number;
    /** The same, not stopped at 1: how far past the top a day went, to tell two full bars apart. */
    reach: (value: number) => number;
}

/** One module's scale for one year, from that year's figures. */
export function laneScale(values: (number | null)[], spec: LaneScaleSpec): LaneScale {
    const positive = values.filter((v): v is number => v !== null && v > 0).sort((a, b) => a - b);
    if (positive.length === 0) return { top: 0, fill: () => 0, reach: () => 0 };

    if (spec.kind === 'sqrt') {
        const top = positive[positive.length - 1];
        const reach = (value: number) => Math.sqrt(Math.max(0, value) / top);
        return { top, fill: reach, reach };
    }

    const at = (share: number) =>
        positive[Math.min(positive.length - 1, Math.floor(positive.length * share))];
    const top = at(spec.capAt);

    if (spec.kind === 'range') {
        const floor = at(spec.floorAt ?? 0);
        const span = top > floor ? top - floor : 1;
        const reach = (value: number) => Math.max(0, value - floor) / span;
        return { top, fill: (value) => Math.min(1, reach(value)), reach };
    }

    const reach = (value: number) => Math.max(0, value) / top;
    return { top, fill: (value) => Math.min(1, reach(value)), reach };
}
