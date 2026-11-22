#!/usr/bin/env node
/**
 * Fetch the street geometry the demo positions sample walks, cycles and drives.
 *
 * The positions map draws real streets under the points, so an invented
 * journey has to follow them or it cuts through buildings. Each route below is
 * asked once of the public OSRM servers (OpenStreetMap data) and saved as an
 * encoded polyline in `src/lib/demo/routes.json`, with the métro stations the
 * sample hops between underground. Nothing here runs in the app: the JSON is
 * committed, and this script only needs re-running when the places change.
 *
 *   node scripts/fetch-demo-routes.mjs
 *
 * Routes © OpenStreetMap contributors, ODbL; computed with OSRM.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const OUT = fileURLToPath(new URL('../src/lib/demo/routes.json', import.meta.url));

/** [lat, lon]. Invented addresses on real streets; the sights are the sights. */
const P = {
    // Paris, the first home and job, then the second.
    homeA: [48.86505, 2.3738],
    homeB: [48.8269, 2.3501],
    officeA: [48.8743, 2.3292],
    officeB: [48.8343, 2.3708],
    lunchA: [48.8715, 2.3344],
    lunchB: [48.8362, 2.364],
    market: [48.849, 2.3786],
    pigalle: [48.8813, 2.3376],
    belleville: [48.8723, 2.377],
    montparnasseFriends: [48.839, 2.3238],
    barA: [48.8642, 2.3788],
    barB: [48.8278, 2.3521],
    cinemaA: [48.8855, 2.3721],
    cinemaB: [48.8326, 2.3774],
    louvre: [48.8606, 2.3376],
    orsay: [48.86, 2.3266],
    pompidou: [48.8606, 2.3522],
    buttesN: [48.883, 2.3815],
    buttesS: [48.8785, 2.3845],
    vincennes: [48.833, 2.413],
    luxembourg: [48.8462, 2.3371],
    montsourisN: [48.8245, 2.3385],
    montsourisS: [48.8205, 2.3395],
    montsourisW: [48.822, 2.336],
    quaiGare: [48.836, 2.373],
    bercy: [48.835, 2.385],
    quaiBernard: [48.847, 2.36],
    gareDeLyon: [48.8443, 2.3743],
    montparnasse: [48.8412, 2.32],
    orly: [48.7262, 2.3652],
    // Out of town.
    franchard: [48.4155, 2.611],
    franchardW: [48.41, 2.6005],
    franchardS: [48.406, 2.616],
    franchardE: [48.4135, 2.6235],
    parents: [45.9012, 6.1205],
    quiberon: [47.4842, -3.1192],
    // Evenings and weekends across town.
    marais: [48.859, 2.36],
    canal: [48.8722, 2.364],
    montmartre: [48.8855, 2.3335],
    batignolles: [48.886, 2.317],
    bastille: [48.8532, 2.3725],
    saintGermain: [48.854, 2.333],
    villette: [48.8938, 2.39],
    pereLachaise: [48.861, 2.3933],
    monceau: [48.8796, 2.3089],
    bercyVillage: [48.8325, 2.386],
};

/** Reached from either flat, on foot or by bike, both ways. */
const SPOTS = [
    'marais',
    'canal',
    'montmartre',
    'batignolles',
    'bastille',
    'saintGermain',
    'villette',
    'pereLachaise',
    'monceau',
    'bercyVillage',
    'buttesS',
    'luxembourg',
];

/** The same commute by other streets, through a waypoint. */
const VARIANTS = {
    'bike:homeA>officeA~1': ['bike', ['homeA', [48.87, 2.348], 'officeA']],
    'bike:homeA>officeA~2': ['bike', ['homeA', [48.8655, 2.342], 'officeA']],
    'bike:officeA>homeA~1': ['bike', ['officeA', [48.8705, 2.352], 'homeA']],
    'bike:homeB>officeB~1': ['bike', ['homeB', [48.8314, 2.3557], 'officeB']],
    'foot:homeB>officeB~1': ['foot', ['homeB', [48.827, 2.364], 'officeB']],
    'foot:officeB>homeB~1': ['foot', ['officeB', [48.8314, 2.3557], 'homeB']],
    'foot:homeA>market~1': ['foot', ['homeA', [48.857, 2.3795], 'market']],
};

