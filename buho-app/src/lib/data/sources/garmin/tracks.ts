import type { DecodedFit, FitMesg } from '#lib/data/formats/fit/decode.ts';
import { SEMICIRCLES_TO_DEGREES, localOffsetMinutes } from '#lib/data/formats/fit/units.ts';
import { trackSegments, type TrackFix } from '#lib/data/geo/trackSegments.ts';
import type { LocationSegment } from '#lib/types/positions.ts';

const num = (value: unknown): number | null =>
    typeof value === 'number' && Number.isFinite(value) ? value : null;

/**
 * Read the fixes out of an activity file's records.
 *
 * Records without a position are dropped: a watch keeps writing them on a
 * treadmill or in a pool, and they have nothing to contribute to a map. In the
 * export this was built on that is ~22k of 326k records.
 */
export function readFixes(records: FitMesg[]): TrackFix[] {
    const fixes: TrackFix[] = [];

    for (const record of records) {
        const lat = num(record.positionLat);
        const lon = num(record.positionLong);
        const timestamp = record.timestamp;
        if (lat == null || lon == null || !(timestamp instanceof Date)) continue;

        fixes.push({
            ms: timestamp.getTime(),
            lat: lat * SEMICIRCLES_TO_DEGREES,
            lon: lon * SEMICIRCLES_TO_DEGREES,
            distance: num(record.distance),
            speed: num(record.enhancedSpeed) ?? num(record.speed),
            altitude: num(record.enhancedAltitude) ?? num(record.altitude),
            heartRate: num(record.heartRate),
            cadence: num(record.cadence),
        });
    }

    return fixes;
}

/**
 * The sport an activity was recorded as, e.g. 'running' or 'cycling'.
 *
 * Lands in the same `activity_type` column as Google Timeline's "walking" /
 * "in passenger vehicle", so the explorer's Activity dimension covers both
 * providers without knowing there are two.
 */
export function sportOf(sessions: FitMesg[]): string | null {
    const sport = sessions[0]?.sport;
    return typeof sport === 'string' && sport ? sport : null;
}

/**
 * Turn one Garmin activity file into location segments.
 *
 * The shape of the result — a segment per fix, describing the leg that starts
 * there — is shared with every other recorder and lives in `trackSegments`. What
 * is Garmin's own is here: semicircles, and the offset the watch was set to,
 * which is the only thing that says what time of day this was for its wearer.
 */
export function activitySegments(decoded: DecodedFit): LocationSegment[] {
    return trackSegments({
        source: 'garmin',
        fixes: readFixes(decoded.recordMesgs),
        sport: sportOf(decoded.sessionMesgs),
        offsetMinutes: localOffsetMinutes(decoded.activityMesgs[0] as never) ?? 0,
    });
}

/** Every segment a set of activity files yielded. */
export function trackSegmentsFromFiles(files: DecodedFit[]): LocationSegment[] {
    const segments: LocationSegment[] = [];
    // Appended one at a time rather than spread: a long activity runs to several
    // thousand fixes, and spreading passes each as a call argument.
    for (const file of files) {
        for (const segment of activitySegments(file)) segments.push(segment);
    }
    return segments;
}
