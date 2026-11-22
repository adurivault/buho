import ROUTES from './routes.json';
import { atMinute, lifeDays, type LifeDay, type LifeOptions, type Trip } from './life';
import { Random } from './random';

/**
 * The life, hour by hour: every day of `life.ts` turned into stays and the
 * journeys between them, on real streets.
 *
 * The watch, the location history and the Google activity are all read off
 * this one agenda, so they agree to the minute: the run in the steps is the
 * loop on the map, the night out ends with a walk home at two, the hike is a
 * drive to Fontainebleau and twenty thousand steps.
 *
 * Journeys follow geometry fetched once from OpenStreetMap routing
 * (`scripts/fetch-demo-routes.mjs`, saved in `routes.json`): walks and rides
 * take the streets, the métro hops from station to station, trains run along
 * their lines, planes fly straight.
 *
 * Minutes count from the first day's local midnight, and run past 1440 into
 * the next day — `atMinute` turns them back into instants on the local clock.
 */

export type LatLon = [number, number];

export interface Place {
    id: string;
    lat: number;
    lon: number;
    /** Timeline's own labels, for the two places it knows by name. */
    semanticType?: 'Home' | 'Work';
}

/** What a stay is spent doing — the watch reads its rhythm off this. */
export type Activity =
    | 'sleep'
    | 'home'
    | 'work'
    | 'lunch'
    | 'friends'
    | 'bar'
    | 'cinema'
    | 'museum'
    | 'market'
    | 'park'
    | 'sight';

export type Mode = 'walk' | 'run' | 'bike' | 'metro' | 'car' | 'train' | 'plane';

export interface Stay {
    type: 'stay';
    from: number;
    to: number;
    place: Place;
    activity: Activity;
}

export interface Move {
    type: 'move';
    from: number;
    to: number;
    mode: Mode;
    /** The way taken, start to end. */
    path: LatLon[];
    /** Metres along the way. */
    meters: number;
    /** How hard: a race is run harder than an easy loop. */
    effort?: number;
}

export type Episode = Stay | Move;

export interface Agenda {
    days: LifeDay[];
    /** The first day's local midnight, which every minute counts from. */
    origin: LifeDay;
    episodes: Episode[];
}

/* ---------------------------------------------------------------- geometry */

function decodePolyline(encoded: string): LatLon[] {
    const points: LatLon[] = [];
    let index = 0;
    let lat = 0;
    let lon = 0;
    while (index < encoded.length) {
        for (const axis of [0, 1]) {
            let result = 0;
            let shift = 0;
            let byte: number;
            do {
                byte = encoded.charCodeAt(index++) - 63;
                result |= (byte & 0x1f) << shift;
                shift += 5;
            } while (byte >= 0x20);
            const delta = result & 1 ? ~(result >> 1) : result >> 1;
            if (axis === 0) lat += delta;
            else lon += delta;
        }
        points.push([lat / 1e5, lon / 1e5]);
    }
    return points;
}

export function meters(a: LatLon, b: LatLon): number {
    const k = Math.PI / 180;
    const x = (b[1] - a[1]) * k * Math.cos(((a[0] + b[0]) / 2) * k);
    const y = (b[0] - a[0]) * k;
    return Math.sqrt(x * x + y * y) * 6_371_000;
}

export function pathLength(path: LatLon[]): number {
    let total = 0;
    for (let i = 1; i < path.length; i += 1) total += meters(path[i - 1], path[i]);
    return total;
}

