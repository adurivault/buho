import type { LocationSegment, LocationSource } from '#lib/types/positions.ts';
import { wallClock } from '#lib/utils/wallClock.ts';
import { bearingDegrees, haversineMeters } from './haversine';

/**
 * Turning a recorded track into the rows the positions table holds.
 *
 * Shared by every recorder that logs an activity rather than a life: a Garmin
 * watch writing `.fit`, a Strava export shipping `.gpx`, `.tcx` and `.fit`. What
 * differs between them is how the fixes are read out of the file and how the
 * local offset is resolved — not what a track *is*, which is this.
 */

/** One usable fix out of a track, whatever wrote the file. */
export interface TrackFix {
    /** Unix milliseconds — the instant, before any offset is applied. */
    ms: number;
    lat: number;
    lon: number;
    /** Metres travelled since the start, when the recorder keeps a running total. */
    distance: number | null;
    /** Metres per second, when the recorder measured it. */
    speed: number | null;
    altitude: number | null;
    heartRate: number | null;
    /** As recorded: one foot for a runner, one revolution for a cyclist. */
    cadence: number | null;
}

/** One activity, ready to become segments. */
export interface RecordedTrack {
    source: LocationSource;
    /** In file order; sorted here, since a `.tcx` routinely is not. */
    fixes: TrackFix[];
    /** 'running', 'cycling', … — the label the Activity dimension reads. */
    sport: string | null;
    /** Minutes east of UTC at the place, as resolved by the caller. */
    offsetMinutes: number;
}

/**
 * Steps or revolutions per minute.
 *
 * The recorded cadence counts one foot for a runner, so the figure a watch
 * displays — and the one Google's walking segments imply — is twice it. A bike's
 * cadence is already whole revolutions and is left alone.
 */
export function cadenceSpm(cadence: number | null, sport: string | null): number | null {
    if (cadence == null) return null;
    return sport === 'running' || sport === 'walking' ? cadence * 2 : cadence;
}

/**
 * Turn one recorded activity into location segments.
 *
 * Each fix becomes a segment reaching to the next one, so distance, speed and
 * heading describe the leg that *starts* there — the same shape Google
 * Timeline's `timelinePath` points already have, which is what lets every
 * provider sit in one table and be trailed by the same map code.
 *
 * Distance and speed are measured where the recorder measured them and derived
 * from the geometry where it didn't: a `.fit` file carries a running total and a
 * speed sensor, a Strava `.gpx` carries neither, and a leg with no length is a
 * leg no view can weigh.
 */
export function trackSegments({
    source,
    fixes,
    sport,
    offsetMinutes,
}: RecordedTrack): LocationSegment[] {
    if (fixes.length === 0) return [];

    const ordered = [...fixes].sort((a, b) => a.ms - b.ms);
    const segments: LocationSegment[] = [];

    for (let i = 0; i < ordered.length; i++) {
        const fix = ordered[i];
        const next = ordered[i + 1];
        const durationSeconds = next ? Math.max(0, (next.ms - fix.ms) / 1000) : 0;

        // The last fix ends the activity: a standstill, with no leg left to
        // measure or point along.
        const legMeters = !next
            ? null
            : fix.distance != null && next.distance != null
              ? Math.max(0, next.distance - fix.distance)
              : haversineMeters(fix, next);

        const speedMs =
            fix.speed ??
            (legMeters != null && durationSeconds > 0 ? legMeters / durationSeconds : null);

        const timestamp = wallClock(fix.ms, offsetMinutes);
        segments.push({
            source,
            timestamp,
            date: timestamp.slice(0, 10),
            endTimestamp: wallClock(next ? next.ms : fix.ms, offsetMinutes),
            durationSeconds,
            lat: fix.lat,
            lon: fix.lon,
            segmentType: 'moving',
            activityType: sport,
            semanticType: null,
            placeId: null,
            distanceMeters: legMeters,
            speedKmh: next ? (speedMs != null ? speedMs * 3.6 : null) : 0,
            azimuthDegrees: next ? bearingDegrees(fix, next) : null,
            altitudeMeters: fix.altitude,
            heartRate: fix.heartRate,
            cadenceSpm: cadenceSpm(fix.cadence, sport),
        });
    }

    return segments;
}
