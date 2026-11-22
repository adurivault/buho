import { decodeFit, FIT_ACTIVITY } from '#lib/data/formats/fit/decode.ts';
import { readFixes, sportOf } from '#lib/data/sources/garmin/tracks.ts';
import { localOffsetMinutes } from '#lib/data/formats/fit/units.ts';
import { trackSegments } from '#lib/data/geo/trackSegments.ts';
import type { ImportEntry } from '#lib/data/sources/types.ts';
import type { LocationSegment } from '#lib/types/positions.ts';
import { gunzip } from '#lib/data/formats/gunzip.ts';
import { inferredOffsetMinutes } from './localOffset';
import { normaliseSport, parseGpx, parseTcx, type ParsedTrack } from './xml';

/**
 * Reading one activity out of a Strava export, whatever it was uploaded as.
 *
 * Strava stores the file you gave it and hands it straight back, so the three
 * formats are three eras of the same history rather than three kinds of data:
 * `.tcx` from a phone in 2014, `.gpx` from Strava's own app through 2023, `.fit`
 * from a watch since. All of them become the same segments.
 */

/** The extension under any number of `.gz` wrappers, lowercased. */
function formatOf(name: string): string | null {
    const match = name.toLowerCase().match(/\.(fit|gpx|tcx)(\.gz)?$/);
    return match ? match[1] : null;
}

const isGzipped = (name: string) => /\.gz$/i.test(name);

/** A `.fit`, read with the same SDK and the same fields as Garmin's own. */
async function readFit(bytes: Uint8Array): Promise<ParsedTrack | null> {
    const decoded = await decodeFit(bytes);
    if (!decoded || decoded.fileType !== FIT_ACTIVITY) return null;

    const fixes = readFixes(decoded.recordMesgs);
    if (fixes.length === 0) return null;

    return {
        fixes,
        sport: normaliseSport(sportOf(decoded.sessionMesgs)),
        // Present on the files a watch wrote, absent on the ones Strava built
        // itself from an upload in another format.
        offsetMinutes: localOffsetMinutes(decoded.activityMesgs[0] as never),
    };
}

/** One activity file, or null if it holds no usable track. */
export async function readTrack(entry: ImportEntry): Promise<ParsedTrack | null> {
    const format = formatOf(entry.name);
    if (!format) return null;

    if (format === 'fit') {
        const bytes = await entry.bytes();
        return readFit(isGzipped(entry.name) ? await gunzip(bytes) : bytes);
    }

    const xml = isGzipped(entry.name)
        ? new TextDecoder().decode(await gunzip(await entry.bytes()))
        : await entry.text();

    return format === 'gpx' ? parseGpx(xml) : parseTcx(xml);
}

/**
 * Turn one read activity into location segments.
 *
 * The clock is the only thing resolved here: a `.tcx` and a watch's `.fit` state
 * their offset, and everything else has it inferred from where the track starts.
 */
export function stravaSegments(track: ParsedTrack): LocationSegment[] {
    const first = track.fixes.reduce(
        (earliest, fix) => (fix.ms < earliest.ms ? fix : earliest),
        track.fixes[0]
    );
    if (!first) return [];

    return trackSegments({
        source: 'strava',
        fixes: track.fixes,
        sport: track.sport,
        offsetMinutes: track.offsetMinutes ?? inferredOffsetMinutes(first.ms, first.lon),
    });
}
