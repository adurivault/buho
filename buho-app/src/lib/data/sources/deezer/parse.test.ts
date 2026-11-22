import { describe, it, expect } from 'vitest';
import { parseDeezerHistory } from './parse';
import type { SheetRow } from '../../formats/xlsx/readSheet';

/**
 * The header of `10_listeningHistory`, verbatim from a real export. Every cell
 * below is a string because Deezer writes even its numbers and dates that way.
 */
const HEADER: SheetRow = [
    'Song Title',
    'Artist',
    'ISRC',
    'Album Title',
    'IP Address',
    'Listening Time',
    'Platform Name',
    'Platform Model',
    'Date',
];

/** A row from the real export, oldest kind: no duration, no platform. */
const OLD_ROW: SheetRow = [
    'On A Train',
    'Yuksek',
    'FR8Q11100009',
    'On A Train EP',
    '203.0.113.7',
    '-1',
    'None',
    'None',
    '2011-06-14 20:41:29',
];

/** A recent row: seconds listened, desktop app, empty model. */
const RECENT_ROW: SheetRow = [
    "Dis-moi que tu m'aimes",
    'Ninho',
    'FRZ111600556',
    'M.I.L.S',
    '198.51.100.23',
    '199',
    'electron',
    '',
    '2026-05-28 23:41:54',
];

describe('parseDeezerHistory', () => {
    it('maps a recent play', () => {
        const [play] = parseDeezerHistory([HEADER, RECENT_ROW]);

        expect(play.source).toBe('deezer');
        expect(play.trackName).toBe("Dis-moi que tu m'aimes");
        expect(play.artistName).toBe('Ninho');
        expect(play.albumName).toBe('M.I.L.S');
        expect(play.isrc).toBe('FRZ111600556');
        expect(play.ipAddr).toBe('198.51.100.23');
        expect(play.mediaType).toBe('track');
    });

    it('converts listening time from seconds to milliseconds', () => {
        const [play] = parseDeezerHistory([HEADER, RECENT_ROW]);
        expect(play.msPlayed).toBe(199_000);
    });

    it('reads -1 as unknown rather than a zero-length listen', () => {
        // Nearly one row in twenty-five, mostly the oldest. Storing 0 would make
        // them look like instant skips and drag every average down.
        const [play] = parseDeezerHistory([HEADER, OLD_ROW]);
        expect(play.msPlayed).toBeNull();
    });

    it('reads the timestamp as local wall-clock time', () => {
        const [play] = parseDeezerHistory([HEADER, RECENT_ROW]);

        expect(play.timestamp.getFullYear()).toBe(2026);
        expect(play.timestamp.getMonth()).toBe(4); // May
        expect(play.timestamp.getDate()).toBe(28);
        expect(play.timestamp.getHours()).toBe(23);
        expect(play.timestamp.getMinutes()).toBe(41);
        expect(play.timestamp.getSeconds()).toBe(54);
    });

    it('truncates the date column to the start of the day', () => {
        const [play] = parseDeezerHistory([HEADER, RECENT_ROW]);

        expect(play.date.getHours()).toBe(0);
        expect(play.date.getDate()).toBe(28);
    });

    it("treats Deezer's literal 'None' as a missing value", () => {
        const [play] = parseDeezerHistory([HEADER, OLD_ROW]);

        expect(play.platform).toBeNull();
        expect(play.platformClean).toBe('Other');
    });

    it('maps platform names onto the vocabulary Spotify uses', () => {
        const row = (platform: string) => [...RECENT_ROW.slice(0, 6), platform, '', RECENT_ROW[8]];
        const clean = (platform: string) =>
            parseDeezerHistory([HEADER, row(platform)])[0].platformClean;

        expect(clean('ios')).toBe('iOS');
        expect(clean('web')).toBe('Web');
        // The desktop app names its framework, not the OS underneath — so it is
        // not guessed into macOS or Windows.
        expect(clean('electron')).toBe('Desktop');
    });

    it('leaves every Spotify-only field null', () => {
        const [play] = parseDeezerHistory([HEADER, RECENT_ROW]);

        expect(play.trackUri).toBeNull();
        expect(play.country).toBeNull();
        expect(play.skipped).toBeNull();
        expect(play.shuffle).toBeNull();
        expect(play.offline).toBeNull();
        expect(play.reasonStart).toBeNull();
        expect(play.reasonEnd).toBeNull();
        expect(play.incognitoMode).toBeNull();
    });

    it('resolves columns by header name, not position', () => {
        const swapped: SheetRow = ['Artist', 'Song Title', 'Listening Time', 'Date'];
        const [play] = parseDeezerHistory([
            swapped,
            ['Yuksek', 'On A Train', '42', '2011-06-14 20:41:29'],
        ]);

        expect(play.artistName).toBe('Yuksek');
        expect(play.trackName).toBe('On A Train');
        expect(play.msPlayed).toBe(42_000);
    });

    it('skips rows whose date cannot be read', () => {
        const plays = parseDeezerHistory([
            HEADER,
            [...RECENT_ROW.slice(0, 8), 'not a date'],
            RECENT_ROW,
        ]);

        expect(plays).toHaveLength(1);
    });

    it('yields nothing for a sheet that is not a listening history', () => {
        expect(
            parseDeezerHistory([
                ['Playlist Title', 'Track Link'],
                ['Mix', 'x'],
            ])
        ).toEqual([]);
        expect(parseDeezerHistory([])).toEqual([]);
    });
});
