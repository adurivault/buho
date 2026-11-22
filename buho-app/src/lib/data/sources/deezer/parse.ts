import type { Play } from '#lib/types/play.ts';
import type { SheetRow } from '../../formats/xlsx/readSheet';

/**
 * Deezer's `10_listeningHistory` sheet → play records.
 *
 * The sheet's nine columns, as Deezer writes them:
 *
 *   Song Title | Artist | ISRC | Album Title | IP Address
 *   Listening Time | Platform Name | Platform Model | Date
 *
 * Kept apart from the zip reading in `parser.ts` so the mapping can be
 * tested on literal rows — every cell arrives as text, including the numbers,
 * so there is nothing here a fixture can't reproduce exactly.
 */

/** The sheet holding play records. The others are favourites and settings. */
export const DEEZER_HISTORY_SHEET = '10_listeningHistory';

/**
 * Header labels, lowercased, that identify the sheet.
 *
 * Matched by name rather than position: the column order is Deezer's to change,
 * and reading an IP address as a song title would be a silent corruption.
 */
const REQUIRED_HEADERS = ['song title', 'artist', 'listening time', 'date'];

/** Deezer's exporter serializes a missing value as Python's `None`. */
function cell(value: string | undefined): string | null {
    if (value === undefined) return null;
    const trimmed = value.trim();
    if (trimmed === '' || trimmed === 'None') return null;
    return trimmed;
}

/**
 * Deezer's platform names, mapped onto the vocabulary Spotify's exports use.
 *
 * `electron` is the desktop app, which — unlike Spotify's platform string —
 * names the framework and not the OS underneath. It becomes "Desktop" rather
 * than being guessed into macOS or Windows.
 */
function cleanPlatform(platform: string | null): string {
    switch (platform) {
        case 'ios':
            return 'iOS';
        case 'android':
            return 'Android';
        case 'web':
            return 'Web';
        case 'electron':
            return 'Desktop';
        default:
            return 'Other';
    }
}

/**
 * "2026-05-28 23:41:54" → a Date carrying those digits.
 *
 * The export has no timezone and the digits are the clock the listener actually
 * saw, so they are read as local time — the same wall-clock convention every
 * other table in Buho stores.
 */
function parseTimestamp(value: string | null): Date | null {
    if (!value) return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(value);
    if (!m) return null;
    const date = new Date(
        Number(m[1]),
        Number(m[2]) - 1,
        Number(m[3]),
        Number(m[4]),
        Number(m[5]),
        m[6] ? Number(m[6]) : 0
    );
    return Number.isNaN(date.getTime()) ? null : date;
}

/** Column positions, resolved from the header row by label. */
type Columns = Record<string, number>;

function headerColumns(row: SheetRow): Columns | null {
    const columns: Columns = {};
    row.forEach((label, index) => {
        const key = label.trim().toLowerCase();
        if (key && !(key in columns)) columns[key] = index;
    });
    return REQUIRED_HEADERS.every((h) => h in columns) ? columns : null;
}

/**
 * Map the sheet's rows to plays, skipping any row without a usable timestamp.
 *
 * @param rows the sheet as read, header row included.
 */
export function parseDeezerHistory(rows: SheetRow[]): Play[] {
    if (rows.length === 0) return [];
    const columns = headerColumns(rows[0]);
    if (!columns) return [];

    const at = (row: SheetRow, header: string): string | null => {
        const index = columns[header];
        return index === undefined ? null : cell(row[index]);
    };

    const plays: Play[] = [];
    for (const row of rows.slice(1)) {
        const timestamp = parseTimestamp(at(row, 'date'));
        if (!timestamp) continue;

        const date = new Date(timestamp);
        date.setHours(0, 0, 0, 0);

        // Seconds in the export, milliseconds in the table. `-1` is Deezer's
        // "not recorded" and must not become a zero-length listen.
        const seconds = Number(at(row, 'listening time'));
        const msPlayed = Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : null;

        const platform = at(row, 'platform name');

        plays.push({
            source: 'deezer',
            timestamp,
            date,
            msPlayed,
            trackName: at(row, 'song title'),
            artistName: at(row, 'artist'),
            albumName: at(row, 'album title'),
            // Spotify URIs only; the sunburst's "open on Spotify" checks this.
            trackUri: null,
            isrc: at(row, 'isrc'),
            platform,
            platformClean: cleanPlatform(platform),
            // Deezer records neither the country nor why a track ended.
            country: null,
            ipAddr: at(row, 'ip address'),
            skipped: null,
            shuffle: null,
            offline: null,
            reasonStart: null,
            reasonEnd: null,
            episodeName: null,
            episodeShowName: null,
            episodeUri: null,
            incognitoMode: null,
            mediaType: 'track',
        });
    }
    return plays;
}
