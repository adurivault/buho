import type { RawTimelineEntry } from '#lib/data/sources/googleTimeline/types.ts';
import {
    atMinute,
    HOME,
    lifeDays,
    localDate,
    type LifeDay,
    type LifeOptions,
    type Trip,
} from './life';
import { Random } from './random';

/**
 * Where the demo person goes: a Google Timeline export, in the shape the phone
 * writes it, for the parser to read like any other.
 *
 * A life in Lyon: home on the Croix-Rousse, an office at Part-Dieu, lunch near
 * it, runs round the Tête d'Or, a market on Saturday, friends across the river,
 * and the holidays from the shared calendar, reached by train. Real places, so
 * the zone attribution names them; invented visits.
 */

interface Place {
    id: string;
    lat: number;
    lon: number;
    semanticType?: string;
}

const PLACES = {
    home: { id: 'demo-home', ...HOME, semanticType: 'Home' },
    office: { id: 'demo-office', lat: 45.7609, lon: 4.8575, semanticType: 'Work' },
    lunch: { id: 'demo-lunch', lat: 45.7628, lon: 4.8532 },
    market: { id: 'demo-market', lat: 45.7672, lon: 4.8357 },
    friends: { id: 'demo-friends', lat: 45.7528, lon: 4.8431 },
    cinema: { id: 'demo-cinema', lat: 45.7413, lon: 4.8183 },
    station: { id: 'demo-station', lat: 45.7606, lon: 4.8596 },
} satisfies Record<string, Place>;

/** The middle of the Tête d'Or, which the runs go round. */
const PARK = { lat: 45.7772, lon: 4.855 };

type Mode = 'walking' | 'running' | 'in subway' | 'in train';

/** Kilometres per hour, door to door. */
const SPEED: Record<Mode, number> = {
    walking: 4.8,
    running: 10.5,
    'in subway': 18,
    'in train': 120,
};

const pad = (n: number) => String(n).padStart(2, '0');

