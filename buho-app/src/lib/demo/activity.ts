import type { RawMyActivityEntry } from '#lib/types/googleActivity.ts';
import { DEMO_ARTISTS } from './catalog';
import ROUTES from './routes.json';
import { buildAgenda, instant, type Agenda, type Move, type Stay } from './agenda';
import { type LifeDay, type LifeOptions } from './life';
import { Random, zipfWeights } from './random';

/**
 * What the demo person watched, searched and looked up: the "My Activity"
 * files of a Google Takeout, entry by entry, for the parser to read like any
 * other.
 *
 * Read off the shared agenda, so it happens where the person is: YouTube in
 * the evening at home, in long autoplay runs on a lazy Sunday or a sick day;
 * work searches at the office; a Maps lookup before heading out; the trips
 * searched in the weeks before them and mapped while they last; the move and
 * the new job searched before they happen; the odd video at three in the
 * morning. The channels, videos and queries are invented, the music videos are
 * by the artists the listening sample plays.
 */

export interface ActivityOptions extends LifeOptions {
    /** An agenda already built, so several samples can share one. */
    agenda?: Agenda;
}

interface Video {
    title: string;
    channel: string;
    id: string;
    minutes: number;
    topic: 'food' | 'science' | 'tech' | 'city' | 'running' | 'travel' | 'music' | 'comedy';
}

/** Each channel's title patterns, and what fills them. */
const CHANNELS: Record<
    string,
    { topic: Video['topic']; titles: string[]; fill: string[]; minutes: [number, number] }
> = {
    'Kitchen Notes': {
        topic: 'food',
        titles: [
            '{} in fifteen minutes',
            'The secret to a good {}',
            '{}, three ways',
            'I made {} every day for a week',
            'Why your {} never works',
        ],
        fill: [
            'risotto',
            'omelette',
            'sourdough',
            'ramen',
            'tarte tatin',
            'curry',
            'gnocchi',
            'shakshuka',
            'focaccia',
            'pho',
            'ratatouille',
            'dumplings',
        ],
        minutes: [8, 22],
    },
    'Why Things Work': {
        topic: 'science',
        titles: [
            'How {} actually works',
            'The strange physics of {}',
            'Why {} is harder than it looks',
            'What nobody tells you about {}',
        ],
        fill: [
            'tides',
            'bicycles',
            'locks',
            'noise-cancelling',
            'ice',
            'clocks',
            'batteries',
            'elevators',
            'magnets',
            'rainbows',
            'GPS',
            'sourdough starters',
        ],
        minutes: [10, 28],
    },
    'Byte Size': {
        topic: 'tech',
        titles: [
            '{} explained in ten minutes',
            'I tried {} for a month',
            'The {} setup I use every day',
            'Stop doing {} like this',
        ],
        fill: [
            'home servers',
            'mechanical keyboards',
            'backups',
            'password managers',
            'Linux',
            'note-taking',
            'self-hosting',
            'Raspberry Pi',
            'spreadsheets',
            'e-readers',
        ],
        minutes: [9, 24],
    },
    'Paris à pied': {
        topic: 'city',
        titles: ['{}, end to end', 'A morning in {}', 'The hidden side of {}', '{} at night'],
        fill: [
            'the Marais',
            'Belleville',
            'the Butte-aux-Cailles',
            'Montmartre',
            'the Canal Saint-Martin',
            'the Latin Quarter',
            'Batignolles',
            'the 13th',
            'the covered passages',
        ],
        minutes: [12, 40],
    },
    'Run Easy': {
        topic: 'running',
        titles: [
            '{}: what actually matters',
            'The beginner guide to {}',
            'I got {} wrong for years',
            '{} without getting hurt',
        ],
        fill: [
            'easy runs',
            'half marathon training',
            'running cadence',
            'interval sessions',
            'running shoes',
            'tapering',
            'long runs',
            'race day nutrition',
            'shin splints',
        ],
        minutes: [8, 20],
    },
    'Slow Travel': {
        topic: 'travel',
        titles: ['{} in 48 hours', 'Hidden {}', 'Where locals eat in {}', 'Is {} worth it?'],
        fill: [
            'Marseille',
            'Rome',
            'Barcelona',
            'Biarritz',
            'Quiberon',
            'Annecy',
            'Lisbon',
            'Naples',
        ],
        minutes: [12, 30],
    },
    'Late Desk': {
        topic: 'comedy',
        titles: [
            'Monologue: {}',
            '{} — the full sketch',
            'The best of {}',
            'Audience questions: {}',
        ],
        fill: [
            'Monday',
            'the weather',
            'the commute',
            'airports',
            'flat hunting',
            'group chats',
            'the gym',
            'holidays',
            'meetings',
        ],
        minutes: [5, 14],
    },
};