/** A smooth curve through `points`, a point every `step` metres or so. */
function smooth(points: LatLon[], step: number): LatLon[] {
    const out: LatLon[] = [];
    for (let i = 0; i < points.length - 1; i += 1) {
        const p0 = points[Math.max(0, i - 1)];
        const p1 = points[i];
        const p2 = points[i + 1];
        const p3 = points[Math.min(points.length - 1, i + 2)];
        const n = Math.max(1, Math.round(meters(p1, p2) / step));
        for (let k = 0; k < n; k += 1) {
            const t = k / n;
            const t2 = t * t;
            const t3 = t2 * t;
            const at = (axis: 0 | 1) =>
                0.5 *
                (2 * p1[axis] +
                    (-p0[axis] + p2[axis]) * t +
                    (2 * p0[axis] - 5 * p1[axis] + 4 * p2[axis] - p3[axis]) * t2 +
                    (-p0[axis] + 3 * p1[axis] - 3 * p2[axis] + p3[axis]) * t3);
            out.push([at(0), at(1)]);
        }
    }
    out.push(points[points.length - 1]);
    return out;
}

/* ------------------------------------------------------------------ places */

type PlaceKey = keyof typeof ROUTES.places;

const place = (key: PlaceKey): Place => {
    const [lat, lon] = ROUTES.places[key];
    const semanticType = key.startsWith('home')
        ? 'Home'
        : key.startsWith('office')
          ? 'Work'
          : undefined;
    return { id: `demo-${key}`, lat, lon, semanticType };
};

const at = (p: Place): LatLon => [p.lat, p.lon];

const tourStop = (trip: Trip, index: number): Place => {
    const [lat, lon] = ROUTES.tours[trip.city][index];
    return { id: `demo-${trip.city}-${index}`, lat, lon };
};

/** Where each trip arrives from, before the walk or the ride to where it sleeps. */
const ARRIVALS: Record<Trip['city'], LatLon | null> = {
    marseille: [43.3026, 5.3806],
    biarritz: [43.4597, -1.5454],
    rome: [41.8003, 12.2389],
    barcelona: [41.2974, 2.0833],
    quiberon: null,
    annecy: null,
};

/** The railway, station to station, for the two trips taken by train. */
const RAILS: Partial<Record<Trip['city'], LatLon[]>> = {
    marseille: [
        [48.8443, 2.3743],
        [48.66, 2.56],
        [47.83, 3.35],
        [46.765, 4.497],
        [46.283, 4.779],
        [45.721, 5.076],
        [44.991, 4.978],
        [44.37, 4.73],
        [43.922, 4.786],
        [43.455, 5.317],
        [43.3026, 5.3806],
    ],
    biarritz: [
        [48.8412, 2.32],
        [48.7256, 2.2605],
        [48.43, 1.82],
        [48.08, 1.14],
        [47.385, 0.69],
        [46.582, 0.333],
        [45.6534, 0.1652],
        [44.8257, -0.556],
        [44.2, -0.86],
        [43.7206, -1.0518],
        [43.4963, -1.4697],
        [43.4597, -1.5454],
    ],
};

/* ---------------------------------------------------------------- journeys */

const SPEED_KMH: Record<Mode, number> = {
    walk: 4.7,
    run: 10.5,
    bike: 15,
    metro: 22,
    car: 60,
    train: 220,
    plane: 650,
};

const routeCache = new Map<string, LatLon[]>();
function route(key: string): LatLon[] | null {
    if (routeCache.has(key)) return routeCache.get(key)!;
    const encoded = (ROUTES.routes as Record<string, string>)[key];
    if (!encoded) return null;
    const path = decodePolyline(encoded);
    routeCache.set(key, path);
    return path;
}

/** A métro ride: on foot to the station, station to station underground, on foot again. */
function metroPath(from: Place, to: Place, line: keyof typeof ROUTES.metro): LatLon[] {
    const stations = ROUTES.metro[line] as LatLon[];
    const nearest = (p: Place) =>
        stations.reduce(
            (best, s, i) => (meters(s, at(p)) < meters(stations[best], at(p)) ? i : best),
            0
        );
    const a = nearest(from);
    const b = nearest(to);
    const hops = a <= b ? stations.slice(a, b + 1) : stations.slice(b, a + 1).reverse();
    return [at(from), ...hops, at(to)];
}

