import type { Play } from '#lib/types/play.ts';
import { looksLikeLastfmScrobbles, parseLastfmScrobbles } from './parse';
import type { ImportEntry, SourceParser } from '../types';

/**
 * A Last.fm scrobbles export, as saved by mainstream.ghan.nl.
 *
 * Last.fm offers no export itself, so the file is that tool's replay of the
 * public API: one JSON array per page of scrobbles, nested in an outer array.
 * The same tool also writes loved tracks and events, and can write CSV or XML —
 * none of which is read here, and all of which fail the head check.
 *
 * Claimed on the shape of the head rather than the filename: the download is
 * named `scrobbles-<user>-<timestamp>.json`, but that timestamp is a resume
 * marker people rename away, so the name only raises the score.
 */
export const lastfmJsonParser: SourceParser<'listening'> = {
    id: 'lastfm-json',
    label: 'Last.fm (scrobbles)',
    dataset: 'listening',

    match(entry: ImportEntry, peek: string): number {
        if (!/\.json$/i.test(entry.name)) return 0;
        if (!looksLikeLastfmScrobbles(peek)) return 0;

        let score = 0.8;
        if (/scrobbles/i.test(entry.path)) score += 0.15;
        return Math.min(1, score);
    },

    async parse(entries: ImportEntry[]): Promise<Play[]> {
        const batches: Play[][] = [];
        for (const entry of entries) {
            try {
                batches.push(parseLastfmScrobbles(JSON.parse(await entry.text())));
            } catch {
                // A truncated download shouldn't sink the rest of the drop.
            }
        }

        if (batches.length === 0) return [];
        // `flat()` rather than a spread: a full history runs to six figures, and
        // `push(...plays)` passes every one of them as an argument.
        if (batches.length === 1) return batches[0];

        // The exporter can resume from a previous download, so two files of the
        // same account are a normal drop — and they interleave rather than
        // append, since each is sorted on its own.
        const plays = batches.flat();
        plays.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
        return plays;
    },
};
