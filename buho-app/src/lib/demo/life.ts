import { Random } from './random';

/**
 * The days the watch, location and activity samples are invented from.
 *
 * One person, one calendar: the same holidays, the same cold, the same running
 * habit, so loading several samples fills the cross-module calendar with days
 * where the modules agree — the trip shows in the positions, in more steps
 * and in what was searched beforehand. Each sample used to stand alone, and
 * a calendar built from strangers had nothing to line up.
 *
 * The life is fixed by a seed and an end day, so every generator asking for
 * it gets the same one. It runs three years back; each sample takes as much of
 * it as it needs.
 */

export interface LifeOptions {
    seed?: number;
    /** The day the life ends. Defaults to today, like the other samples. */
    until?: Date;
}

/** A trip away from home: a stretch of days spent somewhere else. */
export interface Trip {
    name: string;
    lat: number;
    lon: number;
    /** First and last day away, local "YYYY-MM-DD". */
    from: string;
    to: string;
}

export type DayKind = 'work' | 'weekend' | 'holiday' | 'sick';

export interface LifeDay {
    /** Local midnight. */
    start: Date;
    /** Local "YYYY-MM-DD". */
    date: string;
    /** 0 is Sunday, as `Date.getDay()`. */
    weekday: number;
    kind: DayKind;
    /** Where the day is spent, when it is spent away. */
    trip: Trip | null;
    /** Whether the day has a run in it. */
    run: boolean;
    /** 0 → 1 as the running habit builds up; the resting heart rate follows it. */
    fitness: number;
}

export const LIFE_YEARS = 3;

/** Home, for every sample that needs one: Lyon, on the Croix-Rousse hill. */
export const HOME = { lat: 45.7745, lon: 4.832 };

/**
 * Where the holidays go. Real places, so the map labels them, all in the same
 * time zone as home so the wall clock never has to move.
 */
const DESTINATIONS = [
    { name: 'Barcelona', lat: 41.387, lon: 2.17 },
    { name: 'Marseille', lat: 43.2965, lon: 5.3698 },
    { name: 'Rome', lat: 41.9028, lon: 12.4964 },
    { name: 'Quiberon', lat: 47.484, lon: -3.119 },
    { name: 'Turin', lat: 45.0703, lon: 7.6869 },
    { name: 'Biarritz', lat: 43.4832, lon: -1.5586 },
] as const;

/** Christmas is at the parents', every year. */
const PARENTS = { name: 'Annecy', lat: 45.8992, lon: 6.1294 };

const pad = (n: number) => String(n).padStart(2, '0');

export function localDate(date: Date): string {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * The instant `minute` minutes into the day, on the local clock: a day that
 * changes to or from summer time is still midnight to midnight.
 */
export function atMinute(day: LifeDay, minute: number): Date {
    const { start } = day;
    return new Date(start.getFullYear(), start.getMonth(), start.getDate(), 0, Math.round(minute));
}

function addDays(date: Date, days: number): Date {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

/**
 * The trips of one year: a summer holiday, a spring long weekend, an autumn
 * city break and Christmas at the parents'.
 */
function tripsOf(year: number, random: Random, destinations: (typeof DESTINATIONS)[number][]) {
    const trip = (
        place: { name: string; lat: number; lon: number },
        first: Date,
        days: number
    ) => ({
        name: place.name,
        lat: place.lat,
        lon: place.lon,
        from: localDate(first),
        to: localDate(addDays(first, days - 1)),
    });

    const [summer, spring, autumn] = destinations;
    return [
        trip(spring, new Date(year, 4, random.int(1, 20)), random.int(3, 4)),
        trip(summer, new Date(year, 6, random.int(18, 31)), random.int(11, 15)),
        trip(autumn, new Date(year, 9, random.int(1, 22)), 4),
        trip(PARENTS, new Date(year, 11, random.int(21, 23)), random.int(7, 9)),
    ];
}

/** Every day of the life, oldest first. */
export function lifeDays(options: LifeOptions = {}): LifeDay[] {
    const { seed = 20261122, until = new Date() } = options;
    const random = new Random(seed);

    const last = new Date(until.getFullYear(), until.getMonth(), until.getDate());
    const first = addDays(last, -Math.round(LIFE_YEARS * 365.25));

    const trips: Trip[] = [];
    for (let year = first.getFullYear(); year <= last.getFullYear(); year += 1) {
        const order = random.shuffle([...DESTINATIONS]);
        trips.push(...tripsOf(year, random, order));
    }
    const tripOn = (date: string) => trips.find((t) => t.from <= date && date <= t.to) ?? null;

    // A cold every winter, four or five days in February.
    const colds = new Set<string>();
    for (let year = first.getFullYear(); year <= last.getFullYear(); year += 1) {
        const onset = new Date(year, 1, random.int(2, 20));
        for (let d = 0; d < random.int(4, 5); d += 1) colds.add(localDate(addDays(onset, d)));
    }

    // The running habit starts about ten months before the end: after the watch
    // arrives, so the resting heart rate can be seen coming down.
    const runningFrom = localDate(addDays(last, -random.int(290, 330)));

    const days: LifeDay[] = [];
    let runs = 0;
    for (let start = first; start <= last; start = addDays(start, 1)) {
        const date = localDate(start);
        const weekday = start.getDay();
        const trip = tripOn(date);
        const weekend = weekday === 0 || weekday === 6;
        const kind: DayKind = colds.has(date)
            ? 'sick'
            : trip
              ? 'holiday'
              : weekend
                ? 'weekend'
                : 'work';

        // Tuesday, Thursday and Sunday, most weeks; once in a while on holiday.
        const habitDay = weekday === 2 || weekday === 4 || weekday === 0;
        const run =
            date >= runningFrom &&
            kind !== 'sick' &&
            (kind === 'holiday' ? random.bool(0.2) : habitDay && random.bool(0.8));
        if (run) runs += 1;

        days.push({
            start,
            date,
            weekday,
            kind,
            trip,
            run,
            // A hundred runs in, the habit has done most of what it will do.
            fitness: 1 - Math.exp(-runs / 60),
        });
    }

    return days;
}
