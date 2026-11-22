/**
 * How the calendar prints each module's figures — on the cards, in the
 * tooltips, on the year buttons — and the order it lists the modules in.
 */
import type { ModuleId } from '#lib/data/modules.ts';
import type { Measure } from '#lib/data/sql/measure.ts';
import { formatDuration } from '#lib/utils/duration.ts';
import { SILENCE_IS_ZERO } from './days';
import { restingBpm, type DayTimeline } from './timeline';

/**
 * The order the calendar lists the modules in, in every view: places first,
 * the frame the rest of the day happened in, then the logs, then the body.
 */
export const CALENDAR_ORDER: ModuleId[] = [
    'positions',
    'listening',
    'messages',
    'activity',
    'steps',
    'health',
];

/** What a figure needs to be read out. */
export interface FigureContext {
    /** What listening counts — `listeningMeasure.measure`. */
    measure: Measure;
}

const count = (value: number) => Math.round(value).toLocaleString();

function plural(value: number, one: string, many = `${one}s`): string {
    return `${count(value)} ${Math.round(value) === 1 ? one : many}`;
}

/** A year's total in its module's unit — see `getYearSummaries`. */
export function yearTotalText(module: ModuleId, total: number, measure: Measure): string {
    switch (module) {
        case 'listening':
            return measure === 'plays' ? plural(total, 'play') : formatDuration(total);
        case 'positions':
            return `${count(total)} km`;
        case 'messages':
            return plural(total, 'message');
        case 'activity':
            return plural(total, 'entry', 'entries');
        case 'steps':
            return plural(total, 'step');
        case 'health':
            return plural(total, 'day');
    }
}

/**
 * A year's total as it sits under its lane's name, kept short — the name says
 * what is counted: "499 h", "3,456 km", "12,345". Health and plays keep their
 * unit, which the name alone would not give.
 */
export function laneTotalText(module: ModuleId, total: number, measure: Measure): string {
    switch (module) {
        case 'listening':
            return measure === 'plays' ? plural(total, 'play') : formatDuration(total);
        case 'positions':
            return `${count(total)} km`;
        case 'health':
            return plural(total, 'day');
        default:
            return count(total);
    }
}

/** A day's figure, the one it is ranked on — see `dailyFigures`. */
export function dayFigureText(module: ModuleId, value: number, context: FigureContext): string {
    switch (module) {
        case 'listening':
            return context.measure === 'plays' ? plural(value, 'play') : formatDuration(value);
        case 'positions':
            return `${(Math.round(value * 10) / 10).toLocaleString()} km`;
        case 'messages':
            return plural(value, 'message');
        case 'activity':
            return plural(value, 'entry', 'entries');
        case 'steps':
            return plural(value, 'step');
        case 'health':
            return plural(value, 'heartbeat');
    }
}

/**
 * A module's figure for the open day as it sits under its track's name, kept
 * short — the name says what is counted: "6.5 km", "1.5 h", "45". Null when it
 * recorded nothing that day (or is not loaded).
 *
 * Health is the one that does not print its ranking figure: a day's heart rate
 * reads best as the rate at rest (see `restingBpm`).
 */
export function dayTrackText(
    module: ModuleId,
    day: DayTimeline,
    context: FigureContext
): string | null {
    switch (module) {
        case 'positions': {
            if (!day.positions || day.positions.points.length === 0) return null;
            return dayFigureText('positions', day.positions.km, context);
        }
        case 'listening': {
            const plays = day.listening?.plays ?? [];
            if (plays.length === 0) return null;
            if (context.measure === 'plays') return plural(plays.length, 'play');
            return formatDuration(plays.reduce((sum, play) => sum + (play.minutes ?? 0), 0));
        }
        case 'messages': {
            const total = (day.messages ?? []).reduce((sum, row) => sum + row.count, 0);
            return total > 0 ? count(total) : null;
        }
        case 'activity': {
            const entries = day.activity?.length ?? 0;
            return entries > 0 ? count(entries) : null;
        }
        case 'steps': {
            const quarters = (day.steps ?? []).filter((value): value is number => value !== null);
            if (quarters.length === 0) return null;
            return count(quarters.reduce((sum, value) => sum + value, 0));
        }
        case 'health': {
            const bpm = day.heartRate ? restingBpm(day.heartRate.quarters) : null;
            return bpm === null ? null : `${bpm} bpm at rest`;
        }
    }
}

/**
 * What sits under a track's name on a day it holds nothing, so the name keeps
 * its place from one day to the next: zero for a log on a day its export
 * covers — no play, no message is a figure — and a dash for a recorder, or a
 * day the export does not reach, where nothing is known.
 */
export function emptyTrackText(module: ModuleId, covered: boolean, measure: Measure): string {
    if (!covered || !SILENCE_IS_ZERO[module]) return '—';
    if (module === 'listening') return measure === 'plays' ? '0 plays' : formatDuration(0);
    return '0';
}

/** What a year lane draws a bar of, for its name's tooltip. */
export function laneUnit(module: ModuleId, measure: Measure): string {
    switch (module) {
        case 'listening':
            return measure === 'plays' ? 'Plays a day' : 'Time listened a day';
        case 'positions':
            return 'Kilometres travelled a day, square-root scale';
        case 'messages':
            return 'Messages sent and received a day';
        case 'activity':
            return 'Google activity entries a day';
        case 'steps':
            return 'Steps a day';
        case 'health':
            return 'Heartbeats a day, the hours without the watch filled with the usual rate at that hour (grey); coloured by time in each heart-rate band';
    }
}

/**
 * The figure at the top of a parallel-coordinates axis, kept short — the axis
 * is already named below it: "3 h", "120 km", "250".
 */
export function axisTopText(module: ModuleId, top: number, measure: Measure): string {
    switch (module) {
        case 'listening':
            return measure === 'plays' ? count(top) : formatDuration(top);
        case 'positions':
            return `${count(top)} km`;
        default:
            return count(top);
    }
}