/** Searches made at work, one set per job. */
const WORK_QUERIES = {
    A: [
        'brand guidelines template',
        'campaign kpi benchmark',
        'google slides master layout',
        'press release format',
        'newsletter open rate average',
        'canva export pdf print',
        'linkedin post best time',
        'agency pitch deck examples',
        'translate briefing english',
        'excel pivot table dates',
    ],
    B: [
        'css grid gap',
        'postgres index on expression',
        'typescript satisfies operator',
        'git rebase onto',
        'docker compose healthcheck',
        'regex lookbehind javascript',
        'svelte 5 runes effect',
        'http 429 retry after',
        'duckdb window function',
        'rust lifetime elision',
        'figma auto layout wrap',
        'jwt refresh token rotation',
    ],
};

const HOME_QUERIES = [
    'weather paris',
    'weather paris',
    'weather paris',
    'what to cook tonight',
    'cinema paris showtimes',
    'pharmacy open sunday paris',
    'how long to boil an egg',
    'ratp traffic',
    'velib station near me',
    'paris events this weekend',
    'football results',
    'exchange rate euro pound',
    'opening hours monoprix',
    'recipe {}',
    'translate {}',
    '{} meaning',
];

const PLACE_NAMES: Record<string, string> = {
    'demo-louvre': 'Musée du Louvre',
    'demo-orsay': "Musée d'Orsay",
    'demo-pompidou': 'Centre Pompidou',
    'demo-market': "Marché d'Aligre",
    'demo-cinemaA': 'MK2 Quai de Seine',
    'demo-cinemaB': 'MK2 Bibliothèque',
    'demo-vincennes': 'Bois de Vincennes',
    'demo-luxembourg': 'Jardin du Luxembourg',
    'demo-franchard': 'Gorges de Franchard',
    'demo-gareDeLyon': 'Gare de Lyon',
    'demo-montparnasse': 'Gare Montparnasse',
    'demo-orly': 'Paris Orly Airport',
    'demo-pigalle': 'Pigalle',
    'demo-belleville': 'Belleville',
    'demo-montparnasseFriends': 'Rue Daguerre',
    'demo-barA': 'bars Oberkampf',
    'demo-barB': 'bars Butte-aux-Cailles',
    'demo-lunchA': 'restaurants Opéra',
    'demo-lunchB': 'restaurants Austerlitz',
};

/** Where each named place is, for the Maps lookups made from home. */
const PLACE_COORDS: Record<string, [number, number]> = Object.fromEntries(
    Object.entries(ROUTES.places).map(([key, at]) => [`demo-${key}`, at as [number, number]])
);

const SIGHTS: Record<string, string[]> = {
    marseille: [
        '',
        'Gare Saint-Charles',
        'Vieux-Port',
        'Notre-Dame de la Garde',
        'Vallon des Auffes',
        'MuCEM',
        'Le Panier',
        'Cours Julien',
    ],
    rome: [
        '',
        'Colosseum',
        'Roman Forum',
        'Pantheon',
        'Piazza Navona',
        'Trevi Fountain',
        'Spanish Steps',
        'Trastevere',
    ],
    barcelona: [
        '',
        'Sagrada Família',
        'Passeig de Gràcia',
        'Barri Gòtic',
        'El Born',
        'Barceloneta',
        'Montjuïc',
    ],
    biarritz: [
        '',
        'Grande Plage',
        'Rocher de la Vierge',
        'Port des Pêcheurs',
        'Côte des Basques',
        'Phare de Biarritz',
    ],
    quiberon: ['', 'Port Maria', 'Côte Sauvage', 'Pointe du Percho', 'Beg Rohu'],
    annecy: ['', 'Vieille ville', 'Le Pâquier', 'Pont des Amours', 'Imperial Palace'],
};

