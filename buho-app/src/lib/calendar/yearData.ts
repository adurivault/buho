/**
 * What the calendar reads of one year, module by module, and the one figure a
 * day each module is drawn and compared on.
 *
 * Pure (no DB, no DOM): `getYearData` fills it, {@link dailyFigures} turns it
 * into what `buildYearDays` lays out.
 */
import type { ModuleId } from '#lib/data/modules.ts';
import type { ColorStop } from '#lib/visualizations/signalGrid.ts';
import type { DayValue } from './days';
import type { DayBeats, ZoneDay } from './zones';

/** A day of positions: how far you went, and where you woke up. */
export interface PositionDay {
    /** 'YYYY-MM-DD' */
    date: string;
    /** Kilometres travelled — moving legs only, each on the day it started. */
    km: number;
    /** The city you were in at 04:00 that day, when it is known. */
    city: string | null;
}

/** The year's heart rate, split into the health explorer's bands, and its heartbeats. */
export interface HealthZones {
    /** The bands' edges and colours: the explorer's own ramp, over the whole history. */
    stops: ColorStop[];
    days: ZoneDay[];
    /** Each day's heartbeats, the hours without the watch filled in (see `dayBeats`). */
    beats: DayBeats[];
}

/**
 * One year of every module: an entry for each day it recorded something on,
 * and null for a module that is not loaded.
 */
export interface YearData {
    year: number;
    /** Minutes played a day — plays, under the plays measure. */
    listening: DayValue[] | null;
    positions: PositionDay[] | null;
    /** Messages sent and received a day. */
    messages: DayValue[] | null;
    /** Google activity entries a day. */
    activity: DayValue[] | null;
    /** Steps a day. */
    steps: DayValue[] | null;
    health: HealthZones | null;
}

/**
 * The year's cities, most days first: each city's rank, which is the colour it
 * takes on the city ribbon and in the day's places. Ties go by name, by code
 * point, so every machine draws the same colours.
 */
export function cityRanks(positions: PositionDay[]): Map<string, number> {
    const days = new Map<string, number>();
    for (const day of positions) {
        if (day.city) days.set(day.city, (days.get(day.city) ?? 0) + 1);
    }
    const order = [...days.entries()].sort(
        ([a, na], [b, nb]) => nb - na || (a < b ? -1 : a > b ? 1 : 0)
    );
    return new Map(order.map(([city], rank) => [city, rank]));
}

/**
 * Each loaded module's figure for each day — what the day is ranked on within
 * its year: time listened, kilometres, messages, entries, steps, and
 * heartbeats, the hours without the watch filled in (see `dayBeats`).
 */
export function dailyFigures(data: YearData): Partial<Record<ModuleId, DayValue[]>> {
    const figures: Partial<Record<ModuleId, DayValue[]>> = {};
    if (data.listening) figures.listening = data.listening;
    if (data.positions) {
        figures.positions = data.positions.map((day) => ({ date: day.date, value: day.km }));
    }
    if (data.messages) figures.messages = data.messages;
    if (data.activity) figures.activity = data.activity;
    if (data.steps) figures.steps = data.steps;
    if (data.health) {
        figures.health = data.health.beats.map((day) => ({ date: day.date, value: day.beats }));
    }
    return figures;
}
