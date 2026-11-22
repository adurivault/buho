import type { RawSpotifyEntry } from '#lib/data/sources/spotify/types.ts';
import { DEMO_ARTISTS, makeTailArtists, makeTitle, type DemoArtist, type Genre } from './catalog';
import { Random, zipfWeights } from './random';

/**
 * A listening history that never happened, shaped like one that could have.
 *
 * The demo this replaces was a thousand plays drawn uniformly: flat across the
 * twenty-four hours of the day, six artists within eighteen plays of each other,
 * three weeks long. Every chart in Buho exists to show a rhythm, a ranking or a
 * change over time, and that file had none of the three — so the app looked
 * broken when it was working perfectly.
 *
 * What makes this one worth drawing is not that it is bigger. It is that the
 * five things the charts are built to find are actually in it:
 *
 * - **A day has a shape.** Almost nothing at four in the morning, a commute, an
 *   afternoon, a long evening. Weekends start later and run longer.
 * - **Attention is a power law.** One artist far ahead of the second, a long
 *   tail below. Not forty artists with equal turns.
 * - **Taste has eras.** An artist arrives, takes over for a season or two, and
 *   fades. This is the only reason "how long you kept each artist" and "new
 *   tracks vs. tracks you already had" have anything to draw.
 * - **Listening comes in sessions.** Runs of tracks from one record, not
 *   independent draws from a bag. This is what gives the constellation its
 *   clumps.
 * - **It is not tidy.** Months missing because the phone died. Nights where the
 *   album kept going after you fell asleep. Skips. A fortnight abroad on the
 *   wrong clock, and a taste that turns over across ten years.
 *
 * That last one is deliberate and load-bearing. A model that only produces its
 * own assumptions is smooth in a way real exports never are, and smooth reads as
 * fake even when nobody can say why. The mess is modelled on purpose.
 */

export interface ListeningOptions {
    /**
     * Same seed and same `until`, same history down to the millisecond.
     *
     * Note what that does *not* say: `until` defaults to today, so the demo
     * advances by a day each day and the histories are not identical across
     * dates. That is the trade wanted here — a sample history that stops three
     * years ago reads as abandoned — but it means anything that must be stable
     * over time (a screenshot, a test) has to pin `until` as well.
     */
    seed?: number;
    /** How many years back the history runs. */
    years?: number;
    /** The day the history ends. Defaults to today. */
    until?: Date;
    /** Roughly how many plays to produce. */
    plays?: number;
}

const DAY_MS = 86_400_000;

/** The share of a day's listening that falls in each hour, on a working day. */
const WEEKDAY_HOURS = [
    0.004, 0.002, 0.001, 0.001, 0.001, 0.004, 0.018, 0.052, 0.078, 0.062, 0.048, 0.044, 0.046,
    0.042, 0.046, 0.052, 0.058, 0.079, 0.086, 0.074, 0.062, 0.048, 0.028, 0.012,
];

/** The same day, unemployed by it: later to start, later to stop. */
const WEEKEND_HOURS = [
    0.014, 0.009, 0.005, 0.002, 0.001, 0.001, 0.003, 0.009, 0.021, 0.038, 0.055, 0.063, 0.06, 0.055,
    0.056, 0.058, 0.061, 0.066, 0.072, 0.07, 0.064, 0.058, 0.04, 0.023,
];

interface Track {
    name: string;
    album: string;
    durationMs: number;
    uri: string;
}

interface Era {
    /** Days since the start of the history. */
    start: number;
    /** How long the artist holds your attention, in days. */
    length: number;
    /** How hard, at the peak. */
    peak: number;
}

interface Performer {
    artist: DemoArtist;
    tracks: Track[];
    /**
     * How much each of this artist's tracks gets played, relative to the others.
     *
     * Zipf again, one level down. Picking uniformly within an artist left every
     * track ranking flat — which is the same failure as the flat artist ranking,
     * just one chart further in. Nobody listens to an album evenly: two songs
     * carry it and the rest come along.
     */
    trackWeights: number[];
    eras: Era[];
    /** The long-run pull of this artist, independent of any era. */
    base: number;
}

/** A stretch where the export simply has nothing: a dead phone, a lost account. */
interface Gap {
    start: number;
    length: number;
}

/** A fortnight somewhere else, on somebody else's clock. */
interface Trip {
    start: number;
    length: number;
    country: string;
    /** Hours to add to local time while away. */
    offset: number;
}

const TRIP_PLACES = [
    { country: 'ES', offset: 0 },
    { country: 'IT', offset: 0 },
    { country: 'PT', offset: -1 },
    { country: 'GB', offset: -1 },
    { country: 'DE', offset: 0 },
    { country: 'US', offset: -6 },
    { country: 'JP', offset: 8 },
    { country: 'MA', offset: -1 },
];

function buildTrackWeights(random: Random, count: number): number[] {
    return random.shuffle(zipfWeights(count, 1.1));
}

