import { Random } from './random';

/**
 * The days the watch, location and activity samples are invented from.
 *
 * One person, one calendar: the same holidays, the same cold, the same nights
 * out, so loading several samples fills the cross-module calendar with days
 * where the modules agree — the trip shows in the positions, in the steps and
 * in what was searched beforehand.
 *
 * The life is deliberately uneven, because an even one draws a flat chart. It
 * runs four years in Paris and turns halfway: a first flat in the 11th and a
 * job by Saint-Lazare, then a move to the 13th, a few weeks between jobs, a new
 * one at Station F with two days a week at home, and a running habit that ends
 * in a half marathon. On top of that come seasons, nights out, museum
 * afternoons, hikes in Fontainebleau, four trips a year, a cold every winter
 * and three weeks without the watch.
 *
 * The life is fixed by a seed and an end day, so every generator asking for it
 * gets the same one.
 */

export interface LifeOptions {
    seed?: number;
    /** The day the life ends. Defaults to today, like the other samples. */
    until?: Date;
}

export type City = 'marseille' | 'rome' | 'barcelona' | 'biarritz' | 'quiberon' | 'annecy';
export type TripMode = 'train' | 'plane' | 'car';

/** A trip away from home: a stretch of days spent somewhere else. */
export interface Trip {
    city: City;
    name: string;
    lat: number;
    lon: number;
    mode: TripMode;
    /** First and last day away, local "YYYY-MM-DD". */
    from: string;
    to: string;
}

/**
 * - `work`: at the office. `remote`: working from home.
 * - `off`: a weekday with no work — between the two jobs.
 */
export type DayKind = 'work' | 'remote' | 'off' | 'weekend' | 'holiday' | 'sick';

/** What the day holds beyond its kind, decided once so every sample agrees. */
export type Outing = 'friends' | 'bar' | 'cinema' | 'museum' | 'market' | 'park' | 'hike';

export interface LifeDay {
    /** Local midnight. */
    start: Date;
    /** Local "YYYY-MM-DD". */
    date: string;
    /** 0 is Sunday, as `Date.getDay()`. */
    weekday: number;
    kind: DayKind;
    /** The first flat and job, or the second. */
    phase: 'A' | 'B';
    /** Where the day is spent, when it is spent away. */
    trip: Trip | null;
    /** What the day does besides; several on a weekend. */
    outings: Outing[];
    /** Out until well past midnight. */
    late: boolean;
    /** To work by bike rather than by métro or on foot. */
    bike: boolean;
    run: 'none' | 'short' | 'long' | 'race';
    /** 0 → 1 as the running habit builds up; the resting heart rate follows it. */
    fitness: number;
    /** The watch was lost for three weeks: no readings at all. */
    watchless: boolean;
    /** The phone's location history had a gap. */
    untracked: boolean;
}

export const LIFE_YEARS = 4;

const DESTINATIONS: Record<City, { name: string; lat: number; lon: number; mode: TripMode }> = {
    marseille: { name: 'Marseille', lat: 43.2958, lon: 5.3752, mode: 'train' },
    rome: { name: 'Rome', lat: 41.8955, lon: 12.492, mode: 'plane' },
    barcelona: { name: 'Barcelona', lat: 41.392, lon: 2.165, mode: 'plane' },
    biarritz: { name: 'Biarritz', lat: 43.483, lon: -1.559, mode: 'train' },
    quiberon: { name: 'Quiberon', lat: 47.4842, lon: -3.1192, mode: 'car' },
    annecy: { name: 'Annecy', lat: 45.9012, lon: 6.1205, mode: 'car' },
};

const pad = (n: number) => String(n).padStart(2, '0');

