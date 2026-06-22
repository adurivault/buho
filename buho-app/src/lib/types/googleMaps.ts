/**
 * One row of the `google_maps_segments` table.
 *
 * `timestamp`/`endTimestamp`/`date` are local wall-clock strings ready for
 * insertion (the DB stores naive TIMESTAMP/DATE, same as `spotify_plays`).
 * They are NOT ISO instants: Google Timeline carries a per-event UTC offset,
 * so we resolve the wall-clock the user actually experienced before storing it.
 * See parseGoogleMaps for how the offset is resolved per segment type.
 */
export interface LocationSegment {
    timestamp: string;      // local wall-clock "YYYY-MM-DD HH:MM:SS"
    date: string;           // local day "YYYY-MM-DD"
    endTimestamp: string;   // local wall-clock "YYYY-MM-DD HH:MM:SS"
    durationSeconds: number;
    lat: number;
    lon: number;
    segmentType: 'stationary' | 'moving';
    activityType: string | null;   // moving only (walking, in passenger vehicle, …)
    semanticType: string | null;   // stationary only (Home, Work, Unknown, …)
    placeId: string | null;        // stationary only
    distanceMeters: number | null; // moving only
}

/** A `"geo:lat,lon"` string as stored in the Google Timeline export. */
export type GeoString = string;

/** visit entry: a stationary stay at a place. */
export interface RawVisitEntry {
    startTime: string;
    endTime: string;
    visit: {
        topCandidate?: {
            placeLocation?: GeoString;
            placeID?: string;
            semanticType?: string;
        };
    };
}

/** activity entry: a single move between two points. */
export interface RawActivityEntry {
    startTime: string;
    endTime: string;
    activity: {
        start?: GeoString;
        end?: GeoString;
        distanceMeters?: string; // numeric, but serialized as a string
        topCandidate?: {
            type?: string;
        };
    };
}

/** timelinePath entry: a series of points offset (in minutes) from startTime. */
export interface RawTimelinePathEntry {
    startTime: string;
    endTime: string;
    timelinePath: Array<{
        point?: GeoString;
        durationMinutesOffsetFromStartTime?: string; // numeric, serialized as a string
    }>;
}

export type RawGoogleMapsEntry =
    | RawVisitEntry
    | RawActivityEntry
    | RawTimelinePathEntry
    | Record<string, unknown>; // timelineMemory and anything else: ignored
