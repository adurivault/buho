import type { RawMyActivityEntry } from '#lib/types/googleActivity.ts';
import { DEMO_ARTISTS } from './catalog';
import { atMinute, HOME, lifeDays, type LifeDay, type LifeOptions } from './life';
import { Random, zipfWeights } from './random';

/**
 * What the demo person watched, searched and looked up: the "My Activity"
 * files of a Google Takeout, entry by entry, for the parser to read like any
 * other.
 *
 * It follows the shared calendar. The trips are searched for in the weeks
 * before them and mapped while they last, the running videos start when the
 * running does, a cold fills an afternoon with YouTube, and the music videos
 * are by the artists the listening sample plays. The channels, videos and
 * queries are invented.
 */

const OFFICE = { lat: 45.7609, lon: 4.8575 };

interface Video {
    title: string;
    channel: string;
    id: string;
    /** Only watched once the running habit has started. */
    running?: boolean;
}

const CHANNELS: Record<string, string[]> = {
    'Kitchen Notes': [
        'Five-ingredient risotto',
        'The proper French omelette',
        'Sourdough from scratch, day by day',
        'Knife skills in ten minutes',
        'Weeknight curry for two',
        'Why your pasta water matters',
        'Three sauces every cook should know',
        'Roasting vegetables properly',
    ],
    'Why Things Work': [
        'How tides work',
        'Why the sky turns red at dusk',
        'How a lock actually opens',
        'The physics of a bicycle',
        'Where the moon came from',
        'How noise-cancelling works',
        'Why ice floats',
    ],
    'Byte Size': [
        'Your first home server',
        'Mechanical keyboards, explained',
        'Backups you will actually keep',
        'How the internet reaches your flat',
        'Three tools I use every day',
    ],
    'City Walks': [
        'Lyon traboules, end to end',
        'A morning on the Croix-Rousse',
        'The Saône at night',
        'Old Lyon in the rain',
    ],
};

const RUNNING = [
    'Half marathon plan, week by week',
    'How to breathe when you run',
    'Easy runs: slower than you think',
    'Running shoes, what actually matters',
    'Stretching after a long run',
    'Hills without suffering',
];

/** Everyday searches, with a weight for how often they come back. */
const SEARCHES: [string, number][] = [
    ['weather lyon', 8],
    ['tcl metro times', 3],
    ['what to cook tonight', 3],
    ['cinema lyon showtimes', 2],
    ['pharmacy open sunday lyon', 1],
    ['how long to boil an egg', 1],
    ['exchange rate euro pound', 1],
    ['bike repair croix rousse', 1],
    ['lyon events this weekend', 2],
    ['best ramen lyon', 1],
    ['translate dépannage', 1],
    ['football results', 2],
];

const RUN_SEARCHES = [
    '10k training plan',
    'running cadence',
    'lyon half marathon date',
    'shin splints',
];
const SICK_SEARCHES = ['fever how many days', 'sore throat remedy', 'is it a cold or flu'];

const MAPS_LYON: [string, { lat: number; lon: number }][] = [
    ['Gare Part-Dieu', { lat: 45.7606, lon: 4.8596 }],
    ["Parc de la Tête d'Or", { lat: 45.7772, lon: 4.855 }],
    ['Musée des Confluences', { lat: 45.7326, lon: 4.8183 }],
    ['Halles de Lyon Paul Bocuse', { lat: 45.7633, lon: 4.8506 }],
    ['Fourvière', { lat: 45.7622, lon: 4.8222 }],
];

/** Every video the person might watch, the music ones from the listening sample's artists. */
function videoCatalog(random: Random): Video[] {
    let next = 0;
    const id = () => `demo${(next++).toString(36).padStart(6, '0')}`;
    const videos: Video[] = [];

    for (const [channel, titles] of Object.entries(CHANNELS)) {
        for (const title of titles) videos.push({ title, channel, id: id() });
    }
    for (const title of RUNNING)
        videos.push({ title, channel: 'Run Easy', id: id(), running: true });
    for (const artist of random.shuffle([...DEMO_ARTISTS]).slice(0, 30)) {
        videos.push({
            title: `${artist.name} – ${random.pick(artist.albums)} (full album)`,
            channel: artist.name,
            id: id(),
        });
    }
    return random.shuffle(videos);
}

const channelUrl = (name: string) =>
    `https://www.youtube.com/channel/demo-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

const searchUrl = (query: string) =>
    `https://www.google.com/search?q=${encodeURIComponent(query).replace(/%20/g, '+')}`;

/** Where the person was, in the form Takeout attaches to an entry. */
function locationInfos(at: { lat: number; lon: number }) {
    return [
        {
            name: 'At this general area',
            url: `https://www.google.com/maps/@?api=1&map_action=map&center=${at.lat.toFixed(6)},${at.lon.toFixed(6)}&zoom=12`,
            source: 'From your device',
        },
    ];
}