/** Each destination's tour: where it sleeps first, then the sights in walking order. */
const TOURS = {
    marseille: [
        [43.2958, 5.3752],
        [43.3026, 5.3806],
        [43.2951, 5.374],
        [43.284, 5.3713],
        [43.2853, 5.3504],
        [43.2966, 5.3606],
        [43.299, 5.368],
        [43.2935, 5.3835],
    ],
    rome: [
        [41.8955, 12.492],
        [41.8902, 12.4922],
        [41.8925, 12.4853],
        [41.8986, 12.4769],
        [41.8992, 12.4731],
        [41.9009, 12.4833],
        [41.9057, 12.4823],
        [41.8897, 12.4697],
    ],
    barcelona: [
        [41.392, 2.165],
        [41.4036, 2.1744],
        [41.3917, 2.1649],
        [41.3833, 2.1777],
        [41.385, 2.183],
        [41.3784, 2.1925],
        [41.3712, 2.1695],
    ],
    biarritz: [
        [43.483, -1.559],
        [43.484, -1.5585],
        [43.4847, -1.566],
        [43.484, -1.564],
        [43.479, -1.565],
        [43.494, -1.547],
    ],
    quiberon: [
        [47.4842, -3.1192],
        [47.476, -3.124],
        [47.4855, -3.137],
        [47.4985, -3.1455],
        [47.4935, -3.12],
    ],
    annecy: [
        [45.9012, 6.1205],
        [45.899, 6.128],
        [45.902, 6.134],
        [45.901, 6.137],
        [45.9065, 6.1405],
    ],
};

/** Which journeys, by which profile. Both directions are fetched, since one-way streets differ. */
const PAIRS = [
    // First home.
    ['bike', 'homeA', 'officeA'],
    ['foot', 'officeA', 'lunchA'],
    ['foot', 'homeA', 'market'],
    ['foot', 'homeA', 'belleville'],
    ['foot', 'homeA', 'barA'],
    ['bike', 'homeA', 'cinemaA'],
    ['foot', 'homeA', 'pompidou'],
    ['foot', 'pompidou', 'louvre'],
    ['foot', 'louvre', 'homeA'],
    ['bike', 'homeA', 'vincennes'],
    ['foot', 'homeA', 'gareDeLyon'],
    ['bike', 'homeA', 'montparnasse'],
    ['car', 'homeA', 'orly'],
    // Second home.
    ['bike', 'homeB', 'officeB'],
    ['foot', 'homeB', 'officeB'],
    ['foot', 'officeB', 'lunchB'],
    ['bike', 'homeB', 'market'],
    ['foot', 'homeB', 'montparnasseFriends'],
    ['foot', 'homeB', 'barB'],
    ['foot', 'homeB', 'cinemaB'],
    ['foot', 'homeB', 'luxembourg'],
    ['foot', 'luxembourg', 'orsay'],
    ['bike', 'orsay', 'homeB'],
    ['bike', 'homeB', 'vincennes'],
    ['foot', 'homeB', 'gareDeLyon'],
    ['foot', 'homeB', 'montparnasse'],
    ['car', 'homeB', 'orly'],
    // Out of town, by car.
    ['car', 'homeA', 'franchard'],
    ['car', 'homeB', 'franchard'],
    ['car', 'homeA', 'parents'],
    ['car', 'homeB', 'parents'],
    ['car', 'homeA', 'quiberon'],
    ['car', 'homeB', 'quiberon'],
    // The move, across town.
    ['car', 'homeA', 'homeB'],
];

/** From where each trip arrives to where it sleeps: a walk from the station, or a taxi. */
const ARRIVALS = {
    marseille: ['foot', [43.3026, 5.3806]],
    biarritz: ['car', [43.4597, -1.5454]],
    rome: ['car', [41.8003, 12.2389]],
    barcelona: ['car', [41.2974, 2.0833]],
};

/** Loops, one direction only: they start and end at the same place. */
const LOOPS = {
    runA: ['foot', ['homeA', 'canal', 'buttesN', 'buttesS', 'homeA']],
    runB: ['foot', ['homeB', 'montsourisN', 'montsourisS', 'montsourisW', 'homeB']],
    longRunB: ['foot', ['homeB', 'quaiGare', 'bercy', 'quaiBernard', 'homeB']],
    walkVincennesA: ['foot', ['vincennes', [48.8285, 2.4215], [48.8365, 2.4245], 'vincennes']],
    hikeFranchard: ['foot', ['franchard', 'franchardW', 'franchardS', 'franchardE', 'franchard']],
};

/** The métro lines the sample rides, by station, in riding order. */
const METRO = {
    line3: [
        'Parmentier',
        'République',
        'Temple',
        'Arts et Métiers',
        'Réaumur - Sébastopol',
        'Sentier',
        'Bourse',
        'Quatre-Septembre',
        'Opéra',
        'Havre - Caumartin',
    ],
    line2: [
        'Ménilmontant',
        'Couronnes',
        'Belleville',
        'Colonel Fabien',
        'Jaurès',
        'Stalingrad',
        'La Chapelle',
        'Barbès - Rochechouart',
        'Anvers',
        'Pigalle',
    ],
    line7: [
        "Place d'Italie",
        'Les Gobelins',
        'Censier - Daubenton',
        'Place Monge',
        'Jussieu',
        'Sully - Morland',
        'Pont Marie',
        'Châtelet',
        'Pont Neuf',
        'Palais Royal - Musée du Louvre',
        'Pyramides',
        'Opéra',
        "Chaussée d'Antin - La Fayette",
        'Le Peletier',
        'Cadet',
    ],
    line5: [
        "Place d'Italie",
        'Campo-Formio',
        'Saint-Marcel',
        "Gare d'Austerlitz",
        'Quai de la Rapée',
    ],
};

