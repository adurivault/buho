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

/** How faithfully the path keeps to the streets, in metres, before thinning. */
const TOLERANCE: Record<Mode, number> = {
    walk: 6,
    run: 6,
    bike: 8,
    metro: 1,
    car: 40,
    train: 200,
    plane: 1000,
};

/** At most this many points a minute, as a phone samples. */
const PER_MINUTE: Record<Mode, number> = {
    walk: 3,
    run: 4,
    bike: 4,
    metro: 1,
    car: 2,
    train: 0.5,
    plane: 0.5,
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

/** Distance from `p` to the segment `a`–`b`, in metres. */
function offTrack(p: LatLon, a: LatLon, b: LatLon): number {
    const span = (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2;
    if (span === 0) return meters(p, a);
    const t = Math.max(
        0,
        Math.min(1, ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / span)
    );
    return meters(p, [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]);
}

/** Douglas–Peucker: the fewest points that keep within `tolerance` of the path. */
function simplify(path: LatLon[], tolerance: number): LatLon[] {
    if (path.length <= 2) return path;
    const keep = new Uint8Array(path.length);
    keep[0] = keep[path.length - 1] = 1;
    const stack: [number, number][] = [[0, path.length - 1]];
    while (stack.length) {
        const [a, b] = stack.pop()!;
        let far = -1;
        let farthest = tolerance;
        for (let i = a + 1; i < b; i += 1) {
            const d = offTrack(path[i], path[a], path[b]);
            if (d > farthest) {
                farthest = d;
                far = i;
            }
        }
        if (far >= 0) {
            keep[far] = 1;
            stack.push([a, far], [far, b]);
        }
    }
    return path.filter((_, i) => keep[i]);
}

/** Points along every leg longer than `most` metres, so a long straight stretch is still sampled. */
function densify(path: LatLon[], most: number): LatLon[] {
    const out: LatLon[] = [path[0]];
    for (let i = 1; i < path.length; i += 1) {
        const [a, b] = [path[i - 1], path[i]];
        const parts = Math.ceil(meters(a, b) / most);
        for (let k = 1; k < parts; k += 1) {
            out.push([a[0] + ((b[0] - a[0]) * k) / parts, a[1] + ((b[1] - a[1]) * k) / parts]);
        }
        out.push(b);
    }
    return out;
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
                start: geo(path[0]),
                end: geo(path[path.length - 1]),
                distanceMeters: String(Math.round(episode.meters)),
                topCandidate: { type: ACTIVITY[mode] },
            },
        });

        // The points the phone kept along the way, timed by the distance covered.
        const minutes = episode.to - episode.from;
        // A flight is already a straight line; its points are where the phone saw it.
        let points = mode === 'plane' ? path : simplify(path, TOLERANCE[mode]);
        if (mode === 'train' || mode === 'car' || mode === 'plane') points = densify(points, 5_000);
        const most = Math.max(2, Math.round(minutes * PER_MINUTE[mode]));
        if (points.length > most) {
            const every = points.length / most;
            points = points.filter(
                (_, i) => i === points.length - 1 || Math.floor(i % every) === 0
            );
        }
        const total = Math.max(1, episode.meters);
        let covered = 0;
        entries.push({
            startTime,
            endTime,
            timelinePath: points.map((point, i) => {
                if (i > 0) covered += meters(points[i - 1], point);
                const ends = i === 0 || i === points.length - 1;
                return {
                    point: geo(
                        ends || mode === 'plane' ? point : jitter(point, mode === 'train' ? 30 : 5)
                    ),
                    durationMinutesOffsetFromStartTime: String(
                        Math.round((Math.min(covered, total) / total) * minutes)
                    ),
                };
            }),
        });
    }

    return entries;
}