function buildTracks(random: Random, artist: DemoArtist): Track[] {
    const tracks: Track[] = [];
    for (const album of artist.albums) {
        const count = random.int(8, 13);
        for (let index = 0; index < count; index += 1) {
            tracks.push({
                name: makeTitle(random),
                album,
                // Most songs are three and a half minutes; a few are two, and a
                // few run past ten. The tail is what makes "listening time by
                // artist" differ from "plays by artist" at all.
                durationMs: Math.round(
                    Math.min(Math.max(random.logNormal(212_000, 0.34), 55_000), 900_000)
                ),
                uri: `spotify:track:${random.int(0, 0xffffff).toString(16).padStart(6, '0')}${index}`,
            });
        }
    }
    return tracks;
}

/**
 * How strongly an artist pulls on a given day.
 *
 * An era is a rise and a longer fall — you find someone, you wear them out, you
 * keep coming back less often. Outside every era an artist keeps a small base
 * pull, which is what keeps old favourites drifting through later years instead
 * of vanishing on a date.
 */
function pullOn(performer: Performer, day: number): number {
    let pull = performer.base;
    for (const era of performer.eras) {
        const offset = day - era.start;
        if (offset < 0 || offset > era.length) continue;
        const position = offset / era.length;
        // Quick rise over the first fifth, long decay over the rest.
        const envelope =
            position < 0.2 ? position / 0.2 : Math.pow(1 - (position - 0.2) / 0.8, 1.6);
        pull += era.peak * envelope;
    }
    return pull;
}

