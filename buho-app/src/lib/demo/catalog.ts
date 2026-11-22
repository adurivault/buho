import type { Random } from './random';

/**
 * The music the demo listener listens to.
 *
 * Real artists and real albums, because the charts people look at first are
 * rankings of names, and invented names read as invented instantly — "Artist 3"
 * and "Track 4" were exactly why the old demo convinced nobody. Nothing here is
 * anyone's data: it is a list of records that exist, arranged into a listening
 * history that never happened.
 *
 * Track titles are built rather than listed. They are the one thing barely read
 * — the rankings, the races and the constellation are all keyed on artists —
 * and writing five hundred real ones by hand would be a lot of typing for a
 * label that shows up in a tooltip.
 */

export interface DemoArtist {
    name: string;
    albums: string[];
    /**
     * Roughly when this artist could plausibly enter a listening history.
     * Keeps a 2015 listening year from opening on a record released in 2023.
     */
    from: number;
    /** Broad style, used to make taste move in a believable direction. */
    genre: Genre;
}

export type Genre = 'electronic' | 'rock' | 'hiphop' | 'pop' | 'jazz' | 'folk' | 'classical';

export const DEMO_ARTISTS: DemoArtist[] = [
    {
        name: 'Daft Punk',
        albums: ['Discovery', 'Random Access Memories', 'Homework'],
        from: 2001,
        genre: 'electronic',
    },
    { name: 'Justice', albums: ['Cross', 'Woman', 'Hyperdrama'], from: 2007, genre: 'electronic' },
    { name: 'Kavinsky', albums: ['OutRun', 'Reborn'], from: 2013, genre: 'electronic' },
    {
        name: 'Bonobo',
        albums: ['Black Sands', 'Migration', 'Fragments'],
        from: 2010,
        genre: 'electronic',
    },
    { name: 'Caribou', albums: ['Swim', 'Our Love', 'Suddenly'], from: 2010, genre: 'electronic' },
    {
        name: 'Four Tet',
        albums: ['There Is Love in You', 'New Energy', 'Sixteen Oceans'],
        from: 2010,
        genre: 'electronic',
    },
    { name: 'Jamie xx', albums: ['In Colour', 'In Waves'], from: 2015, genre: 'electronic' },
    { name: 'Burial', albums: ['Untrue', 'Tunes 2011-2019'], from: 2008, genre: 'electronic' },
    { name: 'Floating Points', albums: ['Elaenia', 'Crush'], from: 2015, genre: 'electronic' },
    {
        name: 'Aphex Twin',
        albums: ['Selected Ambient Works 85-92', 'Syro'],
        from: 2001,
        genre: 'electronic',
    },
    { name: 'Moderat', albums: ['II', 'III'], from: 2013, genre: 'electronic' },
    {
        name: 'Rone',
        albums: ['Tohu Bohu', 'Mirapolis', 'Room With a View'],
        from: 2012,
        genre: 'electronic',
    },

    {
        name: 'Radiohead',
        albums: ['In Rainbows', 'Kid A', 'A Moon Shaped Pool'],
        from: 2001,
        genre: 'rock',
    },
    {
        name: 'Arctic Monkeys',
        albums: ['AM', 'Favourite Worst Nightmare', 'The Car'],
        from: 2007,
        genre: 'rock',
    },
    {
        name: 'Tame Impala',
        albums: ['Currents', 'Lonerism', 'The Slow Rush'],
        from: 2012,
        genre: 'rock',
    },
    {
        name: 'Interpol',
        albums: ['Turn On the Bright Lights', 'Antics'],
        from: 2003,
        genre: 'rock',
    },
    {
        name: 'The Strokes',
        albums: ['Is This It', 'Room on Fire', 'The New Abnormal'],
        from: 2002,
        genre: 'rock',
    },
    {
        name: 'Fontaines D.C.',
        albums: ['Dogrel', 'Skinty Fia', 'Romance'],
        from: 2019,
        genre: 'rock',
    },
    {
        name: 'Idles',
        albums: ['Joy as an Act of Resistance', 'Ultra Mono'],
        from: 2018,
        genre: 'rock',
    },
    { name: 'Black Midi', albums: ['Schlagenheim', 'Cavalcade'], from: 2019, genre: 'rock' },
    {
        name: 'King Gizzard & The Lizard Wizard',
        albums: ['Nonagon Infinity', 'Flying Microtonal Banana'],
        from: 2016,
        genre: 'rock',
    },

    {
        name: 'Kendrick Lamar',
        albums: ['To Pimp a Butterfly', 'good kid, m.A.A.d city', 'DAMN.'],
        from: 2012,
        genre: 'hiphop',
    },
    {
        name: 'Tyler, The Creator',
        albums: ['IGOR', 'Flower Boy', 'CALL ME IF YOU GET LOST'],
        from: 2017,
        genre: 'hiphop',
    },
    { name: 'MF DOOM', albums: ['Madvillainy', 'MM..FOOD'], from: 2004, genre: 'hiphop' },
    {
        name: 'A Tribe Called Quest',
        albums: ['The Low End Theory', 'Midnight Marauders'],
        from: 2001,
        genre: 'hiphop',
    },
    {
        name: 'Little Simz',
        albums: ['Sometimes I Might Be Introvert', 'GREY Area'],
        from: 2019,
        genre: 'hiphop',
    },
    {
        name: 'Danny Brown',
        albums: ['Atrocity Exhibition', 'uknowhatimsayin¿'],
        from: 2016,
        genre: 'hiphop',
    },
    {
        name: 'Nekfeu',
        albums: ['Feu', 'Cyborg', 'Les Étoiles Vagabondes'],
        from: 2015,
        genre: 'hiphop',
    },

    { name: 'Frank Ocean', albums: ['Blonde', 'channel ORANGE'], from: 2012, genre: 'pop' },
    {
        name: 'Lorde',
        albums: ['Melodrama', 'Pure Heroine', 'Solar Power'],
        from: 2013,
        genre: 'pop',
    },
    {
        name: 'Christine and the Queens',
        albums: ['Chaleur Humaine', 'Chris'],
        from: 2014,
        genre: 'pop',
    },
    { name: 'Phoenix', albums: ['Wolfgang Amadeus Phoenix', 'Ti Amo'], from: 2009, genre: 'pop' },
    { name: 'FKA twigs', albums: ['LP1', 'MAGDALENE'], from: 2014, genre: 'pop' },
    { name: 'Sufjan Stevens', albums: ['Carrie & Lowell', 'Illinois'], from: 2005, genre: 'folk' },
    {
        name: 'Big Thief',
        albums: ['Dragon New Warm Mountain', 'Two Hands'],
        from: 2019,
        genre: 'folk',
    },
    { name: 'Fleet Foxes', albums: ['Helplessness Blues', 'Shore'], from: 2011, genre: 'folk' },
    { name: 'Nick Drake', albums: ['Pink Moon', 'Bryter Layter'], from: 2001, genre: 'folk' },

    { name: 'John Coltrane', albums: ['A Love Supreme', 'Blue Train'], from: 2001, genre: 'jazz' },
    {
        name: 'Bill Evans',
        albums: ['Sunday at the Village Vanguard', 'Waltz for Debby'],
        from: 2001,
        genre: 'jazz',
    },
    {
        name: 'Kamasi Washington',
        albums: ['The Epic', 'Heaven and Earth'],
        from: 2015,
        genre: 'jazz',
    },
    {
        name: 'GoGo Penguin',
        albums: ['Man Made Object', 'A Humdrum Star'],
        from: 2016,
        genre: 'jazz',
    },
    {
        name: 'Thelonious Monk',
        albums: ['Brilliant Corners', "Monk's Dream"],
        from: 2001,
        genre: 'jazz',
    },

    { name: 'Nils Frahm', albums: ['Spaces', 'All Melody'], from: 2013, genre: 'classical' },
    {
        name: 'Max Richter',
        albums: ['Sleep', 'The Blue Notebooks'],
        from: 2004,
        genre: 'classical',
    },
    {
        name: 'Ólafur Arnalds',
        albums: ['re:member', 'Island Songs'],
        from: 2013,
        genre: 'classical',
    },
    { name: 'Erik Satie', albums: ['Gymnopédies & Gnossiennes'], from: 2001, genre: 'classical' },
];

