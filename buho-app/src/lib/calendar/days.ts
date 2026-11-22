/**
 * The selected year, day by day: one figure per module per day, how tall it
 * stands in its module's lane, and the module it stood out in.
 *
 * Pure (no DB, no DOM). The calendar queries hand over what each module
 * recorded; everything the lanes, the week calendar and the parallel
 * coordinates draw is derived here.
 */
import { DATA_MODULES, type ModuleId } from '#lib/data/modules.ts';
import { LANE_SCALES, laneScale } from './scales';

/** One module's figure for one day. */
export interface DayValue {
    /** 'YYYY-MM-DD' */
    date: string;
    value: number;
}

/** The first and last day a module holds anything on, across every year. */
export interface Coverage {
    first: string;
    last: string;
}

/**
 * Whether a day a module recorded nothing on reads as zero or as unknown.
 *
 * The logs are complete records of what happened: inside the span an export
 * covers, a day without a play, a message or a search is a day with none. A
 * recorder only knows the time it ran — no step packet is a watch left on the
 * table, no position a phone that was off — so its silences stay holes rather
 * than becoming the quietest days of the year.
 */
export const SILENCE_IS_ZERO: Record<ModuleId, boolean> = {
    listening: true,
    positions: false,
    messages: true,
    activity: true,
    steps: false,
    health: false,
};

const DAY_MS = 86_400_000;
const pad = (n: number) => String(n).padStart(2, '0');

/** 'YYYY-MM-DD' of a UTC-midnight epoch, the way DuckDB's `epoch(date)` counts. */
export function isoDay(ms: number): string {
    const d = new Date(ms);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** Every day of `year`, in order. 365 or 366 of them. */
export function daysOfYear(year: number): string[] {
    const days: string[] = [];
    const end = Date.UTC(year + 1, 0, 1);
    for (let t = Date.UTC(year, 0, 1); t < end; t += DAY_MS) days.push(isoDay(t));
    return days;
}

/**
 * One module's figures laid on every day of the year: the figure where there is
 * one, zero on a silent day the export covers when silence reads as zero (see
 * {@link SILENCE_IS_ZERO}), null everywhere else.
 */
export function layOnYear(
    days: string[],
    values: DayValue[],
    coverage: Coverage | undefined,
    silenceIsZero: boolean
): (number | null)[] {
    const byDay = new Map(values.map((v) => [v.date, v.value]));
    return days.map((day) => {
        const value = byDay.get(day);
        if (value !== undefined) return value;
        const covered = coverage !== undefined && day >= coverage.first && day <= coverage.last;
        return silenceIsZero && covered ? 0 : null;
    });
}

/** The module a day stood out in, and how tall its bar stood that day, 0–1. */
export interface Standout {
    module: ModuleId;
    fill: number;
}

/**
 * The module each day stood out in: the one whose bar stands tallest that day,
 * each lane on its own scale (see `LANE_SCALES`) — the bar that catches the eye
 * in the lanes above.
 *
 * Heights rather than figures because the figures share no unit: forty minutes
 * of music and forty messages say nothing about each other, but a bar at the
 * top of its lane and one a third of the way up compare at a glance.
 *
 * A module only competes on a day it recorded something on. Two full bars are
 * told apart by how far past the top of its lane each day went; an exact tie
 * goes to the module listed first in `DATA_MODULES`.
 *
 * @param reaches each day's figure over its lane's top, not stopped at 1.
 */
export function standoutModules(
    values: Partial<Record<ModuleId, (number | null)[]>>,
    reaches: Partial<Record<ModuleId, (number | null)[]>>,
    dayCount: number
): (Standout | null)[] {
    const standout: (Standout | null)[] = [];
    for (let day = 0; day < dayCount; day++) {
        let best: { module: ModuleId; reach: number } | null = null;
        for (const { id } of DATA_MODULES) {
            const value = values[id]?.[day];
            const reach = reaches[id]?.[day];
            if (value == null || value <= 0 || reach == null) continue;
            if (best === null || reach > best.reach) best = { module: id, reach };
        }
        standout.push(best && { module: best.module, fill: Math.min(1, best.reach) });
    }
    return standout;
}

/** A year laid out day by day, ready for the lanes, the week calendar and the parallel coordinates. */
export interface YearDays {
    year: number;
    /** Every day of the year, 'YYYY-MM-DD'. Every array below is aligned with it. */
    days: string[];
    /** Per module; absent for a module with nothing loaded. */
    values: Partial<Record<ModuleId, (number | null)[]>>;
    /** Each day's height in its module's lane, 0–1, on the lane's scale (see `LANE_SCALES`). */
    fills: Partial<Record<ModuleId, (number | null)[]>>;
    /** The figure that fills each module's lane this year. */
    tops: Partial<Record<ModuleId, number>>;
    /** The module each day stood out in. See {@link standoutModules}. */
    standout: (Standout | null)[];
}

/**
 * @param series each loaded module's figures for the year, one entry per day it
 * recorded something on. A module left out is treated as not loaded.
 * @param coverage each module's first and last day across the whole history —
 * where its silences start meaning zero. See {@link SILENCE_IS_ZERO}.
 */
export function buildYearDays(
    year: number,
    series: Partial<Record<ModuleId, DayValue[]>>,
    coverage: Partial<Record<ModuleId, Coverage>>
): YearDays {
    const days = daysOfYear(year);
    const values: Partial<Record<ModuleId, (number | null)[]>> = {};
    const fills: Partial<Record<ModuleId, (number | null)[]>> = {};
    const reaches: Partial<Record<ModuleId, (number | null)[]>> = {};
    const tops: Partial<Record<ModuleId, number>> = {};

    for (const { id } of DATA_MODULES) {
        const recorded = series[id];
        if (!recorded) continue;
        const laid = layOnYear(days, recorded, coverage[id], SILENCE_IS_ZERO[id]);
        const scale = laneScale(laid, LANE_SCALES[id]);
        values[id] = laid;
        tops[id] = scale.top;
        fills[id] = laid.map((v) => (v === null ? null : scale.fill(v)));
        reaches[id] = laid.map((v) => (v === null ? null : scale.reach(v)));
    }

    return {
        year,
        days,
        values,
        fills,
        tops,
        standout: standoutModules(values, reaches, days.length),
    };
}