/** Every entry of the last three years of the shared life, oldest first. */
export function generateMyActivity(options: LifeOptions = {}): RawMyActivityEntry[] {
    const days = lifeDays(options);
    const random = new Random((options.seed ?? 20261122) + 3);
    const videos = videoCatalog(random);
    const weights = zipfWeights(videos.length, 0.9);
    const searchWeights = SEARCHES.map(([, weight]) => weight);
    const runningFrom = days.find((day) => day.run)?.date ?? '9999';

    const entries: RawMyActivityEntry[] = [];
    const at = (day: LifeDay, hour: number) => atMinute(day, hour * 60);

    const watch = (day: LifeDay, hour: number) => {
        let video = videos[random.weightedIndex(weights)];
        if (video.running && day.date < runningFrom) video = videos[random.weightedIndex(weights)];
        if (video.running && day.date < runningFrom) return;
        entries.push({
            header: 'YouTube',
            title: `Watched ${video.title}`,
            titleUrl: `https://www.youtube.com/watch?v=${video.id}`,
            subtitles: [{ name: video.channel, url: channelUrl(video.channel) }],
            time: at(day, hour).toISOString(),
            products: ['YouTube'],
        });
    };

    const search = (day: LifeDay, hour: number, query: string, where = HOME) => {
        entries.push({
            header: 'Search',
            title: `Searched for ${query}`,
            titleUrl: searchUrl(query),
            time: at(day, hour).toISOString(),
            products: ['Search'],
            locationInfos: locationInfos(where),
        });
    };

    const map = (
        day: LifeDay,
        hour: number,
        place: string,
        coords: { lat: number; lon: number }
    ) => {
        entries.push({
            header: 'Maps',
            title: `Searched for ${place}`,
            titleUrl: `https://www.google.com/maps/search/${encodeURIComponent(place)}/@${coords.lat.toFixed(6)},${coords.lon.toFixed(6)},15z`,
            time: at(day, hour).toISOString(),
            products: ['Maps'],
        });
    };

    // The trips, so each one can be planned in the weeks before it.
    const upcoming = new Map<string, NonNullable<LifeDay['trip']>>();
    for (const day of days) if (day.trip) upcoming.set(day.trip.from, day.trip);

    for (let index = 0; index < days.length; index += 1) {
        const day = days[index];
        const evening = () => random.range(19.5, 23.8);

        // Planning: a trip starting in the next three weeks gets searched for.
        for (let ahead = 1; ahead <= 21; ahead += 1) {
            const trip = upcoming.get(days[index + ahead]?.date ?? '');
            if (!trip || !random.bool(0.12)) continue;
            const query = random.pick([
                `train lyon ${trip.name.toLowerCase()}`,
                `${trip.name.toLowerCase()} things to do`,
                `hotel ${trip.name.toLowerCase()}`,
                `${trip.name.toLowerCase()} weather`,
            ]);
            search(day, evening(), query);
        }

        switch (day.kind) {
            case 'work': {
                if (random.bool(0.7)) search(day, random.normal(7.4, 0.2), 'weather lyon');
                for (let i = random.int(1, 5); i > 0; i -= 1) {
                    const [query] = SEARCHES[random.weightedIndex(searchWeights)];
                    search(day, random.range(9, 18), query, OFFICE);
                }
                if (random.bool(0.15)) {
                    const [place, coords] = random.pick(MAPS_LYON);
                    map(day, random.range(12, 19), place, coords);
                }
                for (let i = random.int(2, 9); i > 0; i -= 1) watch(day, evening());
                break;
            }
            case 'weekend': {
                for (let i = random.int(2, 6); i > 0; i -= 1) {
                    const [query] = SEARCHES[random.weightedIndex(searchWeights)];
                    search(day, random.range(9.5, 22), query);
                }
                if (random.bool(0.4)) {
                    const [place, coords] = random.pick(MAPS_LYON);
                    map(day, random.range(10, 16), place, coords);
                }
                for (let i = random.int(4, 14); i > 0; i -= 1) watch(day, random.range(10, 23.8));
                break;
            }
            case 'holiday': {
                const trip = day.trip!;
                const where = { lat: trip.lat, lon: trip.lon };
                for (let i = random.int(2, 6); i > 0; i -= 1) {
                    const near = {
                        lat: trip.lat + random.normal(0, 0.012),
                        lon: trip.lon + random.normal(0, 0.016),
                    };
                    const place = random.pick([
                        'restaurant',
                        'museum',
                        'beach',
                        'bakery',
                        'old town',
                        'viewpoint',
                    ]);
                    map(day, random.range(9.5, 21), `${place} ${trip.name}`, near);
                }
                if (random.bool(0.5))
                    search(day, random.range(8, 10), `${trip.name.toLowerCase()} weather`, where);
                for (let i = random.int(0, 2); i > 0; i -= 1) watch(day, random.range(22, 23.8));
                break;
            }
            case 'sick': {
                search(day, random.range(9, 12), random.pick(SICK_SEARCHES));
                for (let i = random.int(10, 18); i > 0; i -= 1) watch(day, random.range(10, 23.5));
                break;
            }
        }

        if (day.date >= runningFrom && random.bool(0.08)) {
            search(day, evening(), random.pick(RUN_SEARCHES));
        }
    }

    return entries.sort((a, b) => (a.time! < b.time! ? -1 : 1));
}