/** Every video the person might watch. */
function videoCatalog(random: Random): Video[] {
    let next = 0;
    const id = () => `demo${(next++).toString(36).padStart(6, '0')}`;
    const videos: Video[] = [];

    for (const [channel, { topic, titles, fill, minutes }] of Object.entries(CHANNELS)) {
        for (const subject of fill) {
            for (const title of random
                .shuffle([...titles])
                .slice(0, random.int(2, titles.length))) {
                videos.push({
                    title: title.replace('{}', subject),
                    channel,
                    id: id(),
                    topic,
                    minutes: random.range(...minutes),
                });
            }
        }
        // A numbered series, which gets watched in order.
        for (let episode = 1; episode <= random.int(12, 30); episode += 1) {
            videos.push({
                title: `${channel} weekly, episode ${episode}`,
                channel,
                id: id(),
                topic,
                minutes: random.range(...minutes),
            });
        }
    }
    for (const artist of random.shuffle([...DEMO_ARTISTS]).slice(0, 60)) {
        for (const album of artist.albums) {
            videos.push({
                title: `${artist.name} – ${album} (full album)`,
                channel: artist.name,
                id: id(),
                topic: 'music',
                minutes: random.range(35, 60),
            });
        }
        videos.push({
            title: `${artist.name} – live session`,
            channel: artist.name,
            id: id(),
            topic: 'music',
            minutes: random.range(15, 45),
        });
    }
    return random.shuffle(videos);
}

const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
const searchUrl = (query: string) =>
    `https://www.google.com/search?q=${encodeURIComponent(query).replace(/%20/g, '+')}`;
const mapsUrl = (place: string, lat: number, lon: number) =>
    `https://www.google.com/maps/search/${encodeURIComponent(place)}/@${lat.toFixed(6)},${lon.toFixed(6)},15z`;

/** Where the person was, in the form Takeout attaches to an entry. */
function locationInfos(lat: number, lon: number) {
    return [
        {
            name: 'At this general area',
            url: `https://www.google.com/maps/@?api=1&map_action=map&center=${lat.toFixed(6)},${lon.toFixed(6)}&zoom=12`,
            source: 'From your device',
        },
    ];
}