/** Which line a métro journey takes, by the two ends. */
function lineFor(from: string, to: string): keyof typeof ROUTES.metro {
    const ends = `${from} ${to}`;
    if (ends.includes('officeA')) return 'line3';
    if (ends.includes('homeA')) return 'line2';
    if (ends.includes('gareDeLyon')) return 'line5';
    return 'line7';
}

interface Journey {
    mode: Mode;
    path: LatLon[];
}

/** The way from one named place to another, by `mode`. */
function journey(fromKey: PlaceKey, toKey: PlaceKey, mode: Mode, random?: Random): Journey {
    const from = place(fromKey);
    const to = place(toKey);
    if (mode === 'metro') return { mode, path: metroPath(from, to, lineFor(fromKey, toKey)) };
    const profile = mode === 'bike' ? 'bike' : mode === 'car' ? 'car' : 'foot';
    // The same trip is not always taken by the same streets.
    const key = `${profile}:${fromKey}>${toKey}`;
    const variants = [key, `${key}~1`, `${key}~2`].filter((k) => route(k));
    const chosen = variants.length > 1 && random ? random.pick(variants) : variants[0];
    const fetched = chosen ? route(chosen) : null;
    const path = fetched ??
        route(`${profile}:${toKey}>${fromKey}`)?.slice().reverse() ?? [at(from), at(to)];
    return { mode, path };
}

/** How to get from home to somewhere in town: on foot when close, else by bike or métro. */
function modeTo(home: PlaceKey, to: PlaceKey, random: Random): Mode {
    const distance = meters(at(place(home)), at(place(to)));
    if (to === 'pigalle' && random.bool(0.5)) return 'metro';
    if (distance < 1600) return 'walk';
    if (!route(`bike:${home}>${to}`)) return 'walk';
    return random.bool(distance > 3500 ? 0.85 : 0.6) ? 'bike' : 'walk';
}

/* ------------------------------------------------------------------ writer */

/**
 * Writes the agenda as it is lived: wherever the person is, they stay until
 * the next journey, so a night at home runs from the evening to the morning as
 * one stay instead of being cut at midnight.
 */
class Writer {
    readonly episodes: Episode[] = [];
    here: Place;
    since = 0;
    doing: Activity = 'sleep';

    constructor(start: Place) {
        this.here = start;
    }

    /** Spend the time until `minute` here, doing what was being done. */
    stayUntil(minute: number, next?: Activity) {
        if (minute > this.since) {
            this.episodes.push({
                type: 'stay',
                from: this.since,
                to: minute,
                place: this.here,
                activity: this.doing,
            });
            this.since = minute;
        }
        if (next) this.doing = next;
    }

    /** Change what is being done, without going anywhere. */
    switchTo(minute: number, activity: Activity) {
        this.stayUntil(minute, activity);
    }

    /** Leave at `minute` for `to`, arriving to do `then`. */
    go(minute: number, to: Place, { mode, path }: Journey, then: Activity, effort?: number) {
        const start = Math.max(minute, this.since);
        this.stayUntil(start);
        const length = pathLength(path);
        const wait = mode === 'metro' ? 6 : mode === 'plane' ? 150 : mode === 'train' ? 20 : 0;
        const pace = effort ? SPEED_KMH[mode] * (0.85 + 0.35 * effort) : SPEED_KMH[mode];
        const minutes = Math.max(3, (length / 1000 / pace) * 60 + wait);
        this.episodes.push({
            type: 'move',
            from: start,
            to: start + minutes,
            mode,
            path,
            meters: length,
            effort,
        });
        this.here = to;
        this.since = start + minutes;
        this.doing = then;
    }
}

/* --------------------------------------------------------------- the days */

