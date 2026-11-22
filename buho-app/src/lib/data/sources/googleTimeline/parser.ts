import { parseTimelineData } from '#lib/data/sources/googleTimeline/parse.ts';
import type { LocationSegment } from '#lib/types/positions.ts';
import type { RawTimelineEntry } from './types';
import type { ImportEntry, SourceParser } from '../types';

/**
 * Google Timeline's location history.
 *
 * Two shapes ship under that name: the phone export is a bare array of entries,
 * the Takeout one wraps the same entries in `semanticSegments`.
 */
function toEntryArray(data: unknown): RawTimelineEntry[] {
    if (Array.isArray(data)) return data as RawTimelineEntry[];
    if (data && typeof data === 'object') {
        const segments = (data as { semanticSegments?: unknown }).semanticSegments;
        if (Array.isArray(segments)) return segments as RawTimelineEntry[];
    }
    return [];
}

export const googleTimelineParser: SourceParser<'positions'> = {
    id: 'google-timeline',
    label: 'Google Timeline',
    dataset: 'positions',

    match(entry: ImportEntry, peek: string): number {
        // Shape, never the path alone: a Takeout ships plenty of unrelated JSON
        // and claiming it would swallow it silently.
        const hasEntries = peek.includes('"startTime"') || peek.includes('"semanticSegments"');
        const hasShape =
            peek.includes('"visit"') ||
            peek.includes('"activity"') ||
            peek.includes('"timelinePath"');
        if (!hasEntries || !hasShape) return 0;

        // Google names it "location-history.json" or "Timeline.json"; a renamed
        // export still matches on shape, just less confidently.
        return /location.?history|timeline/i.test(entry.path) ? 3 : 2;
    },

    async parse(entries: ImportEntry[]): Promise<LocationSegment[]> {
        const segments: LocationSegment[] = [];

        // One file at a time, and nothing kept from it beyond the segments: a
        // location history runs to tens of megabytes.
        for (const entry of entries) {
            let parsed: unknown;
            try {
                parsed = JSON.parse(await entry.text());
            } catch {
                continue; // a damaged file shouldn't sink the rest of the export
            }
            // Appended one at a time rather than spread: a location history runs
            // to hundreds of thousands of points, and spreading passes each as a
            // call argument.
            for (const segment of parseTimelineData(toEntryArray(parsed))) {
                segments.push(segment);
            }
        }

        return segments;
    },
};
