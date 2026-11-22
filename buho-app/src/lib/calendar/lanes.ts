/**
 * The year's lanes — one row of daily bars per module — laid out: which rows
 * there are, where each sits, and what an empty row says. How tall a bar
 * stands is `scales.ts`.
 *
 * Pure (no DB, no DOM), so the canvas and the labels beside it place every row
 * from the same numbers.
 */
import type { ModuleId } from '#lib/data/modules.ts';
import type { Coverage, YearDays } from './days';
import type { YearData } from './yearData';
import { fullDay, monthDay } from './dates';

/** The row of month names above the lanes, in pixels. */
export const LANE_HEAD = 30;

/** Width of the lanes' labels column, in pixels. */
export const LANE_LABELS = 140;
/** Width of each lane's projection, between its label and its bars. */
export const LANE_PROJECTION = 48;
/**
 * Where the lanes' bars start: after the labels, the projections and a
 * breath. The week calendar under them starts there too, on the same days.
 */
export const LANE_LEFT = LANE_LABELS + LANE_PROJECTION + 8;

/** Plain bars; heart rate as stacked bands; the positions' city ribbon. */
export type LaneKind = 'bars' | 'zones' | 'city';

export interface LaneSpec {
    module: ModuleId;
    kind: LaneKind;
    /** Height in pixels. */
    height: number;
    /** Space above, in pixels. */
    gap: number;
}

/** Every lane in reading order (`CALENDAR_ORDER`), as drawn for a loaded module. */
export const LANE_SPECS: LaneSpec[] = [
    { module: 'positions', kind: 'bars', height: 44, gap: 0 },
    { module: 'positions', kind: 'city', height: 8, gap: 4 },
    { module: 'listening', kind: 'bars', height: 56, gap: 18 },
    { module: 'messages', kind: 'bars', height: 56, gap: 18 },
    { module: 'activity', kind: 'bars', height: 44, gap: 18 },
    { module: 'steps', kind: 'bars', height: 56, gap: 18 },
    { module: 'health', kind: 'zones', height: 44, gap: 18 },
];

/** A module that is not imported keeps a thin row, so the page says what it is missing. */
export const MISSING_LANE = { height: 16, gap: 12 };

export type LaneState = 'data' | 'empty' | 'missing';

export interface Lane extends LaneSpec {
    key: string;
    /** Distance from the top of the lanes, in pixels. */
    top: number;
    state: LaneState;
}

/**
 * Where each lane goes for the open year.
 *
 * @param hasData whether a loaded module's lane holds anything this year.
 */
export function layoutLanes(
    loaded: Record<ModuleId, boolean>,
    hasData: (spec: LaneSpec) => boolean
): { lanes: Lane[]; height: number } {
    const lanes: Lane[] = [];
    let top = 0;
    for (const spec of LANE_SPECS) {
        const missing = !loaded[spec.module];
        // The ribbon only adds a colour per day where a city is known: without
        // positions, or before any place has been named, it would be an empty
        // strip under the lane.
        if (spec.kind === 'city' && (missing || !hasData(spec))) continue;
        const height = missing ? MISSING_LANE.height : spec.height;
        const gap = lanes.length === 0 ? 0 : missing ? MISSING_LANE.gap : spec.gap;
        top += gap;
        lanes.push({
            ...spec,
            height,
            gap,
            key: `${spec.module}-${spec.kind}`,
            top,
            state: missing ? 'missing' : hasData(spec) ? 'data' : 'empty',
        });
        top += height;
    }
    return { lanes, height: top };
}

/** The open year's lanes: a lane holds data when anything it draws is known that year. */
export function layoutYear(
    loaded: Record<ModuleId, boolean>,
    days: YearDays,
    data: YearData
): { lanes: Lane[]; height: number } {
    return layoutLanes(loaded, (spec) => {
        if (spec.kind === 'zones') return (data.health?.days.length ?? 0) > 0;
        if (spec.kind === 'city') return (data.positions ?? []).some((d) => d.city !== null);
        return (days.values[spec.module] ?? []).some((v) => v !== null);
    });
}

/**
 * Where day `index`'s week stands on a track `width` pixels wide that gives
 * each of the year's `count` days its own column, as the lanes do: from the
 * left edge of its Monday's column to the right edge of its Sunday's. The
 * year's first and last weeks stay whole, so they reach a few columns past
 * the track's ends rather than come out thinner than the rest. `offset` is the
 * Monday-first weekday of the 1st of January. Rounded to whole pixels the way
 * the lanes' columns are, so a week's edges fall on the same pixels as its
 * days' bars.
 */
export function weekSpan(
    index: number,
    offset: number,
    count: number,
    width: number
): [number, number] {
    const monday = index - ((offset + index) % 7);
    const step = width / count;
    return [Math.floor(monday * step), Math.floor((monday + 7) * step)];
}

/** What the lane of a loaded module says in a year it holds nothing. */
export function emptyNote(coverage: Coverage | undefined, year: number): string {
    if (coverage && coverage.first > `${year}-12-31`) {
        return `Export starts ${fullDay(coverage.first)}`;
    }
    if (coverage && coverage.last < `${year}-01-01`) return `Export ends ${fullDay(coverage.last)}`;
    return `No record in ${year}`;
}

/**
 * The stretch of the year before a module's export starts, as a share of the
 * year, and what to write on it when there is room — none when it starts on
 * the 1st of January or before.
 */
export function leadIn(
    coverage: Coverage | undefined,
    year: number,
    dayCount: number,
    dayIndex: (day: string) => number
): { share: number; text: string } | null {
    if (!coverage || coverage.first <= `${year}-01-01` || coverage.first > `${year}-12-31`) {
        return null;
    }
    const share = dayIndex(coverage.first) / dayCount;
    return { share, text: share > 0.09 ? `Export starts ${monthDay(coverage.first)}` : '' };
}