export function generateListening(options: ListeningOptions = {}): RawSpotifyEntry[] {
    const { seed = 20260209, years = 10, until = new Date(), plays: target = 90_000 } = options;

    const random = new Random(seed);
    const totalDays = Math.round(years * 365.25);
    const endDay = new Date(until);
    endDay.setHours(0, 0, 0, 0);
    const startMs = endDay.getTime() - totalDays * DAY_MS;
    const startYear = new Date(startMs).getFullYear();

    // Artists enter in a plausible order: what existed when the history starts is
    // available from day one, the rest arrives on its own release date.
    const core = random.shuffle(
        DEMO_ARTISTS.filter((artist) => artist.from <= endDay.getFullYear())
    );
    const coreWeights = zipfWeights(core.length, 0.85);

    /**
     * The strangers.
     *
     * A real ten-year history holds hundreds of artists played once or twice —
     * a playlist recommendation, a support act, a song someone sent you. Without
     * them the numbers give themselves away: forty-six artists over a decade,
     * and a single favourite holding a quarter of everything. Their real work is
     * on the discovery charts, which are entirely about the rate at which
     * unfamiliar names appear.
     */
    const genres: Genre[] = ['electronic', 'rock', 'hiphop', 'pop', 'jazz', 'folk', 'classical'];
    const tail = makeTailArtists(random, 620, genres);

    const performers: Performer[] = [];

    core.forEach((artist, rank) => {
        const earliestDay = Math.max(0, Math.round((artist.from - startYear) * 365.25));
        const eraCount = random.bool(0.45) ? 2 : 1;
        const eras: Era[] = [];
        for (let index = 0; index < eraCount; index += 1) {
            const start = random.int(earliestDay, Math.max(earliestDay, totalDays - 60));
            eras.push({
                start,
                // A season to a couple of years. The short intense ones are the
                // ones that show up as spikes in the artist race.
                length: Math.round(random.logNormal(240, 0.75)),
                /**
                 * Deliberately independent of the artist's long-run rank.
                 *
                 * Tying the two together made one artist both the permanent
                 * favourite and the owner of the biggest era, so they took a
                 * quarter of ten years and the ranking never moved. Real
                 * histories change hands: who you listened to most in 2018 is
                 * not who you listened to most in 2023, and the artist race is
                 * only worth watching because of it.
                 */
                peak: random.range(3, 20),
            });
        }
        const tracks = buildTracks(random, artist);
        performers.push({
            artist,
            tracks,
            trackWeights: buildTrackWeights(random, tracks.length),
            eras,
            base: coreWeights[rank] * 2.2,
        });
    });

    for (const artist of tail) {
        // One short encounter, usually a few days, occasionally a fortnight.
        const start = random.int(0, Math.max(1, totalDays - 20));
        const tracks = buildTracks(random, artist);
        performers.push({
            artist,
            tracks,
            trackWeights: buildTrackWeights(random, tracks.length),
            eras: [
                {
                    start,
                    length: Math.round(random.logNormal(14, 0.9)),
                    peak: random.range(0.4, 3),
                },
            ],
            base: 0.012,
        });
    }

    // Two or three stretches with nothing in them at all. Real exports have
    // these — a phone is lost, an account is remade, a service is left for a
    // year — and a history without any is one of the tells that it was made up.
    const gaps: Gap[] = [];
    for (let index = 0; index < random.int(2, 3); index += 1) {
        gaps.push({
            start: random.int(30, totalDays - 60),
            length: Math.round(random.logNormal(38, 0.8)),
        });
    }

    const trips: Trip[] = [];
    for (let index = 0; index < years * 1.5; index += 1) {
        const place = random.pick(TRIP_PLACES);
        trips.push({
            start: random.int(0, totalDays - 20),
            length: random.int(5, 20),
            country: place.country,
            offset: place.offset,
        });
    }

    const inWindow = (day: number, start: number, length: number) =>
        day >= start && day < start + length;

    const budget = target / totalDays;
    const entries: RawSpotifyEntry[] = [];

    for (let day = 0; day < totalDays; day += 1) {
        if (gaps.some((gap) => inWindow(day, gap.start, gap.length))) continue;

        const dayStart = startMs + day * DAY_MS;
        const date = new Date(dayStart);
        const weekday = date.getDay();
        const isWeekend = weekday === 0 || weekday === 6;

        // Listening is not flat across ten years: it grows, peaks, and settles.
        const yearPosition = day / totalDays;
        const trend = 0.55 + 1.1 * Math.sin(Math.PI * Math.min(yearPosition * 1.15, 1));
        // A slow wander, so neighbouring weeks differ without the year looking noisy.
        const drift = 1 + 0.35 * Math.sin(day / 41) + 0.2 * Math.sin(day / 137);
        const weekly = isWeekend ? 1.25 : weekday === 5 ? 1.1 : 0.95;

        let dayPlays = Math.round(budget * trend * drift * weekly * random.range(0.35, 1.7));
        // Plenty of days with nothing, which is what makes a calendar heat map
        // readable instead of a uniform block of colour.
        if (random.bool(0.09)) dayPlays = 0;
        if (dayPlays <= 0) continue;

        const trip = trips.find((candidate) => inWindow(day, candidate.start, candidate.length));
        const country = trip ? trip.country : 'FR';
        const hourShift = trip ? trip.offset : 0;

        const platform =
            date.getFullYear() < startYear + 3
                ? 'Windows'
                : date.getFullYear() < startYear + 6
                  ? random.bool(0.6)
                      ? 'Android'
                      : 'Windows'
                  : random.bool(0.75)
                    ? 'Android'
                    : 'OS X';

        const hourWeights = isWeekend ? WEEKEND_HOURS : WEEKDAY_HOURS;

        // Sessions, not scattered plays: pick a few starting points and run from
        // each. A session is why three tracks from one album sit together at
        // 22:15 instead of being spread evenly across the evening.
        const sessionCount = Math.max(1, Math.min(4, Math.round(dayPlays / random.range(7, 16))));
        let remaining = dayPlays;

        for (let session = 0; session < sessionCount && remaining > 0; session += 1) {
            const length =
                session === sessionCount - 1
                    ? remaining
                    : Math.min(
                          remaining,
                          Math.max(1, Math.round(remaining / (sessionCount - session)))
                      );
            remaining -= length;

            const hour = random.weightedIndex(hourWeights);
            let cursor =
                dayStart + ((hour + hourShift + 24) % 24) * 3_600_000 + random.int(0, 59) * 60_000;

            // Pick who you are listening to now, and mostly stay with them.
            let performer = pickPerformer(random, performers, day);
            let runLeft = random.int(3, 9);

            for (let index = 0; index < length; index += 1) {
                if (runLeft <= 0) {
                    performer = pickPerformer(random, performers, day);
                    runLeft = random.int(3, 9);
                }
                runLeft -= 1;

                const track = performer.tracks[random.weightedIndex(performer.trackWeights)];
                let msPlayed = track.durationMs;
                let skipped = false;
                let reasonEnd = 'trackdone';

                const roll = random.float();
                if (roll < 0.13) {
                    // Skipped after a few seconds.
                    msPlayed = random.int(1_500, 28_000);
                    skipped = true;
                    reasonEnd = 'fwdbtn';
                } else if (roll < 0.21) {
                    msPlayed = Math.round(track.durationMs * random.range(0.3, 0.92));
                    reasonEnd = 'endplay';
                }

                entries.push({
                    ts: new Date(cursor).toISOString(),
                    platform,
                    ms_played: msPlayed,
                    conn_country: country,
                    ip_addr: '127.0.0.1',
                    master_metadata_track_name: track.name,
                    master_metadata_album_artist_name: performer.artist.name,
                    master_metadata_album_album_name: track.album,
                    spotify_track_uri: track.uri,
                    episode_name: null,
                    episode_show_name: null,
                    spotify_episode_uri: null,
                    reason_start: index === 0 ? 'clickrow' : skipped ? 'fwdbtn' : 'trackdone',
                    reason_end: reasonEnd,
                    shuffle: random.bool(0.35),
                    skipped,
                    offline: random.bool(0.04),
                    offline_timestamp: null,
                    incognito_mode: false,
                });

                cursor += msPlayed + random.int(0, 2_500);
            }
        }
    }

    // The export arrives sorted, and something downstream always quietly assumes
    // it. Cheaper to be honest here than to find out in a chart.
    entries.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
    return entries;
}

function pickPerformer(random: Random, performers: Performer[], day: number): Performer {
    const weights = performers.map((performer) => pullOn(performer, day));
    return performers[random.weightedIndex(weights)];
}