const TITLE_HEADS = [
    'Slow',
    'Neon',
    'Paper',
    'Golden',
    'Quiet',
    'Hollow',
    'Northern',
    'Velvet',
    'Broken',
    'Endless',
    'Bright',
    'Distant',
    'Silver',
    'Winter',
    'Open',
    'Crooked',
    'Patient',
    'Wild',
    'Small',
    'Late',
];

const TITLE_TAILS = [
    'Hours',
    'Cities',
    'Light',
    'Weather',
    'Machines',
    'Rooms',
    'Signal',
    'Water',
    'Motion',
    'Distance',
    'Wires',
    'Mornings',
    'Lines',
    'Coast',
    'Ghosts',
    'Summer',
    'Fever',
    'Static',
    'Windows',
    'Currents',
];

const TITLE_SOLO = [
    'Aftermath',
    'Undertow',
    'Nightshift',
    'Foxglove',
    'Anhedonia',
    'Cassiopeia',
    'Lantern',
    'Halcyon',
    'Meridian',
    'Petrichor',
    'Vantage',
    'Kerosene',
];

/** A believable song title. Short noun phrases, which is what most titles are. */
export function makeTitle(random: Random): string {
    if (random.bool(0.22)) return random.pick(TITLE_SOLO);
    return `${random.pick(TITLE_HEADS)} ${random.pick(TITLE_TAILS)}`;
}

