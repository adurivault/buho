import type { Play } from '#lib/types/play.ts';
import type { RawSpotifyEntry } from '#lib/data/sources/spotify/types.ts';
import { isSpotifyEntry, parseSpotifyData } from './parse';
import type { ImportEntry, SourceParser } from '../types';

/**
 * Spotify's extended streaming history.
 *
 * An export is a zip of JSON files, of which only the
 * `Streaming_History_Audio_*.json` ones hold plays — the rest describe the
 * account, playlists and inferences. Rather than trusting those filenames, which
 * differ between the extended and the one-year export, a file is claimed on the
 * shape of its first entry: a `ts` string next to `ms_played`.
 */

/** The first JSON value in the peeked head, if one can be recovered from it. */
function firstObject(peek: string): Record<string, unknown> | null {
    // The head is a truncated prefix, so it never parses as a whole. Slice out
    // the first complete `{…}` instead — at 2 KB that is several entries in.
    const start = peek.indexOf('{');
    if (start === -1) return null;

    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < peek.length; i++) {
        const char = peek[i];
        if (escaped) {
            escaped = false;
            continue;
        }
        if (char === '\\') {
            escaped = true;
            continue;
        }
        if (char === '"') {
            inString = !inString;
            continue;
        }
        if (inString) continue;
        if (char === '{') depth++;
        else if (char === '}') {
            depth--;
            if (depth === 0) {
                try {
                    return JSON.parse(peek.slice(start, i + 1));
                } catch {
                    return null;
                }
            }
        }
    }
    return null;
}

export const spotifyJsonParser: SourceParser<'listening'> = {
    id: 'spotify-json',
    label: 'Spotify (streaming history)',
    dataset: 'listening',

    match(entry: ImportEntry, peek: string): number {
        if (!/\.json$/i.test(entry.name)) return 0;
        // Play records come as a JSON array; the account files are objects.
        if (!/^\s*\[/.test(peek)) return 0;
        if (!isSpotifyEntry(firstObject(peek))) return 0;

        let score = 0.8;
        if (/streaming_history/i.test(entry.path)) score += 0.15;
        return Math.min(1, score);
    },

    async parse(entries: ImportEntry[]): Promise<Play[]> {
        const raw: RawSpotifyEntry[] = [];
        for (const entry of entries) {
            try {
                const data: unknown = JSON.parse(await entry.text());
                if (!Array.isArray(data)) continue;
                for (const item of data) {
                    if (isSpotifyEntry(item)) raw.push(item);
                }
            } catch {
                // One unreadable file shouldn't sink an export of eighty.
            }
        }
        return parseSpotifyData(raw);
    },
};
