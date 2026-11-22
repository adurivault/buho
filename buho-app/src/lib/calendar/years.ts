/**
 * The calendar's year picker: every year with anything in it, and for each one
 * a glyph of six bars — one per module, scaled to that module's best year.
 *
 * Pure (no DB, no DOM): it reads the per-year totals the calendar queries
 * return.
 */
import type { ModuleId } from '#lib/data/modules.ts';
import type { Coverage } from './days';

/** One module's year. */
export interface YearSummary {
    module: ModuleId;
    year: number;
    /** In the module's own unit — see `getYearSummaries`. */
    total: number;
    /** First and last day of the year the module recorded anything on, 'YYYY-MM-DD'. */
    firstDay: string;
    lastDay: string;
}

/** One module's bar on a year button. */
export interface YearGlyph {
    total: number;
    /**
     * `total` over the module's best year, 0–1: the bar's height.
     *
     * Each module against itself, never against the others — a year of steps
     * and a year of messages share no unit, so the glyph says which years
     * each service was used most, not which service was used most.
     */
    share: number;
    /** The first day, when the module started late enough in the year to say so. */
    from: string | null;
    /** The last day, when it stopped early enough to say so. */
    to: string | null;
}

export interface YearRow {
    year: number;
    /** Per module; absent where the module recorded nothing that year. */
    glyphs: Partial<Record<ModuleId, YearGlyph>>;
    /** The first and last day any module recorded that year; null for an empty year. */
    firstDay: string | null;
    lastDay: string | null;
    /** `lastDay`, when it is early enough to say so — "to 2 Nov". */
    to: string | null;
}

/**
 * Days of slack at either end of a year before it counts as partial.
 *
 * A history whose first message of the year is on the 3rd of January did not
 * start that year; one whose watch first synced in March did. Two weeks keeps
 * the holidays from flagging every year.
 */
export const PARTIAL_SLACK_DAYS = 14;

const DAY_MS = 86_400_000;

function epochOf(day: string): number {
    const [y, m, d] = day.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
}

/** Whether `day` falls later than the slack after the 1st of January. */
function startsLate(day: string, year: number, slack: number): boolean {
    return epochOf(day) - Date.UTC(year, 0, 1) > slack * DAY_MS;
}

/** Whether `day` falls earlier than the slack before the 31st of December. */
function endsEarly(day: string, year: number, slack: number): boolean {
    return Date.UTC(year, 11, 31) - epochOf(day) > slack * DAY_MS;
}

/**
 * Every year from the first to the last that holds anything, gaps included,
 * oldest first — a year nothing was recorded in keeps its place in the row.
 */
export function yearRows(summaries: YearSummary[], slack = PARTIAL_SLACK_DAYS): YearRow[] {
    if (summaries.length === 0) return [];

    const best = new Map<ModuleId, number>();
    for (const s of summaries) best.set(s.module, Math.max(best.get(s.module) ?? 0, s.total));

    const years = summaries.map((s) => s.year);
    const rows: YearRow[] = [];
    for (let year = Math.min(...years); year <= Math.max(...years); year++) {
        const glyphs: Partial<Record<ModuleId, YearGlyph>> = {};
        let firstDay: string | null = null;
        let lastDay: string | null = null;
        for (const s of summaries) {
            if (s.year !== year) continue;
            const top = best.get(s.module) ?? 0;
            glyphs[s.module] = {
                total: s.total,
                share: top > 0 ? s.total / top : 0,
                from: startsLate(s.firstDay, year, slack) ? s.firstDay : null,
                to: endsEarly(s.lastDay, year, slack) ? s.lastDay : null,
            };
            if (firstDay === null || s.firstDay < firstDay) firstDay = s.firstDay;
            if (lastDay === null || s.lastDay > lastDay) lastDay = s.lastDay;
        }
        rows.push({
            year,
            glyphs,
            firstDay,
            lastDay,
            to: lastDay !== null && endsEarly(lastDay, year, slack) ? lastDay : null,
        });
    }
    return rows;
}

/**
 * Each module's first and last day across every year — the span its export
 * covers, which is where a silent day starts meaning zero (see `buildYearDays`).
 */
export function coverageOf(summaries: YearSummary[]): Partial<Record<ModuleId, Coverage>> {
    const coverage: Partial<Record<ModuleId, Coverage>> = {};
    for (const s of summaries) {
        const span = coverage[s.module];
        coverage[s.module] = span
            ? {
                  first: s.firstDay < span.first ? s.firstDay : span.first,
                  last: s.lastDay > span.last ? s.lastDay : span.last,
              }
            : { first: s.firstDay, last: s.lastDay };
    }
    return coverage;
}