const BAND_NOUNS = [
    'Foxes',
    'Hours',
    'Coast',
    'Cassette',
    'Harbour',
    'Pilots',
    'Wolves',
    'Atlas',
    'Gardens',
    'Sirens',
    'Museum',
    'Tigers',
    'Balloon',
    'Palace',
    'Comet',
    'Orchard',
    'Radio',
    'Circuit',
    'Lantern',
    'Marina',
    'Signal',
    'Anchor',
];

const BAND_ADJECTIVES = [
    'Electric',
    'Midnight',
    'Pale',
    'Sunken',
    'Modern',
    'Secret',
    'Gentle',
    'Radiant',
    'Lesser',
    'Public',
    'Silent',
    'Novel',
    'Distant',
    'Sudden',
];

const BAND_SOLO = [
    'Aster',
    'Vela',
    'Ruskin',
    'Halden',
    'Mirabel',
    'Kestrel',
    'Novak',
    'Solene',
    'Wren',
    'Icarus Bell',
    'June Marlow',
    'Otto Vance',
    'Lila Reyes',
    'Sam Okonkwo',
];

/**
 * A name for the long tail.
 *
 * Real histories are mostly strangers: hundreds of artists you played twice
 * because they came up in a playlist and never came back. Their names are the
 * one place invention is safe — you would not recognise the real ones either,
 * which is exactly what makes them the tail.
 */
export function makeArtistName(random: Random): string {
    const roll = random.float();
    if (roll < 0.25) return random.pick(BAND_SOLO);
    if (roll < 0.55) return `The ${random.pick(BAND_NOUNS)}`;
    if (roll < 0.85) return `${random.pick(BAND_ADJECTIVES)} ${random.pick(BAND_NOUNS)}`;
    return `${random.pick(BAND_SOLO)} & The ${random.pick(BAND_NOUNS)}`;
}

const TAIL_ALBUMS = ['EP', 'Singles', 'Demos', 'Volume One', 'Sessions', 'Live at Home'];

/** Roughly how many strangers pass through a ten-year history. */
export function makeTailArtists(random: Random, count: number, genres: Genre[]): DemoArtist[] {
    const seen = new Set<string>();
    const artists: DemoArtist[] = [];
    let guard = 0;

    while (artists.length < count && guard < count * 12) {
        guard += 1;
        const name = makeArtistName(random);
        if (seen.has(name)) continue;
        seen.add(name);
        artists.push({
            name,
            albums: [random.pick(TAIL_ALBUMS)],
            from: 2001,
            genre: random.pick(genres),
        });
    }
    return artists;
}
