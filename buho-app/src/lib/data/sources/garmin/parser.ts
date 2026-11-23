import {
    decodeFit,
    FIT_ACTIVITY,
    FIT_MONITORING,
    type DecodedFit,
} from '#lib/data/formats/fit/decode.ts';
import { markWorn, stepPacketsFromFiles } from '#lib/data/sources/garmin/stepPackets.ts';
import { healthReadingsFromFiles } from '#lib/data/sources/garmin/healthReadings.ts';
import { trackSegmentsFromFiles } from '#lib/data/sources/garmin/tracks.ts';
import type { ImportEntry, MonitoringPayload, SourceParser } from '../types';

/**
 * Garmin Connect's "Export Your Data" archive.
 *
 * Everything worth reading is in the `.fit` files, roughly ten thousand of them
 * inside a zip nested in the export zip. The JSON that surrounds them is daily
 * roll-ups and performance indices — deliberately left alone, since the point of
 * reading the `.fit` files at all is to get at what they were computed from.
 *
 * Two of the five file kinds are used: `activity` files hold GPS tracks, which
 * join Google Timeline in the positions table, and `monitoringB` files hold the
 * all-day step counters. Sleep, HRV and respiration files are the majority by
 * count and are skipped.
 */
export const garminFitParser: SourceParser<'monitoring'> = {
    id: 'garmin',
    label: 'Garmin Connect',
    dataset: 'monitoring',

    match(entry: ImportEntry): number {
        // The extension is proof on its own: no other export Buho reads ships
        // `.fit`, and a binary entry has no head to sniff anyway.
        return /\.fit$/i.test(entry.name) ? 1 : 0;
    },

    async parse(entries: ImportEntry[]): Promise<MonitoringPayload> {
        const activities: DecodedFit[] = [];
        const monitoring: DecodedFit[] = [];

        for (const entry of entries) {
            let decoded: DecodedFit | null;
            try {
                decoded = await decodeFit(await entry.bytes());
            } catch (error) {
                // Thousands of files written by several firmware versions over
                // years: one unreadable day shouldn't cost the user the rest.
                console.warn(`Could not read "${entry.path}":`, error);
                continue;
            }

            if (decoded?.fileType === FIT_ACTIVITY) activities.push(decoded);
            else if (decoded?.fileType === FIT_MONITORING) monitoring.push(decoded);
        }

        // Same files, read a second way: the counters and the health readings
        // sit side by side in them.
        const health = healthReadingsFromFiles(monitoring);
        return {
            positions: trackSegmentsFromFiles(activities),
            // Deferred to a single pass over every file: the counters are
            // cumulative and overlap across files, so packets can only be
            // derived once the whole export has been read. The pulse then says
            // which of them the watch was actually worn for.
            steps: markWorn(stepPacketsFromFiles(monitoring), health),
            gait: [],
            health,
        };
    },
};
