import { describe, expect, it } from 'vitest';
import { looksLikeLastfmScrobbles, parseLastfmScrobbles } from './parse';

/**
 * The mapping from a scrobble to a play, on literal fixtures.
 *
 * What matters here is mostly what *isn't* filled: a scrobble is the thinnest
 * record of the three services, and the columns it can't answer have to come out
 * NULL rather than defaulted, or every average in the app quietly shifts.
 */

/** One scrobble, in the shape the exporter saves. */
function scrobble(overrides: Record<string, unknown> = {}) {
    return {
        artist: { mbid: '6bc23bdf', '#text': 'Ben Mazué' },
        streamable: '0',
        image: [{ size: 'small', '#text': 'https://lastfm-img.example/34s/x.jpg' }],
        mbid: '7e6a9462',
        album: { mbid: '61d3d9b1', '#text': 'Paradis' },
        name: 'Quand je marche',
        url: 'https://www.last.fm/music/Ben+Mazu%C3%A9/_/Quand+je+marche',
        date: { uts: '1781422755', '#text': '14 Jun 2026, 07:39' },
        ...overrides,
    };
}

describe('parseLastfmScrobbles', () => {
    it('maps a scrobble to a play', () => {
        const [play] = parseLastfmScrobbles([[scrobble()]]);

        expect(play.source).toBe('lastfm');
        expect(play.trackName).toBe('Quand je marche');
        expect(play.artistName).toBe('Ben Mazué');
        expect(play.albumName).toBe('Paradis');
        expect(play.mediaType).toBe('track');
    });

    it('reads the play time from the epoch, not the preformatted text', () => {
        // `#text` is rendered in whichever timezone the account is set to, and
        // is not parseable without guessing a locale. `uts` is unambiguous.
        const [play] = parseLastfmScrobbles([
            [scrobble({ date: { uts: '1781422755', '#text': 'nonsense' } })],
        ]);

        expect(play.timestamp.getTime()).toBe(1781422755 * 1000);
    });

    it('normalizes the play date to the start of its day', () => {
        const [play] = parseLastfmScrobbles([[scrobble()]]);

        expect(play.date.getHours()).toBe(0);
        expect(play.date.getMinutes()).toBe(0);
        expect(play.date.getDate()).toBe(play.timestamp.getDate());
    });

    it('leaves everything a scrobble does not record NULL', () => {
        const [play] = parseLastfmScrobbles([[scrobble()]]);

        // A duration of 0 would read as an instant skip and drag every average
        // down; a `false` shuffle flag would read as "played in order".
        expect(play.msPlayed).toBeNull();
        expect(play.skipped).toBeNull();
        expect(play.shuffle).toBeNull();
        expect(play.offline).toBeNull();
        expect(play.reasonStart).toBeNull();
        expect(play.reasonEnd).toBeNull();
        expect(play.country).toBeNull();
        expect(play.ipAddr).toBeNull();
        expect(play.platform).toBeNull();
        expect(play.trackUri).toBeNull();
        expect(play.isrc).toBeNull();
    });

    it('reports an unrecorded device as Unknown, not Other', () => {
        // "Other" means a device that was recorded and wasn't one of the known
        // ones — which is not what a scrobble says.
        const [play] = parseLastfmScrobbles([[scrobble()]]);

        expect(play.platformClean).toBe('Unknown');
    });

    it('reads a missing album as null rather than an empty name', () => {
        const [play] = parseLastfmScrobbles([[scrobble({ album: { mbid: '', '#text': '' } })]]);

        expect(play.albumName).toBeNull();
    });

    it('walks every page of the export', () => {
        const plays = parseLastfmScrobbles([
            [scrobble({ name: 'A' }), scrobble({ name: 'B' })],
            [scrobble({ name: 'C' })],
        ]);

        expect(plays.map((p) => p.trackName)).toContain('C');
        expect(plays).toHaveLength(3);
    });

    it('accepts a flat array of scrobbles', () => {
        // What a single page, or a hand-trimmed file, looks like.
        expect(parseLastfmScrobbles([scrobble()])).toHaveLength(1);
    });

    it('sorts plays oldest first, against an export that runs newest first', () => {
        const plays = parseLastfmScrobbles([
            [
                scrobble({ name: 'Newest', date: { uts: '1781422755' } }),
                scrobble({ name: 'Oldest', date: { uts: '1533060090' } }),
            ],
        ]);

        expect(plays.map((p) => p.trackName)).toEqual(['Oldest', 'Newest']);
    });

    it('drops a now-playing entry, which the API ships without a date', () => {
        const nowPlaying = scrobble({ '@attr': { nowplaying: 'true' } }) as Record<string, unknown>;
        delete nowPlaying.date;

        const plays = parseLastfmScrobbles([[nowPlaying, scrobble()]]);

        expect(plays).toHaveLength(1);
        expect(plays[0].trackName).toBe('Quand je marche');
    });

    it('drops entries whose play time is unusable', () => {
        expect(parseLastfmScrobbles([[scrobble({ date: { uts: 'later' } })]])).toEqual([]);
        expect(parseLastfmScrobbles([[scrobble({ date: { uts: '0' } })]])).toEqual([]);
    });

    it('yields nothing for JSON that is not an array of scrobbles', () => {
        expect(parseLastfmScrobbles({ error: 6, message: 'User not found' })).toEqual([]);
        expect(parseLastfmScrobbles(null)).toEqual([]);
        expect(parseLastfmScrobbles([[{ artist: 'x' }]])).toEqual([]);
    });
});

describe('looksLikeLastfmScrobbles', () => {
    const head = JSON.stringify([[scrobble()]]).slice(0, 2048);

    it('recognises the head of an export', () => {
        expect(looksLikeLastfmScrobbles(head)).toBe(true);
    });

    it('still recognises one whose first entry is too long to reach the date', () => {
        // The cover-art URLs run to ~100 characters each, so a peek can end
        // before `date` — the earlier markers are what carry it.
        const truncated = JSON.stringify([[scrobble()]]).slice(0, 200);

        expect(truncated).not.toContain('"uts"');
        expect(looksLikeLastfmScrobbles(truncated)).toBe(true);
    });

    it('rejects the other JSON exports Buho reads', () => {
        const spotify = JSON.stringify([{ ts: '2023-01-01T20:00:00Z', ms_played: 180000 }]);
        const takeout = JSON.stringify([{ header: 'YouTube', title: 'Watched', time: '2023' }]);
        const account = JSON.stringify({ identifier: 'x', email: 'someone@example.com' });

        expect(looksLikeLastfmScrobbles(spotify)).toBe(false);
        expect(looksLikeLastfmScrobbles(takeout)).toBe(false);
        expect(looksLikeLastfmScrobbles(account)).toBe(false);
    });
});