export function buildAgenda(options: LifeOptions = {}): Agenda {
    const days = lifeDays(options);
    const random = new Random((options.seed ?? 20261122) + 7);
    const w = new Writer(place('homeA'));
    let late = false;
    /** How far into each trip's tour the sightseeing has got. */
    const toured = new Map<Trip, number>();

    days.forEach((day, index) => {
        const base = index * 1440;
        const m = (hour: number) => base + hour * 60;
        const home: PlaceKey = day.phase === 'A' ? 'homeA' : 'homeB';
        const office: PlaceKey = day.phase === 'A' ? 'officeA' : 'officeB';
        const lunch: PlaceKey = day.phase === 'A' ? 'lunchA' : 'lunchB';
        const bar: PlaceKey = day.phase === 'A' ? 'barA' : 'barB';
        const cinema: PlaceKey = day.phase === 'A' ? 'cinemaA' : 'cinemaB';

        // The move: the first morning in the new flat is a drive across town.
        if (day.phase === 'B' && w.here.id === 'demo-homeA' && day.kind !== 'holiday') {
            w.switchTo(m(9), 'home');
            w.go(m(10), place('homeB'), journey('homeA', 'homeB', 'car'), 'home');
        }

        const weekend = day.kind === 'weekend' || day.kind === 'holiday';
        const wake = late
            ? m(random.normal(9.6, 0.6))
            : weekend || day.kind === 'off' || day.kind === 'sick'
              ? m(random.normal(9, 0.7))
              : m(random.normal(day.kind === 'remote' ? 7.9 : 7.2, 0.25));
        w.switchTo(wake, 'home');
        late = false;

        const run = (hour: number) => {
            if (day.run === 'none' || day.trip) return;
            const key = day.run === 'short' ? 'runB' : 'longRunB';
            const loop = route(`foot:${key}`) ?? [at(w.here), at(w.here)];
            const effort =
                day.run === 'race' ? 1 : day.run === 'long' ? 0.55 : 0.6 + 0.3 * random.float();
            // The race is a half marathon: the long loop, twice and a half.
            const path =
                day.run === 'race'
                    ? [...loop, ...loop, ...loop.slice(0, Math.floor(loop.length / 2))]
                    : loop;
            w.go(m(hour), place(home), { mode: 'run', path }, 'home', effort);
        };

        /** Out to `to` for `activity`, back home `minutes` later. */
        const outing = (from: number, to: PlaceKey, activity: Activity, back: number) => {
            const mode = modeTo(home, to, random);
            w.go(from, place(to), journey(home, to, mode, random), activity);
            w.go(back, place(home), journey(to, home, mode, random), 'home');
        };

        const evening = (from: number) => {
            for (const plan of day.outings) {
                const leave = Math.max(from, m(random.range(19.5, 20.8)));
                if (plan === 'bar') {
                    const where: PlaceKey = random.bool(0.55)
                        ? bar
                        : random.pick<PlaceKey>(['canal', 'bastille', 'marais', 'montmartre']);
                    const until = day.late ? random.range(25, 26.8) : random.range(22.8, 23.9);
                    outing(leave, where, 'bar', m(until));
                    late = day.late;
                } else if (plan === 'friends') {
                    const near: PlaceKey = day.phase === 'A' ? 'belleville' : 'montparnasseFriends';
                    const where = random.pick<PlaceKey>([
                        near,
                        near,
                        'pigalle',
                        'batignolles',
                        'saintGermain',
                        'marais',
                    ]);
                    outing(leave, where, 'friends', m(random.range(23, 24.3)));
                } else if (plan === 'cinema') {
                    const mode: Mode = day.phase === 'A' ? 'bike' : 'walk';
                    w.go(leave, place(cinema), journey(home, cinema, mode, random), 'cinema');
                    w.go(
                        w.since + random.range(120, 160),
                        place(home),
                        journey(cinema, home, mode, random),
                        'home'
                    );
                }
            }
        };

        switch (day.kind) {
            case 'work': {
                if (day.phase === 'B' && day.run === 'short') run(random.range(6.6, 7) - 0.0);
                const mode: Mode = day.bike ? 'bike' : day.phase === 'A' ? 'metro' : 'walk';
                w.go(
                    Math.max(w.since + 25, m(random.normal(8.4, 0.25))),
                    place(office),
                    journey(home, office, mode, random),
                    'work'
                );
                if (random.bool(0.7)) {
                    w.go(
                        m(random.normal(12.5, 0.2)),
                        place(lunch),
                        journey(office, lunch, 'walk'),
                        'lunch'
                    );
                    w.go(
                        w.since + random.range(35, 60),
                        place(office),
                        journey(lunch, office, 'walk'),
                        'work'
                    );
                }
                w.go(
                    m(random.normal(18.5, 0.45)),
                    place(home),
                    journey(office, home, mode, random),
                    'home'
                );
                evening(w.since + 40);
                break;
            }
            case 'remote':
            case 'off': {
                if (day.run === 'short') run(random.range(7.8, 9));
                if (day.kind === 'remote') {
                    // A break at lunch: the bakery and back.
                    w.go(
                        m(random.range(12.5, 13.3)),
                        place(bar),
                        journey(home, bar, 'walk'),
                        'market'
                    );
                    w.go(
                        w.since + random.range(8, 20),
                        place(home),
                        journey(bar, home, 'walk'),
                        'home'
                    );
                } else if (day.outings[0] === 'museum') {
                    museum(w, m(random.range(13, 14.5)), home, random);
                } else if (day.outings[0] === 'park') {
                    park(w, m(random.range(14, 15.5)), home, day, random);
                }
                evening(w.since + 60);
                break;
            }
            case 'weekend': {
                if (day.run === 'long' || day.run === 'race') run(random.range(9.5, 10.5));
                if (day.outings.includes('market')) {
                    const mode: Mode = day.phase === 'A' ? 'walk' : 'bike';
                    w.go(
                        Math.max(w.since + 20, m(random.range(10.3, 11.2))),
                        place('market'),
                        journey(home, 'market', mode, random),
                        'market'
                    );
                    w.go(
                        w.since + random.range(45, 80),
                        place(home),
                        journey('market', home, mode),
                        'home'
                    );
                }
                if (day.outings.includes('hike')) {
                    w.go(
                        Math.max(w.since + 20, m(random.range(8.5, 9.5))),
                        place('franchard'),
                        journey(home, 'franchard', 'car'),
                        'park'
                    );
                    const loop = route('foot:hikeFranchard') ?? [];
                    w.go(
                        w.since + random.range(10, 25),
                        place('franchard'),
                        { mode: 'walk', path: loop },
                        'park'
                    );
                    w.switchTo(w.since + random.range(40, 70), 'park');
                    w.go(
                        w.since + random.range(30, 60),
                        place('franchard'),
                        { mode: 'walk', path: loop.slice().reverse() },
                        'park'
                    );
                    w.go(
                        w.since + random.range(15, 40),
                        place(home),
                        journey('franchard', home, 'car'),
                        'home'
                    );
                }
                if (day.outings.includes('museum'))
                    museum(w, m(random.range(14, 15)), home, random);
                if (day.outings.includes('park'))
                    park(w, m(random.range(14.5, 16)), home, day, random);
                if (day.outings.includes('friends') || day.outings.includes('cinema')) {
                    evening(Math.max(w.since + 60, m(random.range(15, 18))));
                } else if (day.outings.includes('bar')) {
                    evening(w.since + 60);
                }
                break;
            }
            case 'holiday': {
                holiday(w, day, base, home, toured, random);
                break;
            }
            case 'sick': {
                if (random.bool(0.5)) {
                    // The pharmacy, round the corner.
                    w.go(m(random.range(11, 16)), place(bar), journey(home, bar, 'walk'), 'market');
                    w.go(
                        w.since + random.range(5, 12),
                        place(home),
                        journey(bar, home, 'walk'),
                        'home'
                    );
                }
                break;
            }
        }

        // Bed, unless the night is still going.
        if (!late) {
            const bedtime = weekend ? random.normal(24.2, 0.6) : random.normal(23.4, 0.45);
            w.switchTo(Math.max(w.since + 20, m(bedtime)), 'sleep');
        } else {
            w.switchTo(w.since + 15, 'sleep');
        }
    });

    w.stayUntil(days.length * 1440);
    return { days, origin: days[0], episodes: w.episodes };
}