const SERVERS = {
    foot: 'https://routing.openstreetmap.de/routed-foot/route/v1/driving',
    bike: 'https://routing.openstreetmap.de/routed-bike/route/v1/driving',
    car: 'https://router.project-osrm.org/route/v1/driving',
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const at = (point) => (typeof point === 'string' ? P[point] : point);

async function route(profile, points) {
    const coords = points.map((p) => `${at(p)[1]},${at(p)[0]}`).join(';');
    // Long drives keep OSRM's own simplification; streets keep every bend.
    const overview = profile === 'car' ? 'simplified' : 'full';
    const url = `${SERVERS[profile]}/${coords}?overview=${overview}&geometries=polyline`;
    for (let attempt = 0; attempt < 4; attempt += 1) {
        const response = await fetch(url, { headers: { 'User-Agent': 'buho-demo-routes' } });
        if (response.ok) {
            const body = await response.json();
            if (body.code === 'Ok') return body.routes[0].geometry;
        }
        await sleep(2000 * (attempt + 1));
    }
    throw new Error(`No route for ${profile} ${coords}`);
}

const fold = (name) =>
    name
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '');

async function stations() {
    const query =
        '[out:json][timeout:60];node["railway"="station"]["station"="subway"](48.80,2.22,48.92,2.47);out;';
    const response = await fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        body: `data=${encodeURIComponent(query)}`,
        headers: { 'User-Agent': 'buho-demo-routes' },
    });
    const { elements } = await response.json();
    const byName = new Map(elements.map((e) => [fold(e.tags.name ?? ''), [e.lat, e.lon]]));

    const out = {};
    for (const [line, names] of Object.entries(METRO)) {
        out[line] = names.map((name) => {
            const found = byName.get(fold(name));
            if (!found) throw new Error(`No station "${name}"`);
            return [Number(found[0].toFixed(5)), Number(found[1].toFixed(5))];
        });
    }
    return out;
}

// Only what is missing: a re-run after adding places fetches just those.
const previous = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')).routes : {};
const routes = { ...previous };
for (const spot of SPOTS) {
    for (const home of ['homeA', 'homeB']) {
        for (const profile of ['foot', 'bike']) PAIRS.push([profile, home, spot]);
    }
}
let count = 0;
const total = PAIRS.length * 2 + Object.keys(LOOPS).length;

for (const [profile, from, to] of PAIRS) {
    for (const [a, b] of [
        [from, to],
        [to, from],
    ]) {
        const key = `${profile}:${a}>${b}`;
        if (!routes[key]) {
            routes[key] = await route(profile, [a, b]);
            await sleep(700);
        }
        process.stdout.write(`\r${++count}/${total} routes`);
    }
}
for (const [name, [profile, points]] of Object.entries(LOOPS)) {
    if (!routes[`${profile}:${name}`]) {
        routes[`${profile}:${name}`] = await route(profile, points);
        await sleep(700);
    }
    process.stdout.write(`\r${++count}/${total} routes`);
}
for (const [key, [profile, points]] of Object.entries(VARIANTS)) {
    if (!routes[key]) {
        routes[key] = await route(profile, points);
        await sleep(700);
    }
}

for (const [city, [profile, from]] of Object.entries(ARRIVALS)) {
    if (!routes[`arrive:${city}`]) {
        routes[`arrive:${city}`] = await route(profile, [from, TOURS[city][0]]);
        await sleep(700);
    }
}

// Each tour, leg by leg in order, and every stop's way back to where it sleeps.
for (const [city, stops] of Object.entries(TOURS)) {
    for (let i = 0; i < stops.length - 1; i += 1) {
        if (!routes[`foot:${city}:${i}>${i + 1}`]) {
            routes[`foot:${city}:${i}>${i + 1}`] = await route('foot', [stops[i], stops[i + 1]]);
            await sleep(700);
        }
    }
    for (let i = 1; i < stops.length; i += 1) {
        if (!routes[`foot:${city}:${i}>0`]) {
            routes[`foot:${city}:${i}>0`] = await route('foot', [stops[i], stops[0]]);
            await sleep(700);
        }
    }
    process.stdout.write(`\r${city} tour done          `);
}

const metro = await stations();

writeFileSync(
    OUT,
    JSON.stringify(
        {
            attribution:
                'Routes computed with OSRM from OpenStreetMap data. © OpenStreetMap contributors, ODbL.',
            places: P,
            tours: TOURS,
            routes,
            metro,
        },
        null,
        1
    ) + '\n'
);
console.log(`\nWrote ${Object.keys(routes).length} routes to ${OUT}`);
