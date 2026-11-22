/**
 * Google Takeout "My Activity" — one JSON file per service, all sharing a single
 * schema. Only the meaning of `title` changes between services, which is why the
 * whole export lands in one table with a `service` column rather than one table
 * per service.
 *
 * Request the export in **JSON**: Takeout also offers HTML, which carries none of
 * the identifiers below (no video id, no coordinates, no channel URL).
 */

/**
 * One entry exactly as Takeout ships it. Every field is optional in practice.
 *
 * Named for Google's own "My Activity" so it doesn't read as a sibling of
 * `RawActivityEntry` in `sources/googleTimeline/types.ts`, which is a Timeline *movement*
 * segment — unrelated data that happens to share the word.
 */
export interface RawMyActivityEntry {
    /** Service label, e.g. "YouTube", "Search", "Maps". */
    header?: string;
    /** Verb + subject, e.g. "Watched <title>", "Searched for <query>". */
    title?: string;
    titleUrl?: string;
    /** Channel (YouTube) or a secondary label, with its URL. */
    subtitles?: Array<{ name?: string; url?: string }>;
    /**
     * Only ever present on ads, and only ever repeats the hour already carried by
     * `time`. Deliberately not parsed — see parseActivityEntry.
     */
    description?: string;
    /** ISO 8601 instant, in UTC. */
    time?: string;
    products?: string[];
    activityControls?: string[];
    /** Provenance tags; the only one we keep is "From Google Ads". */
    details?: Array<{ name?: string }>;
    /**
     * Where Google thought you were. Coarse on purpose — the URL carries a
     * `center=lat,lon` and a zoom, and most entries sit at a ~20 km zoom.
     */
    locationInfos?: Array<{ name?: string; url?: string; source?: string; sourceUrl?: string }>;
}

/**
 * One row of the `google_activity` table.
 *
 * `timestamp`/`date` are local wall-clock strings, not ISO instants — same
 * convention as `LocationSegment`, so the shared date filters in
 * `queries/common.ts` and any cross-source join line up.
 */
export interface ActivityRow {
    timestamp: string; // local wall-clock "YYYY-MM-DD HH:MM:SS"
    date: string; // local day "YYYY-MM-DD"
    service: string; // 'youtube' | 'search' | 'maps' | 'image-search' | …
    action: string; // normalized verb: watched | searched | viewed | …
    label: string; // video title, query, place name
    secondary: string | null; // YouTube channel, directions origin
    secondaryUrl: string | null;
    targetId: string | null; // videoId | ftid | placeId
    url: string | null;
    /**
     * Host of the page the entry left Google for, e.g. "stackoverflow.com".
     *
     * Null for anything that stayed inside Google — a YouTube watch, a Maps
     * lookup. Those aren't destinations, they're the service itself, and
     * `service` already names them.
     */
    domain: string | null;
    /**
     * Where a route started, for a "Directions to …" entry — the destination is
     * already the `label`. Takeout puts it on the first line of `description`,
     * often as the literal "Current location" rather than a place.
     */
    origin: string | null;
    /**
     * Where the *subject* is — the place a Maps entry points at. Comes from the
     * `@lat,lon` Google puts in its own map URLs, so it is as precise as the map
     * view that produced it.
     */
    placeLat: number | null;
    placeLon: number | null;
    /**
     * Where the *user* was. A different question from `placeLat`/`placeLon`, and
     * a far coarser answer: Google labels it "At this general area" and most
     * entries sit at a zoom covering tens of kilometres.
     */
    lat: number | null;
    lon: number | null;
    locSource: string | null; // "From your Location History", "From your device", …
    isAd: boolean;
}