/** An afternoon at a museum, on foot from home and back by bike. */
function museum(w: Writer, minute: number, home: PlaceKey, random: Random) {
    if (home === 'homeA') {
        w.go(minute, place('pompidou'), journey('homeA', 'pompidou', 'walk'), 'museum');
        w.go(
            w.since + random.range(70, 110),
            place('louvre'),
            journey('pompidou', 'louvre', 'walk'),
            'museum'
        );
        w.go(
            w.since + random.range(90, 150),
            place('homeA'),
            journey('louvre', 'homeA', 'walk'),
            'home'
        );
    } else {
        w.go(minute, place('luxembourg'), journey('homeB', 'luxembourg', 'walk'), 'park');
        w.go(
            w.since + random.range(30, 60),
            place('orsay'),
            journey('luxembourg', 'orsay', 'walk'),
            'museum'
        );
        w.go(
            w.since + random.range(90, 150),
            place('homeB'),
            journey('orsay', 'homeB', 'bike'),
            'home'
        );
    }
}

/** A walk in a park: the Bois de Vincennes by bike, or round the corner. */
function park(w: Writer, minute: number, home: PlaceKey, day: LifeDay, random: Random) {
    const choice = random.weightedIndex([0.3, 0.25, 0.45]);
    if (choice === 0) {
        w.go(minute, place('vincennes'), journey(home, 'vincennes', 'bike', random), 'park');
        const loop = route('foot:walkVincennesA') ?? [];
        w.go(
            w.since + random.range(5, 15),
            place('vincennes'),
            { mode: 'walk', path: loop },
            'park'
        );
        w.go(
            w.since + random.range(15, 50),
            place(home),
            journey('vincennes', home, 'bike', random),
            'home'
        );
    } else if (choice === 1) {
        const loop = route(day.phase === 'A' ? 'foot:runA' : 'foot:runB') ?? [];
        w.go(minute, place(home), { mode: 'walk', path: loop }, 'home');
    } else {
        // An afternoon in one of the parks across town.
        const where = random.pick<PlaceKey>([
            'buttesS',
            'monceau',
            'villette',
            'pereLachaise',
            'luxembourg',
            'bercyVillage',
        ]);
        const mode = modeTo(home, where, random);
        w.go(minute, place(where), journey(home, where, mode, random), 'park');
        w.go(
            w.since + random.range(50, 140),
            place(home),
            journey(where, home, mode, random),
            'home'
        );
    }
}

