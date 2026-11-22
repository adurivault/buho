import type { RawTimelineEntry } from '#lib/data/sources/googleTimeline/types.ts';
import { buildAgenda, instant, meters, type Agenda, type LatLon, type Mode } from './agenda';
import { localDate, type LifeOptions } from './life';
import { Random } from './random';

/**
 * Where the demo person goes: a Google Timeline export, in the shape the phone
 * writes it, for the parser to read like any other.
 *
 * Read off the shared agenda: a stay is a visit, from the moment it starts to
 * the moment the next journey leaves, so a night at home is one visit across
 * midnight. A journey is an activity and the path the phone sampled along it,
 * on the streets the routing took — commutes by bike or by métro, runs round
 * the park, the walk home from the bar, the motorway to the parents', the
 * railway to Marseille. A few days a year the phone records nothing.
 */

export interface PlacesOptions extends LifeOptions {
    /** An agenda already built, so several samples can share one. */
    agenda?: Agenda;
}

/** Timeline's own words for each way of moving. */
const ACTIVITY: Record<Mode, string> = {
    walk: 'walking',
    run: 'running',
    bike: 'cycling',
    metro: 'in subway',
    car: 'in passenger vehicle',
    train: 'in train',
    plane: 'flying',
};

/**
 * How often the phone notes where it is along a journey, in seconds. The métro
 * is the exception: underground, the only fixes are the stations.
 */
const SAMPLE_SECONDS: Record<Exclude<Mode, 'metro'>, number> = {
    walk: 40,
    run: 30,
    bike: 25,
    car: 30,
    train: 120,
    plane: 240,
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

const geo = ([lat, lon]: LatLon) => `geo:${lat.toFixed(6)},${lon.toFixed(6)}`;

/** Metres covered at each vertex of a path, cached since routes are shared. */
const covered = new WeakMap<LatLon[], Float64Array>();
function distances(path: LatLon[]): Float64Array {
    let cumulative = covered.get(path);
    if (!cumulative) {
        cumulative = new Float64Array(path.length);
        for (let i = 1; i < path.length; i += 1) {
            cumulative[i] = cumulative[i - 1] + meters(path[i - 1], path[i]);
        }
        covered.set(path, cumulative);
    }
    return cumulative;
}

/** The point `d` metres along `path`, between its vertices. */
function along(path: LatLon[], cumulative: Float64Array, d: number): LatLon {
    let lo = 0;
    let hi = path.length - 1;
    while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (cumulative[mid] <= d) lo = mid;
        else hi = mid;
    }
    const span = cumulative[hi] - cumulative[lo];
    const t = span > 0 ? (d - cumulative[lo]) / span : 0;
    const [a, b] = [path[lo], path[hi]];
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/** The Timeline export of the shared life, oldest first. */
export function generateTimeline(options: PlacesOptions = {}): RawTimelineEntry[] {
    const agenda = options.agenda ?? buildAgenda(options);
    const untracked = new Set(agenda.days.filter((d) => d.untracked).map((d) => d.date));
    const random = new Random((options.seed ?? 20261122) + 2);
    // A phone's fix wanders a few metres either side of the street, so a route
    // taken every day draws a band rather than a hairline.
    const jitter = ([lat, lon]: LatLon, metres: number): LatLon => [
        lat + random.normal(0, metres / 111_000),
        lon + random.normal(0, metres / 73_000),
    ];
    const entries: RawTimelineEntry[] = [];

    for (const episode of agenda.episodes) {
        const start = instant(agenda, episode.from);
        const end = instant(agenda, episode.to);
        if (untracked.has(localDate(start))) continue;
        const startTime = iso(start);
        const endTime = iso(end);

        if (episode.type === 'stay') {
            const { id, lat, lon, semanticType } = episode.place;
            entries.push({
                startTime,
                endTime,
                visit: {
                    topCandidate: { placeLocation: geo([lat, lon]), placeID: id, semanticType },
                },
            });
            continue;
        }

        const { path, mode } = episode;
        if (path.length < 2) continue;
        entries.push({
            startTime,
            endTime,
            activity: {
                // Where the phone noticed the journey begin and end: near the
                // door, never twice on the same spot.
                start: geo(jitter(path[0], 12)),
                end: geo(jitter(path[path.length - 1], 12)),
                distanceMeters: String(Math.round(episode.meters)),
                topCandidate: { type: ACTIVITY[mode] },
            },
        });

        const seconds = (episode.to - episode.from) * 60;
        const points: { at: LatLon; second: number }[] = [];
        if (mode === 'metro') {
            // Underground: a fix at some of the stations, wherever the signal
            // came back on the platform, timed by the distance covered. The
            // two ends are the doors, already marked by the stays.
            const cumulative = distances(path);
            const total = Math.max(1, cumulative[cumulative.length - 1]);
            path.forEach((at, i) => {
                if (i === 0 || i === path.length - 1 || !random.bool(0.6)) return;
                points.push({ at: jitter(at, 25), second: (cumulative[i] / total) * seconds });
            });
        } else {
            // Every so often from wherever the clock happened to be when the
            // journey began, so two trips down the same street leave their
            // points in different places along it. The pace wavers too —
            // lights, a slope, a crowd — so the spacing is never quite even.
            const cumulative = distances(path);
            const total = cumulative[cumulative.length - 1];
            const step = SAMPLE_SECONDS[mode];
            const waver = random.range(0, 0.5);
            const cycles = random.int(1, 4);
            const progress = (x: number) =>
                x + (waver * Math.sin(2 * Math.PI * cycles * x)) / (2 * Math.PI * cycles);
            for (
                let t = random.range(0, step);
                t < seconds - step / 3;
                t += step * random.range(0.85, 1.15)
            ) {
                const at = along(path, cumulative, total * progress(t / seconds));
                points.push({
                    at: mode === 'plane' ? at : jitter(at, mode === 'train' ? 30 : 5),
                    second: t,
                });
            }
        }
        entries.push({
            startTime,
            endTime,
            timelinePath: points.map(({ at, second }) => ({
                point: geo(at),
                durationMinutesOffsetFromStartTime: String(Math.round(second / 60)),
            })),
        });
    }

    return entries;
}