/** Every entry of the shared life, oldest first. */
export function generateMyActivity(options: ActivityOptions = {}): RawMyActivityEntry[] {
    const agenda = options.agenda ?? buildAgenda(options);
    const { days } = agenda;
    const random = new Random((options.seed ?? 20261122) + 3);
    const videos = videoCatalog(random);
    const firstRun = days.find((d) => d.run !== 'none')?.date ?? '9999';
    const moveDay = days.find((d) => d.phase === 'B')?.date ?? '9999';
    const hireDay = days.find((d) => d.phase === 'B' && d.kind === 'work')?.date ?? '9999';
    const entries: RawMyActivityEntry[] = [];

    const dayOf = (minute: number) => days[Math.min(days.length - 1, Math.floor(minute / 1440))];
    const iso = (minute: number) => instant(agenda, minute).toISOString();

    // What gets watched shifts with the life: running once it starts, travel
    // before a trip, city walks around the move, comfort viewing when ill.
    const topicWeight = (video: Video, day: LifeDay) => {
        if (video.topic === 'running') return day.date >= firstRun ? 3 : 0.05;
        if (video.topic === 'travel') return upcomingTrip(day) ? 6 : 0.4;
        if (video.topic === 'city') return Math.abs(daysBetween(day.date, moveDay)) < 60 ? 4 : 0.8;
        if (video.topic === 'comedy') return day.kind === 'sick' ? 5 : 1;
        if (video.topic === 'tech') return day.phase === 'B' ? 1.6 : 0.6;
        return 1;
    };
    const popularity = zipfWeights(videos.length, 0.8);
    const byChannel = new Map<string, Video[]>();
    for (const video of videos) {
        byChannel.set(video.channel, [...(byChannel.get(video.channel) ?? []), video]);
    }

    // The trip each day is looking forward to, four weeks ahead at most.
    const ahead = new Map<LifeDay, LifeDay['trip']>();
    let nextTrip: LifeDay['trip'] = null;
    let nextStart = '';
    for (let i = days.length - 1; i >= 0; i -= 1) {
        const day = days[i];
        if (day.trip && day.trip.from === day.date) {
            nextTrip = day.trip;
            nextStart = day.date;
        }
        const wait = nextTrip ? daysBetween(nextStart, day.date) : Infinity;
        ahead.set(day, wait > 0 && wait <= 28 ? nextTrip : null);
    }
    const upcomingTrip = (day: LifeDay) => ahead.get(day) ?? null;

    function daysBetween(a: string, b: string) {
        return (Date.parse(a) - Date.parse(b)) / 86_400_000;
    }

    const watch = (minute: number, video: Video) =>
        entries.push({
            header: 'YouTube',
            title: `Watched ${video.title}`,
            titleUrl: `https://www.youtube.com/watch?v=${video.id}`,
            subtitles: [
                {
                    name: video.channel,
                    url: `https://www.youtube.com/channel/demo-${slug(video.channel)}`,
                },
            ],
            time: iso(minute),
            products: ['YouTube'],
        });

    const search = (minute: number, query: string, lat: number, lon: number) =>
        entries.push({
            header: 'Search',
            title: `Searched for ${query}`,
            titleUrl: searchUrl(query),
            time: iso(minute),
            products: ['Search'],
            locationInfos: locationInfos(lat, lon),
        });

    const map = (minute: number, place: string, lat: number, lon: number, directions = false) =>
        entries.push({
            header: 'Maps',
            title: directions ? `Directions to ${place}` : `Searched for ${place}`,
            titleUrl: mapsUrl(place, lat, lon),
            time: iso(minute),
            products: ['Maps'],
        });

    /** An autoplay run: one video after another, until the evening ends. */
    function session(from: number, to: number, day: LifeDay) {
        let minute = from;
        const weights = videos.map((v, i) => popularity[i] * topicWeight(v, day));
        let current = videos[random.weightedIndex(weights)];
        while (minute < to) {
            watch(minute, current);
            minute += current.minutes * random.range(0.3, 1) + random.range(0.2, 2);
            // Autoplay stays on the channel more often than not.
            current = random.bool(0.55)
                ? random.pick(byChannel.get(current.channel)!)
                : videos[random.weightedIndex(weights)];
        }
    }

    function stay(episode: Stay) {
        const day = dayOf(episode.from);
        const hours = (episode.to - episode.from) / 60;
        const { lat, lon } = episode.place;
        const between = (from: number, to: number) => random.range(from, Math.max(from, to));

        switch (episode.activity) {
            case 'home': {
                const lazy =
                    day.kind === 'sick'
                        ? 3
                        : day.kind === 'weekend' || day.kind === 'off'
                          ? 1.6
                          : 1;
                // On a remote day the working hours are spent working.
                const workHours = day.kind === 'remote' ? hours * 0.6 : 0;
                for (let k = Math.round(workHours * random.range(3, 6)); k > 0; k -= 1) {
                    search(
                        between(episode.from, episode.to),
                        random.pick(WORK_QUERIES[day.phase]),
                        lat,
                        lon
                    );
                }
                const sessions = Math.round((hours / 1.6) * lazy * random.range(0.6, 1.5));
                for (let k = 0; k < sessions; k += 1) {
                    const from = between(episode.from, episode.to - 20);
                    const length = Math.min(episode.to - from, random.range(25, 150) * lazy);
                    session(from, from + length, day);
                }
                for (let k = Math.round(hours * random.range(1, 2.6)); k > 0; k -= 1) {
                    const query = random
                        .pick(HOME_QUERIES)
                        .replace('{}', random.pick(CHANNELS['Kitchen Notes'].fill));
                    search(between(episode.from, episode.to), query, lat, lon);
                }
                // Browsing the map for somewhere to go.
                for (let k = Math.round(hours * random.range(0, 0.5)); k > 0; k -= 1) {
                    const [id, name] = random.pick(Object.entries(PLACE_NAMES));
                    const spot = PLACE_COORDS[id];
                    if (spot) map(between(episode.from, episode.to), name, spot[0], spot[1]);
                }
                break;
            }
            case 'work': {
                for (let k = Math.round(hours * random.range(4, 8)); k > 0; k -= 1) {
                    search(
                        between(episode.from, episode.to),
                        random.pick(WORK_QUERIES[day.phase]),
                        lat,
                        lon
                    );
                }
                break;
            }
            case 'sleep': {
                // Now and then a night without sleep, and a phone.
                if (hours > 4 && random.bool(0.025)) {
                    const from = episode.from + random.range(120, 240);
                    session(from, from + random.range(20, 70), day);
                }
                break;
            }
            case 'sight': {
                const trip = day.trip;
                const index = Number(episode.place.id.split('-').pop());
                if (trip && SIGHTS[trip.city]?.[index]) {
                    map(episode.from - random.range(5, 30), SIGHTS[trip.city][index], lat, lon);
                }
                if (random.bool(0.5))
                    search(
                        between(episode.from, episode.to),
                        `${random.pick(['restaurant', 'gelato', 'café', 'museum'])} near me`,
                        lat,
                        lon
                    );
                break;
            }
            default: {
                for (let k = Math.round(hours * random.range(0, 1.2)); k > 0; k -= 1) {
                    search(
                        between(episode.from, episode.to),
                        random.pick(HOME_QUERIES).replace('{}', 'merci'),
                        lat,
                        lon
                    );
                }
            }
        }
    }

    function move(episode: Move, target: Agenda['episodes'][number] | undefined) {
        const end = episode.path[episode.path.length - 1];
        const name = target?.type === 'stay' ? PLACE_NAMES[target.place.id] : undefined;
        // Looking up where to go, a little before going.
        if (name && random.bool(0.85)) {
            map(episode.from - random.range(3, 40), name, end[0], end[1], random.bool(0.6));
        }
        if (episode.mode === 'train' || episode.mode === 'plane') {
            search(
                episode.from - random.range(30, 120),
                episode.mode === 'train' ? 'sncf train status' : 'orly departures',
                end[0],
                end[1]
            );
        }
    }

    agenda.episodes.forEach((episode, index) => {
        if (episode.type === 'stay') stay(episode);
        else move(episode, agenda.episodes[index + 1]);
    });

    // What a day was looking forward to: a trip, the move, the new job, the race.
    days.forEach((day, index) => {
        const evening = index * 1440 + random.range(19, 23.5) * 60;
        const trip = upcomingTrip(day);
        if (trip && random.bool(0.6)) {
            const name = trip.name.toLowerCase();
            const query = random.pick([
                trip.mode === 'train'
                    ? `train paris ${name}`
                    : trip.mode === 'plane'
                      ? `flights paris ${name}`
                      : `paris ${name} drive time`,
                `${name} things to do`,
                `hotel ${name}`,
                `${name} weather`,
                `${name} best restaurants`,
            ]);
            search(evening, query, 48.85, 2.35);
        }
        const toMove = daysBetween(moveDay, day.date);
        if (toMove > 0 && toMove < 50 && random.bool(0.5)) {
            search(
                evening,
                random.pick([
                    'moving boxes paris',
                    'apartment butte aux cailles',
                    'change of address france',
                    'van rental paris',
                    'internet box installation',
                ]),
                48.85,
                2.35
            );
        }
        const toHire = daysBetween(hireDay, day.date);
        if (toHire > 0 && toHire < 70 && random.bool(0.4)) {
            search(
                evening,
                random.pick([
                    'station f startups',
                    'interview questions engineer',
                    'notice period france',
                    'salary negotiation tips',
                ]),
                48.85,
                2.35
            );
        }
        if (day.date >= firstRun && random.bool(0.1)) {
            search(
                evening,
                random.pick([
                    'half marathon pace calculator',
                    'running cadence',
                    'paris half marathon date',
                    'best running routes paris',
                    'shin splints',
                ]),
                48.83,
                2.35
            );
        }
        if (day.start.getMonth() === 11 && day.start.getDate() < 22 && random.bool(0.4)) {
            search(
                evening,
                random.pick([
                    'christmas gift ideas',
                    'train paris annecy',
                    'christmas market paris',
                ]),
                48.85,
                2.35
            );
        }
    });

    return entries.sort((a, b) => (a.time! < b.time! ? -1 : 1));
}
