/**
 * Days as the calendar handles them: 'YYYY-MM-DD' strings, counted on UTC
 * midnights so that no timezone — the browser's, or a change of clocks — can
 * make a day vanish or repeat; put into words in the reader's own locale.
 */
import { isoDay } from './days';

const DAY_MS = 86_400_000;
const pad = (n: number) => String(n).padStart(2, '0');

function epochOf(day: string): number {
    const [y, m, d] = day.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
}

/** `day` moved by `delta` days. */
export function shiftDay(day: string, delta: number): string {
    return isoDay(epochOf(day) + delta * DAY_MS);
}

/** The same month and day in `year`; the 29th of February falls back to the 28th. */
export function sameDayIn(day: string, year: number): string {
    const month = Number(day.slice(5, 7)) - 1;
    const date = Number(day.slice(8, 10));
    const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    return isoDay(Date.UTC(year, month, Math.min(date, last)));
}

/** Position of `day` within its year, 0 for the 1st of January. */
export function dayOfYear(day: string): number {
    return Math.round((epochOf(day) - Date.UTC(Number(day.slice(0, 4)), 0, 1)) / DAY_MS);
}

/** Day of the week, Monday first: 0 for a Monday, 6 for a Sunday. */
export function weekdayFromMonday(day: string): number {
    return (new Date(epochOf(day)).getUTCDay() + 6) % 7;
}

/** The span of days a year recorded anything in. */
export interface DaySpan {
    firstDay: string | null;
    lastDay: string | null;
}

/**
 * The day to open in `year` when switching to it from `current`: the same date
 * if the year recorded anything around it, the year's last recorded day
 * otherwise — never a stretch of the year that holds nothing.
 */
export function dayInYear(current: string | null, year: number, span: DaySpan): string | null {
    if (!span.firstDay || !span.lastDay) return null;
    if (current) {
        const same = sameDayIn(current, year);
        if (same >= span.firstDay && same <= span.lastDay) return same;
    }
    return span.lastDay;
}

/** `day` moved by `delta`, or null where that leaves `[first, last]`. */
export function stepDay(day: string, delta: number, first: string, last: string): string | null {
    const next = shiftDay(day, delta);
    return next < first || next > last ? null : next;
}

/** 'HH:MM' of a minute of the day; the end of the day reads 24:00. */
export function clock(minutes: number): string {
    const m = Math.max(0, Math.min(1440, Math.floor(minutes)));
    return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}

/** The day as a local date, which is what the locale formatters read. */
function localDate(day: string): Date {
    const [y, m, d] = day.split('-').map(Number);
    return new Date(y, m - 1, d, 12);
}

/** "Mon 10 Mar", in the reader's locale. */
export function shortDay(day: string): string {
    return localDate(day).toLocaleDateString(undefined, {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
    });
}

/** "10 Mar", in the reader's locale. */
export function monthDay(day: string): string {
    return localDate(day).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/** "10 Mar 2025", in the reader's locale. */
export function fullDay(day: string): string {
    return localDate(day).toLocaleDateString(undefined, {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
    });
}

/** A month's short name, 0 for January. */
export function monthName(month: number): string {
    return new Date(2000, month, 1, 12).toLocaleDateString(undefined, { month: 'short' });
}

/** A weekday's short name, 0 for Monday. */
export function weekdayName(weekday: number): string {
    // The 1st of January 2024 was a Monday.
    return new Date(2024, 0, 1 + weekday, 12).toLocaleDateString(undefined, { weekday: 'short' });
}

/** "’25" — a year as its button says it. */
export function yearLabel(year: number): string {
    return `’${String(year).slice(-2)}`;
}
