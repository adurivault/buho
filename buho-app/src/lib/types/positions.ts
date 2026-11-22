/** Who recorded a position. Several providers share the one table. */
export type LocationSource = 'google-timeline' | 'garmin' | 'strava';

/**
 * One row of the `location_segments` table.
 *
 * `timestamp`/`endTimestamp`/`date` are local wall-clock strings ready for
 * insertion (the DB stores naive TIMESTAMP/DATE, same as `plays`).
 * They are NOT ISO instants: every provider carries its own UTC offset, so we
 * resolve the wall-clock the user actually experienced before storing it. See
 * sources/googleTimeline/parse and sources/garmin/tracks for how each one resolves it.
 *
 * The table is shared: Google Timeline contributes a coarse point every minute
 * or so, a Garmin watch — or a Strava export of the same kind of recording — a
 * dense one every second or two while an activity is running. `source` is what
 * keeps them legible side by side, and the last three fields only ever come from
 * something strapped to a body.
 */
export interface LocationSegment {
    source: LocationSource;
    timestamp: string; // local wall-clock "YYYY-MM-DD HH:MM:SS"
    date: string; // local day "YYYY-MM-DD"
    endTimestamp: string; // local wall-clock "YYYY-MM-DD HH:MM:SS"
    durationSeconds: number;
    lat: number;
    lon: number;
    segmentType: 'stationary' | 'moving';
    activityType: string | null; // moving only (walking, running, in passenger vehicle, …)
    semanticType: string | null; // Google Timeline stationary only (Home, Work, …)
    placeId: string | null; // Google Timeline stationary only
    distanceMeters: number | null; // moving only
    speedKmh: number | null; // moving only: travel speed
    azimuthDegrees: number | null; // moving only: heading 0–360 (0 = N, 90 = E)
    altitudeMeters: number | null; // recorded tracks only
    heartRate: number | null; // recorded tracks only, bpm
    cadenceSpm: number | null; // recorded tracks only, steps or revolutions per minute
}
