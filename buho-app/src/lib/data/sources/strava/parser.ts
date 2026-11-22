import { readTrack, stravaSegments } from '#lib/data/sources/strava/tracks.ts';
import type { LocationSegment } from '#lib/types/positions.ts';
import type { ImportEntry, SourceParser } from '../types';

/**
 * Strava's "Download request" archive.
 *
 * Everything Buho reads is under `activities/`: one file per outing, in
 * whichever format it was uploaded in. The rest of the export is account
 * paperwork — followers, email preferences, the segments you starred — and
 * `activities.csv`, which is a summary of files that are already here.
 *
 * The tracks join Google Timeline's and Garmin's in the positions table. Where a
 * watch fed both Strava and Garmin Connect, the same outing arrives twice; the
 * overlap is resolved once at the storage layer, minute by minute, rather than
 * guessed at here.
 */
export const stravaParser: SourceParser<'positions'> = {
    id: 'strava',
    label: 'Strava',
    dataset: 'positions',

    match(entry: ImportEntry): number {
        // Nothing else Buho reads ships these, gzipped or not, so the extension
        // is proof on its own.
        if (/\.(gpx|tcx)(\.gz)?$/i.test(entry.name)) return 1;
        // Garmin never gzips an individual file; Strava gzips every recent one.
        if (/\.fit\.gz$/i.test(entry.name)) return 1;
        // A bare `.fit` is Garmin's format, and Garmin claims it. Strava names
        // its own after the activity id and nothing else, where a Garmin export
        // prefixes every file with the account it belongs to — so a basename of
        // pure digits outbids it.
        return /^\d+\.fit$/i.test(entry.name) ? 2 : 0;
    },

    async parse(entries: ImportEntry[]): Promise<LocationSegment[]> {
        const segments: LocationSegment[] = [];

        for (const entry of entries) {
            try {
                const track = await readTrack(entry);
                if (!track) continue;
                // Appended one at a time rather than spread: a long activity runs
                // to several thousand fixes, and spreading passes each as a call
                // argument.
                for (const segment of stravaSegments(track)) segments.push(segment);
            } catch (error) {
                // Ten years of uploads from whatever app was current: one file
                // nobody can read shouldn't cost the user the other five hundred.
                console.warn(`Could not read "${entry.path}":`, error);
            }
        }

        return segments;
    },
};
