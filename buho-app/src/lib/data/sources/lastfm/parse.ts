import type { Play } from '#lib/types/play.ts';

/**
 * Last.fm scrobbles → play records.
 *
 * Last.fm has no export of its own: the file comes from the third-party tool at
 * mainstream.ghan.nl, which replays the public API and saves what it gets. So
 * the shape here is the API's own — its XML transcribed into JSON, which is why
 * every text node arrives as a `#text` key next to its attributes.
 *
 * A scrobble says a track was played and when, and nothing else: no duration, no
 * device, no reason it ended. That is the whole record, so most of a `Play` is
 * NULL here — see the field notes below and in `types/play.ts`.
 */

/** One page of the API response, as the exporter saved it. */
type Scrobble = Record<string, unknown>;

/** `{"#text": "Ben Mazué", "mbid": "…"}` → `"Ben Mazué"`. */
function text(value: unknown): string | null {
    if (typeof value === 'string') return value.trim() || null;
    if (!value || typeof value !== 'object') return null;
    const node = (value as Record<string, unknown>)['#text'];
    return typeof node === 'string' ? node.trim() || null : null;
}

/**
 * True for an object carrying a scrobble's shape: a track name, an artist, and
 * a play time. Anything else in the file — a now-playing entry, which the API
 * ships without a date — is not a play and is dropped.
 */
function isScrobble(value: unknown): value is Scrobble {
    if (!value || typeof value !== 'object') return false;
    const entry = value as Scrobble;
    if (typeof entry.name !== 'string') return false;
    if (!entry.date || typeof entry.date !== 'object') return false;
    return 'uts' in (entry.date as Record<string, unknown>);
}

/**
 * The scrobble's moment, from `date.uts`.
 *
 * `uts` is a true Unix epoch, so it is read rather than the `#text` beside it:
 * that one is preformatted in whichever timezone the account is set to, which is
 * not necessarily the one the listener was in, and is not parseable without
 * guessing a locale. The epoch lands in a Date the same way Spotify's `ts`
 * does, and is stored as the local wall clock like every other table.
 */
function playedAt(date: unknown): Date | null {
    const uts = (date as Record<string, unknown>).uts;
    const seconds = typeof uts === 'string' ? Number(uts) : typeof uts === 'number' ? uts : NaN;
    if (!Number.isFinite(seconds) || seconds <= 0) return null;
    const timestamp = new Date(seconds * 1000);
    return Number.isNaN(timestamp.getTime()) ? null : timestamp;
}

/**
 * True if this head looks like a scrobbles export. Used for routing, so it only
 * ever sees the first couple of kilobytes.
 */
export function looksLikeLastfmScrobbles(head: string): boolean {
    // Scrobbles come as an array; the exporter's other outputs and every other
    // JSON Buho reads either start with an object or fail the markers below.
    if (!/^\s*\[/.test(head)) return false;
    // The `#text` key is the tell: it is what the API's XML-to-JSON translation
    // leaves behind, and nothing else Buho reads writes one.
    if (!head.includes('"#text"')) return false;
    // Then one marker of a scrobble in particular. Three of them because a very
    // long first entry — the image URLs are ~100 characters each — can push the
    // date past the end of the peek.
    return (
        /"uts"\s*:/.test(head) || head.includes('"streamable"') || head.includes('last.fm/music')
    );
}

/**
 * Map an exported scrobbles file to plays, sorted by time ascending.
 *
 * @param data the file's parsed JSON. The exporter writes one array per API
 *   page — so an array of arrays — but a flat array is accepted too, since that
 *   is what a single page or a hand-trimmed file looks like.
 */
export function parseLastfmScrobbles(data: unknown): Play[] {
    if (!Array.isArray(data)) return [];

    const plays: Play[] = [];
    // Pages are walked in place rather than flattened: a full history is over a
    // hundred thousand scrobbles, and `flat()` would hold a second copy of them.
    for (const page of data) {
        for (const entry of Array.isArray(page) ? page : [page]) {
            if (!isScrobble(entry)) continue;

            const timestamp = playedAt(entry.date);
            if (!timestamp) continue;

            const date = new Date(timestamp);
            date.setHours(0, 0, 0, 0);

            plays.push({
                source: 'lastfm',
                timestamp,
                date,
                // A scrobble fires partway through a track and records nothing
                // about it, so there is no duration to be had. NULL keeps these
                // rows out of every SUM rather than reading as instant skips.
                msPlayed: null,
                trackName: text(entry.name),
                artistName: text(entry.artist),
                albumName: text(entry.album),
                // Last.fm ships MusicBrainz ids, which neither of the other two
                // services carries and no view reads — so neither id column is
                // filled rather than one being stretched to hold a third format.
                trackUri: null,
                isrc: null,
                // A scrobble names no device. 'Unknown' rather than 'Other',
                // which in the other exports means a device that was recorded
                // and wasn't one of the known ones.
                platform: null,
                platformClean: 'Unknown',
                country: null,
                ipAddr: null,
                // Nothing about how the play went is scrobbled: no reason it
                // started or ended, no shuffle, no offline flag.
                skipped: null,
                shuffle: null,
                offline: null,
                reasonStart: null,
                reasonEnd: null,
                episodeName: null,
                episodeShowName: null,
                episodeUri: null,
                incognitoMode: null,
                // Last.fm scrobbles music. Podcast listening isn't scrobbled.
                mediaType: 'track',
            });
        }
    }

    // The export runs newest-first, one API page at a time.
    plays.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    return plays;
}
