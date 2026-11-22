/* The Google Timeline export as it arrives, before `parse.ts` turns it into `LocationSegment`s. */

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

export type RawTimelineEntry =
    RawVisitEntry | RawActivityEntry | RawTimelinePathEntry | Record<string, unknown>; // timelineMemory and anything else: ignored