/** "2024-03-01T08:30:00.000+01:00", as the phone writes it. */
function iso(date: Date): string {
    const offset = -date.getTimezoneOffset();
    const sign = offset < 0 ? '-' : '+';
    const abs = Math.abs(offset);
    const time = `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
    return `${localDate(date)}T${time}.000${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

const geo = (p: { lat: number; lon: number }) => `geo:${p.lat.toFixed(6)},${p.lon.toFixed(6)}`;

function meters(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
    const k = Math.PI / 180;
    const x = (b.lon - a.lon) * k * Math.cos(((a.lat + b.lat) / 2) * k);
    const y = (b.lat - a.lat) * k;
    return Math.sqrt(x * x + y * y) * 6_371_000;
}

/** A point `km` away in a random direction. */
function near(p: { lat: number; lon: number }, km: number, random: Random) {
    const angle = random.range(0, Math.PI * 2);
    const distance = random.range(0.2, 1) * km;
    return {
        lat: p.lat + (distance / 111) * Math.sin(angle),
        lon: p.lon + (distance / (111 * Math.cos((p.lat * Math.PI) / 180))) * Math.cos(angle),
    };
}

/** One day's timeline, written as it is lived: stays, and the moves between them. */
class DayWriter {
    readonly entries: RawTimelineEntry[] = [];
    private here: Place;
    private since: number;

    constructor(
        private readonly day: LifeDay,
        private readonly random: Random,
        start: Place
    ) {
        this.here = start;
        this.since = 0;
    }

    private at(minute: number): Date {
        return atMinute(this.day, minute);
    }

    /** Stay where you are until `minute`. */
    private stay(until: number) {
        if (until <= this.since) return;
        const { id, lat, lon, semanticType } = this.here;
        this.entries.push({
            startTime: iso(this.at(this.since)),
            endTime: iso(this.at(until)),
            visit: {
                topCandidate: { placeLocation: geo({ lat, lon }), placeID: id, semanticType },
            },
        });
        this.since = until;
    }

    /** Leave at `minute` for `to`, by `mode`, through `via`. */
    go(leave: number, to: Place, mode: Mode, via: { lat: number; lon: number }[] = []) {
        const stops = [this.here, ...via, to];
        let length = 0;
        for (let i = 1; i < stops.length; i += 1) length += meters(stops[i - 1], stops[i]);

        const minutes = Math.max(
            4,
            (length / 1000 / SPEED[mode]) * 60 + (mode === 'in subway' ? 8 : 0)
        );
        // Never before the last stay ends, and home before midnight where the
        // day allows it, so one day's entries never run into the next.
        const minute = Math.max(this.since, Math.min(leave, 24 * 60 - minutes - 10));
        this.stay(minute);
        const startTime = iso(this.at(minute));
        const endTime = iso(this.at(minute + minutes));

        this.entries.push({
            startTime,
            endTime,
            activity: {
                start: geo(this.here),
                end: geo(to),
                distanceMeters: String(Math.round(length)),
                topCandidate: { type: mode },
            },
        });

        // A point every few minutes along the way, a little off the straight
        // line, the way a phone samples a journey.
        const path: { point: string; durationMinutesOffsetFromStartTime: string }[] = [];
        const legs = stops.length - 1;
        const perLeg = Math.max(1, Math.round(minutes / 5 / legs));
        for (let leg = 0; leg < legs; leg += 1) {
            const a = stops[leg];
            const b = stops[leg + 1];
            for (let k = 0; k < perLeg; k += 1) {
                const t = k / perLeg;
                const wobble = mode === 'in train' ? 0.002 : 0.0004;
                path.push({
                    point: geo({
                        lat: a.lat + (b.lat - a.lat) * t + this.random.normal(0, wobble),
                        lon: a.lon + (b.lon - a.lon) * t + this.random.normal(0, wobble),
                    }),
                    durationMinutesOffsetFromStartTime: String(
                        Math.round(((leg + t) / legs) * minutes)
                    ),
                });
            }
        }
        path.push({
            point: geo(to),
            durationMinutesOffsetFromStartTime: String(Math.round(minutes)),
        });
        this.entries.push({ startTime, endTime, timelinePath: path });

        this.here = to;
        this.since = minute + minutes;
    }

    /** A loop round the park and back home. */
    run(minute: number) {
        const loop = Array.from({ length: 8 }, (_, i) => {
            const angle = (i / 8) * Math.PI * 2;
            return {
                lat: PARK.lat + 0.006 * Math.sin(angle),
                lon: PARK.lon + 0.009 * Math.cos(angle),
            };
        });
        this.go(minute, PLACES.home, 'running', loop);
    }

    /** Stay until midnight. */
    end() {
        this.stay(24 * 60);
    }

    get now(): number {
        return this.since;
    }

    get place(): Place {
        return this.here;
    }
}

/** A trip's places: where it sleeps, and what it goes to see. */
function tripPlaces(trip: Trip, random: Random) {
    const centre = { lat: trip.lat, lon: trip.lon };
    const hotel: Place = { id: `demo-stay-${trip.name}`, ...near(centre, 1.2, random) };
    const sights: Place[] = Array.from({ length: 6 }, (_, i) => ({
        id: `demo-${trip.name}-${i}`,
        ...near(centre, 3, random),
    }));
    return { hotel, sights };
}

function workDay(w: DayWriter, day: LifeDay, random: Random) {
    if (day.run) w.run(random.normal(7 * 60, 8));
    w.go(Math.max(w.now + 10, random.normal(8.1 * 60, 6)), PLACES.office, 'in subway');
    if (random.bool(0.5)) {
        w.go(random.normal(12.4 * 60, 8), PLACES.lunch, 'walking');
        w.go(w.now + random.range(35, 55), PLACES.office, 'walking');
    }
    w.go(Math.max(w.now + 30, random.normal(18.1 * 60, 15)), PLACES.home, 'in subway');
    if (random.bool(0.3)) {
        w.go(w.now + random.range(60, 120), PLACES.friends, 'in subway');
        w.go(w.now + random.range(120, 210), PLACES.home, 'in subway');
    }
}

function weekendDay(w: DayWriter, day: LifeDay, random: Random) {
    if (day.run) w.run(random.normal(10 * 60, 20));
    if (day.weekday === 6) {
        w.go(Math.max(w.now + 15, random.normal(10.5 * 60, 30)), PLACES.market, 'walking');
        w.go(w.now + random.range(40, 90), PLACES.home, 'walking');
    }
    const afternoon = random.pick([PLACES.friends, PLACES.cinema, null]);
    if (afternoon) {
        w.go(Math.max(w.now + 60, random.range(14, 17) * 60), afternoon, 'in subway');
        w.go(w.now + random.range(120, 300), PLACES.home, 'in subway');
    }
}

function holidayDay(
    w: DayWriter,
    day: LifeDay,
    random: Random,
    { hotel, sights }: ReturnType<typeof tripPlaces>,
    away: boolean
) {
    const trip = day.trip!;
    // The way there and back, by train from Part-Dieu. The way there is taken
    // on the first day spent well, which is not always the trip's first.
    if (!away) {
        w.go(random.normal(9 * 60, 30), PLACES.station, 'in subway');
        w.go(w.now + random.range(15, 30), hotel, 'in train');
    }
    if (day.date === trip.to) {
        w.go(Math.max(w.now + 60, random.normal(15 * 60, 60)), PLACES.station, 'in train');
        w.go(w.now + random.range(5, 15), PLACES.home, 'in subway');
        return;
    }
    if (!away) return;

    let minute = random.normal(9.8 * 60, 30);
    for (const sight of random.shuffle([...sights]).slice(0, random.int(3, 5))) {
        w.go(Math.max(w.now + 20, minute), sight, 'walking');
        minute = w.now + random.range(40, 150);
    }
    w.go(Math.max(w.now + 30, minute), hotel, 'walking');
}

/** The Timeline export of the last `years` of the shared life, oldest first. */
export function generateTimeline(options: LifeOptions = {}): RawTimelineEntry[] {
    const days = lifeDays(options);
    const random = new Random((options.seed ?? 20261122) + 2);

    const trips = new Map<Trip, ReturnType<typeof tripPlaces>>();
    const entries: RawTimelineEntry[] = [];
    let wakeAt: Place = PLACES.home;

    for (const day of days) {
        const writer = new DayWriter(day, random, wakeAt);

        // A cold on the last day of a trip delays the way home to the next.
        if (day.kind !== 'holiday' && meters(wakeAt, PLACES.home) > 50_000) {
            writer.go(random.normal(10 * 60, 30), PLACES.station, 'in train');
            writer.go(writer.now + 10, PLACES.home, 'in subway');
        }

        if (day.kind === 'holiday' && day.trip) {
            let places = trips.get(day.trip);
            if (!places) trips.set(day.trip, (places = tripPlaces(day.trip, random)));
            holidayDay(writer, day, random, places, wakeAt === places.hotel);
        } else if (day.kind === 'work') {
            workDay(writer, day, random);
        } else if (day.kind === 'weekend') {
            weekendDay(writer, day, random);
        }
        // A sick day is a day at home.

        writer.end();
        entries.push(...writer.entries);
        // Tomorrow starts wherever today ended.
        wakeAt = writer.place;
    }

    return entries;
}
