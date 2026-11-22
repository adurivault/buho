/**
 * The cross-filtering every Explorer runs over its in-memory points.
 *
 * The points are loaded once; filters never go back to DuckDB. On each change a
 * page marks which points match (the constellation dims the rest) and rebuilds
 * its breakdowns in one pass, so a brush stays immediate.
 *
 * These are plain functions over plain data. A page keeps its own state, its
 * effects and its layout, and calls what it needs — including nothing, if one
 * day it needs different rules.
 */
import type { FilterScalar, FilterState } from '#lib/types/filters.ts';

/** One slice of a breakdown pie: a dimension value and what it weighs. */
export interface DimensionSlice {
    value: string;
    minutes: number;
    plays: number;
    /** Optional measure magnitude that drives the slice (e.g. km, points). */
    amount?: number;
}

/** What every Explorer point carries: a day on x, an hour on y, and whether it matches. */
export interface CrossfilterPoint {
    x: number;
    y: number;
    matched: boolean;
}

/**
 * One criterion a point has to pass. `key` names the dimension it filters, so a
 * breakdown of that dimension can ignore it (see `breakdowns`).
 */
export interface CrossfilterTest<P> {
    key: string;
    pass: (point: P) => boolean;
}

/** A dimension filtered by value: the store key, and the point field holding the value. */
export interface ValueDimension<P> {
    key: string;
    field: keyof P;
}

/** The visible time/hour window (the brush), or null on an axis left whole. */
export interface ViewWindow {
    time: [number, number] | null;
    hour: [number, number] | null;
}

/** A filter's values as strings, or null when it is unset or not a value filter (a range). */
export function filterValueSet(filters: FilterState, key: string): Set<string> | null {
    const v = filters[key];
    if (v === undefined || v === null) return null;
    if (v instanceof Set) return new Set([...v].map(String));
    if (Array.isArray(v)) return new Set(v.map((x) => String(x)));
    if (typeof v === 'object') return null;
    return new Set([String(v as FilterScalar)]);
}

/** One test per dimension that currently has a value filter. */
export function valueTests<P>(
    filters: FilterState,
    dimensions: ValueDimension<P>[]
): CrossfilterTest<P>[] {
    const tests: CrossfilterTest<P>[] = [];
    for (const { key, field } of dimensions) {
        const values = filterValueSet(filters, key);
        if (values) tests.push({ key, pass: (p) => values.has(p[field] as string) });
    }
    return tests;
}

export function passesAll<P>(point: P, tests: CrossfilterTest<P>[]): boolean {
    for (const test of tests) if (!test.pass(point)) return false;
    return true;
}

/**
 * The rule behind "each breakdown ignores its own filter", for one point:
 * `null` if it passes every test, the key of the one test it fails, or `false`
 * if it fails more than one. A point then counts toward a dimension when the
 * result is `null` or that dimension's key.
 *
 * Exposed on its own for pages whose breakdowns aggregate differently from
 * `breakdowns` — several measures at once, say.
 */
export function soleFailure<P>(point: P, tests: CrossfilterTest<P>[]): string | null | false {
    let failed: string | null = null;
    for (const test of tests) {
        if (test.pass(point)) continue;
        if (failed !== null) return false;
        failed = test.key;
    }
    return failed;
}

export function inWindow(point: CrossfilterPoint, window: ViewWindow): boolean {
    const { time, hour } = window;
    if (time && (point.x < time[0] || point.x > time[1])) return false;
    if (hour && (point.y < hour[0] || point.y > hour[1])) return false;
    return true;
}

/**
 * Set `matched` on every point, in place: the constellation keeps one array for
 * the page's lifetime and redraws on a version bump, rather than rebuilding its
 * index for a new one.
 */
export function markMatched<P extends CrossfilterPoint>(
    points: P[],
    tests: CrossfilterTest<P>[]
): void {
    for (const point of points) point.matched = passesAll(point, tests);
}

export interface BreakdownOptions<P> {
    tests: CrossfilterTest<P>[];
    /** The dimensions to break down. Their `key` is matched against the tests'. */
    dimensions: ValueDimension<P>[];
    window: ViewWindow;
    /** What a point weighs in a breakdown — 1 to count it, or its minutes, km… */
    weight?: (point: P) => number;
    /** Called for each point passing every test, to total what the tiles show. */
    onMatch?: (point: P) => void;
}

/**
 * Every breakdown in a single pass over the points in the window.
 *
 * Each breakdown ignores its own filter, the way a filtered bar chart keeps its
 * other bars: a point counts toward a dimension if it passes every test, or
 * fails only that dimension's. So selecting "Monday" leaves the day-of-week pie
 * whole — Monday highlighted — while every other pie narrows to Mondays.
 *
 * Empty values are skipped: a point with no channel is not a channel.
 */
export function breakdowns<P extends CrossfilterPoint>(
    points: P[],
    { tests, dimensions, window, weight = () => 1, onMatch }: BreakdownOptions<P>
): Record<string, Map<string, number>> {
    const totals: Record<string, Map<string, number>> = {};
    for (const d of dimensions) totals[d.key] = new Map();

    for (const point of points) {
        if (!inWindow(point, window)) continue;

        const failed = soleFailure(point, tests);
        if (failed === false) continue;

        const w = weight(point);
        for (const d of dimensions) {
            if (failed !== null && failed !== d.key) continue;
            const value = point[d.field] as string;
            if (value === '') continue;
            const map = totals[d.key];
            map.set(value, (map.get(value) ?? 0) + w);
        }
        if (failed === null) onMatch?.(point);
    }
    return totals;
}

/** The `limit` largest values as pie slices, the rest folded into "Other". */
export function topNSlices(totals: Map<string, number>, limit: number): DimensionSlice[] {
    const sorted = [...totals.entries()]
        .map(([value, total]) => ({ value, minutes: total, plays: total }))
        .sort((a, b) => b.plays - a.plays);
    const slices = sorted.slice(0, limit);
    const other = sorted.slice(limit).reduce((sum, s) => sum + s.plays, 0);
    if (other > 0) slices.push({ value: 'Other', minutes: other, plays: other });
    return slices;
}

/** DuckDB's DAYOFWEEK (0 = Sunday … 6 = Saturday) as a short name. */
export function dowLabel(value: string): string {
    const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const n = Number(value);
    return Number.isInteger(n) && n >= 0 && n < 7 ? names[n] : value;
}