/** A day of a trip: getting there, seeing it, or getting back. */
function holiday(
    w: Writer,
    day: LifeDay,
    base: number,
    home: PlaceKey,
    toured: Map<Trip, number>,
    random: Random
) {
    const trip = day.trip!;
    const m = (hour: number) => base + hour * 60;
    const stay = tourStop(trip, 0);
    const first = day.date === trip.from;
    const last = day.date === trip.to;
    const there = meters(at(w.here), [trip.lat, trip.lon]) < 30_000;

    if (!there && !last) {
        travel(w, m(random.range(8, 11)), trip, home, 'out', random);
        return;
    }
    if (last) {
        if (there) travel(w, m(random.range(11, 15)), trip, home, 'back', random);
        return;
    }
    if (first) return;

    // Sightseeing: the next few stops of the tour, then back to where it sleeps.
    const stops = ROUTES.tours[trip.city].length;
    let next = toured.get(trip) ?? 1;
    if (next >= stops) next = 1;
    const count = Math.min(stops - next, random.int(3, 5));
    let minute = m(random.range(9.8, 10.8));
    let from = 0;
    for (let k = 0; k < count; k += 1) {
        const to = next + k;
        const key = from === 0 ? `foot:${trip.city}:${to}>0` : `foot:${trip.city}:${from}>${to}`;
        const path =
            from === 0
                ? (route(key)?.slice().reverse() ?? [at(stay), at(tourStop(trip, to))])
                : (route(key) ?? [at(tourStop(trip, from)), at(tourStop(trip, to))]);
        w.go(minute, tourStop(trip, to), { mode: 'walk', path }, 'sight');
        minute = w.since + random.range(40, 140);
        from = to;
    }
    toured.set(trip, next + count);
    const back = route(`foot:${trip.city}:${from}>0`) ?? [at(w.here), at(stay)];
    w.go(minute, stay, { mode: 'walk', path: back }, 'home');
}