export function localDate(date: Date): string {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * The instant `minute` minutes into the day, on the local clock: a day that
 * changes to or from summer time is still midnight to midnight. Minutes past
 * 1440 run into the next day, which is how a late night is written.
 */
export function atMinute(day: LifeDay, minute: number): Date {
    const { start } = day;
    return new Date(start.getFullYear(), start.getMonth(), start.getDate(), 0, Math.round(minute));
}

function addDays(date: Date, days: number): Date {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

/** How warm and light the season is, 0 in January to 1 in July. */
export function summer(date: Date): number {
    return (1 - Math.cos(((date.getMonth() + date.getDate() / 31) / 12) * 2 * Math.PI)) / 2;
}

/** Every day of the life, oldest first. */
export function lifeDays(options: LifeOptions = {}): LifeDay[] {
    const { seed = 20261122, until = new Date() } = options;
    const random = new Random(seed);

    const last = new Date(until.getFullYear(), until.getMonth(), until.getDate());
    const first = addDays(last, -Math.round(LIFE_YEARS * 365.25));
    const ago = (days: number) => addDays(last, -days);

    // The turn: a move a little before halfway, the new job three weeks later.
    const movedOn = ago(random.int(620, 670));
    const moved = localDate(movedOn);
    const hired = localDate(addDays(movedOn, random.int(18, 24)));
    const runningFrom = localDate(ago(random.int(290, 320)));
    const race = localDate(ago(random.int(45, 70)));
    const lostOn = ago(random.int(190, 230));
    const watchLost = localDate(lostOn);
    const watchFound = localDate(addDays(lostOn, random.int(18, 24)));

    // Four trips a year: spring, summer, an autumn city, Christmas at the parents'.
    const trips: Trip[] = [];
    const trip = (city: City, start: Date, days: number) => {
        trips.push({
            city,
            ...DESTINATIONS[city],
            from: localDate(start),
            to: localDate(addDays(start, days - 1)),
        });
    };
    for (let year = first.getFullYear(); year <= last.getFullYear(); year += 1) {
        const spring = random.pick<City>(['quiberon', 'biarritz', 'marseille']);
        const july = random.pick<City>(
            (['rome', 'barcelona', 'biarritz', 'quiberon'] as City[]).filter((c) => c !== spring)
        );
        const autumn = random.pick<City>(
            (['marseille', 'rome', 'barcelona'] as City[]).filter((c) => c !== july)
        );
        trip(spring, new Date(year, 4, random.int(1, 22)), random.int(3, 5));
        trip(july, new Date(year, 6, random.int(10, 31)), random.int(10, 16));
        trip(autumn, new Date(year, 9, random.int(1, 24)), random.int(3, 5));
        trip('annecy', new Date(year, 11, random.int(21, 23)), random.int(7, 10));
    }
    const tripOn = (date: string) => trips.find((t) => t.from <= date && date <= t.to) ?? null;

    // A cold every winter; a few days a year the phone stops recording.
    const colds = new Set<string>();
    const untracked = new Set<string>();
    for (let year = first.getFullYear(); year <= last.getFullYear(); year += 1) {
        const onset = new Date(year, random.int(0, 2), random.int(1, 26));
        for (let d = random.int(3, 6); d > 0; d -= 1) colds.add(localDate(addDays(onset, d)));
        for (let k = 0; k < 4; k += 1) {
            untracked.add(localDate(new Date(year, random.int(0, 11), random.int(1, 28))));
        }
    }

    const days: LifeDay[] = [];
    let runs = 0;
    for (let start = first; start <= last; start = addDays(start, 1)) {
        const date = localDate(start);
        const weekday = start.getDay();
        const phase = date < moved ? 'A' : 'B';
        const away = tripOn(date);
        const weekend = weekday === 0 || weekday === 6;
        const warm = summer(start);

        let kind: DayKind;
        if (colds.has(date)) kind = 'sick';
        else if (away) kind = 'holiday';
        else if (weekend) kind = 'weekend';
        else if (date >= moved && date < hired) kind = 'off';
        else if (phase === 'B' && (weekday === 1 || weekday === 5)) kind = 'remote';
        else kind = 'work';

        // The plans, more of them when it is warm.
        const outings: Outing[] = [];
        let late = false;
        if (kind === 'work' || kind === 'remote' || kind === 'off') {
            const evening = weekday === 4 || weekday === 5 ? 0.35 : 0.12;
            if (random.bool(evening + 0.22 * warm)) {
                const plan = random.pick<Outing>(['bar', 'bar', 'friends', 'cinema']);
                outings.push(plan);
                late = plan === 'bar' && random.bool(0.45);
            }
            if (kind === 'off' && random.bool(0.6)) {
                outings.unshift(random.pick<Outing>(['museum', 'park']));
            }
        } else if (kind === 'weekend') {
            if (weekday === 6 && random.bool(0.55)) outings.push('market');
            if (random.bool(0.07 + 0.12 * warm)) outings.push('hike');
            else {
                const choice = random.weightedIndex([
                    0.25,
                    0.18,
                    0.1 + 0.4 * warm,
                    0.08,
                    0.4 - 0.25 * warm,
                ]);
                const afternoon = (['friends', 'museum', 'park', 'cinema', null] as const)[choice];
                if (afternoon) outings.push(afternoon);
            }
            if (weekday === 6 && random.bool(0.35)) {
                outings.push('bar');
                late = random.bool(0.65);
            }
        }

        // Tuesday and Thursday short, Sunday long, most weeks; the race once.
        let run: LifeDay['run'] = 'none';
        const running = date >= runningFrom;
        if (date === race) run = 'race';
        else if (running && kind !== 'sick' && kind !== 'holiday') {
            if (weekday === 0 && !outings.includes('hike') && random.bool(0.75)) run = 'long';
            else if ((weekday === 2 || weekday === 4) && random.bool(0.55 + 0.2 * warm)) {
                run = 'short';
            }
        } else if (running && kind === 'holiday' && random.bool(0.15)) run = 'short';
        if (run !== 'none') runs += 1;

        days.push({
            start,
            date,
            weekday,
            kind,
            phase,
            trip: away,
            outings,
            late,
            // By bike in the warm months, and more often from the second flat.
            bike: random.bool((phase === 'A' ? 0.15 : 0.35) + 0.45 * warm),
            run,
            // A hundred runs in, the habit has done most of what it will do.
            fitness: 1 - Math.exp(-runs / 60),
            watchless: date >= watchLost && date < watchFound,
            untracked: untracked.has(date),
        });
    }

    return days;
}