/** The way to a trip and back: train, plane or car, and the last stretch to the bed. */
function travel(
    w: Writer,
    minute: number,
    trip: Trip,
    home: PlaceKey,
    way: 'out' | 'back',
    random: Random
) {
    const stay = tourStop(trip, 0);
    const homePlace = place(home);
    const arrival = ARRIVALS[trip.city];
    const flip = <T>(items: T[]) => (way === 'out' ? items : items.slice().reverse());

    if (trip.mode === 'car') {
        const key = trip.city === 'annecy' ? 'parents' : 'quiberon';
        const path = route(`car:${home}>${key}`) ?? [at(homePlace), at(stay)];
        w.go(minute, way === 'out' ? stay : homePlace, { mode: 'car', path: flip(path) }, 'home');
        return;
    }

    if (trip.mode === 'train') {
        const station: PlaceKey = trip.city === 'marseille' ? 'gareDeLyon' : 'montparnasse';
        const rail = smooth(RAILS[trip.city]!, 4000);
        const toStation = journey(
            home,
            station,
            home === 'homeA' && station === 'montparnasse' ? 'bike' : 'walk'
        );
        const arrivalPlace: Place = {
            id: `demo-${trip.city}-station`,
            lat: arrival![0],
            lon: arrival![1],
        };
        if (way === 'out') {
            w.go(minute, place(station), toStation, 'home');
            w.go(
                w.since + random.range(15, 30),
                arrivalPlace,
                { mode: 'train', path: rail },
                'home'
            );
            w.go(w.since + 5, stay, lastStretch(trip, 'out'), 'home');
        } else {
            w.go(minute, arrivalPlace, lastStretch(trip, 'back'), 'home');
            w.go(
                w.since + random.range(15, 30),
                place(station),
                { mode: 'train', path: rail.slice().reverse() },
                'home'
            );
            w.go(
                w.since + 5,
                homePlace,
                { mode: toStation.mode, path: toStation.path.slice().reverse() },
                'home'
            );
        }
        return;
    }

    // By plane, from Orly, a taxi each end.
    const orly = place('orly');
    const airport: Place = { id: `demo-${trip.city}-airport`, lat: arrival![0], lon: arrival![1] };
    const flight = smooth([at(orly), at(airport)], 25_000);
    if (way === 'out') {
        w.go(minute, orly, journey(home, 'orly', 'car'), 'home');
        w.go(w.since + random.range(60, 100), airport, { mode: 'plane', path: flight }, 'home');
        w.go(w.since + random.range(20, 40), stay, lastStretch(trip, 'out'), 'home');
    } else {
        w.go(minute, airport, lastStretch(trip, 'back'), 'home');
        w.go(
            w.since + random.range(60, 100),
            orly,
            { mode: 'plane', path: flight.slice().reverse() },
            'home'
        );
        w.go(w.since + random.range(15, 30), place(home), journey('orly', home, 'car'), 'home');
    }
}

/** From the station or the airport to where the trip sleeps. */
function lastStretch(trip: Trip, way: 'out' | 'back'): Journey {
    const fetched = route(`arrive:${trip.city}`);
    const stay = tourStop(trip, 0);
    const path = fetched ?? [ARRIVALS[trip.city]!, at(stay)];
    const mode: Mode = trip.city === 'marseille' ? 'walk' : 'car';
    return { mode, path: way === 'out' ? path : path.slice().reverse() };
}

/** The instant a minute of the agenda falls on. */
export function instant(agenda: Agenda, minute: number): Date {
    return atMinute(agenda.origin, minute);
}
