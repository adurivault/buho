import type { TrackFix } from '#lib/data/geo/trackSegments.ts';

/**
 * Reading the two XML track formats a Strava export ships.
 *
 * Strava hands back whatever was uploaded, so one export holds three formats at
 * once: `.fit` from a watch, `.gpx` from its own phone app, and `.tcx` from
 * whatever recorded the oldest activities. The two XML ones are here; `.fit` is
 * read by the SDK, same as Garmin's.
 *
 * The difference that matters is the clock. A `.tcx` timestamp states its UTC
 * offset, so the wall clock its owner lived is in the file. A Strava `.gpx` is
 * normalised to UTC — `Z` or `+00:00`, whichever the writer chose — and says
 * nothing about where it happened, which is what `localOffset` is for.
 */

/** One activity read out of a track file, before its clock is resolved. */
export interface ParsedTrack {
    fixes: TrackFix[];
    /** 'running', 'cycling', … as the Activity dimension spells them. */
    sport: string | null;
    /** Minutes east of UTC, when the file states it. Null means "not recorded". */
    offsetMinutes: number | null;
}

/**
 * Strava's own sport names, in the vocabulary the FIT files already use.
 *
 * The `activity_type` column is shared with Google Timeline's "walking" and "in
 * passenger vehicle", and the explorer buckets it by string. A Strava `.gpx`
 * writing "Run" where a `.fit` writes "running" would split one activity into
 * two facets of the same filter.
 */
const SPORT_ALIASES: Record<string, string> = {
    run: 'running',
    ride: 'cycling',
    bike: 'cycling',
    biking: 'cycling',
    virtualride: 'cycling',
    ebikeride: 'cycling',
    walk: 'walking',
    hike: 'hiking',
    swim: 'swimming',
    alpineski: 'alpine_skiing',
    backcountryski: 'backcountry_skiing',
    nordicski: 'cross_country_skiing',
    workout: 'training',
    weighttraining: 'training',
};

export function normaliseSport(raw: string | null | undefined): string | null {
    if (!raw) return null;
    const lower = raw.trim().toLowerCase();
    if (!lower) return null;
    // Strava writes a numeric type code on a few old activities, and a `.fit`
    // says 'generic' when the recorder never named a sport — the 52 activities
    // Strava itself calls Workouts, in the export this was built on. Neither is
    // a sport, and both read better as the Unknown facet than as themselves.
    if (lower === 'generic' || /^\d+$/.test(lower)) return null;
    return SPORT_ALIASES[lower.replace(/[\s_-]/g, '')] ?? lower;
}

/**
 * Whitespace and a byte-order mark are stripped off the front first: an XML
 * declaration has to be the very first thing in the document, and Strava's
 * oldest `.tcx` files are indented ten spaces before theirs — enough to make an
 * otherwise perfectly good file unparseable.
 */
function parseXml(text: string): Document | null {
    const doc = new DOMParser().parseFromString(text.replace(/^\uFEFF?\s+/, ''), 'application/xml');
    return doc.getElementsByTagName('parsererror').length > 0 ? null : doc;
}

/** The text of the first descendant with this local name, in any namespace. */
function text(root: Element | Document, name: string): string | null {
    const found = root.getElementsByTagNameNS('*', name)[0];
    return found?.textContent?.trim() || null;
}

/** The same, as a finite number. */
function number(root: Element | Document, name: string): number | null {
    const raw = text(root, name);
    if (raw == null) return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
}

/**
 * The instant an ISO timestamp denotes.
 *
 * Sub-millisecond digits are trimmed first: a `.tcx` written by a phone states
 * microseconds, which the ECMAScript date grammar does not cover and only some
 * engines forgive.
 */
function instantMs(raw: string | null): number | null {
    if (!raw) return null;
    const ms = Date.parse(raw.replace(/(\.\d{3})\d+/, '$1'));
    return Number.isFinite(ms) ? ms : null;
}

/**
 * The UTC offset an ISO timestamp states, in minutes east.
 *
 * `Z` counts as unstated rather than as zero: it is what a writer normalising to
 * UTC emits, which is a claim about the format and not about the place.
 */
function statedOffsetMinutes(raw: string | null): number | null {
    const match = raw?.match(/([+-])(\d{2}):?(\d{2})$/);
    if (!match) return null;
    const minutes = Number(match[2]) * 60 + Number(match[3]);
    return match[1] === '-' ? -minutes : minutes;
}

/** One Strava `.gpx`: a track of `trkpt`s, timestamped in UTC. */
export function parseGpx(xml: string): ParsedTrack | null {
    const doc = parseXml(xml);
    if (!doc) return null;

    const fixes: TrackFix[] = [];
    const points = doc.getElementsByTagNameNS('*', 'trkpt');

    for (let i = 0; i < points.length; i++) {
        const point = points[i];
        const lat = Number(point.getAttribute('lat'));
        const lon = Number(point.getAttribute('lon'));
        const ms = instantMs(text(point, 'time'));
        if (ms == null || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;

        fixes.push({
            ms,
            lat,
            lon,
            // A phone records neither, so every leg is measured from the geometry.
            distance: null,
            speed: null,
            altitude: number(point, 'ele'),
            heartRate: number(point, 'hr'),
            cadence: number(point, 'cad'),
        });
    }

    if (fixes.length === 0) return null;
    const track = doc.getElementsByTagNameNS('*', 'trk')[0];
    return {
        fixes,
        sport: normaliseSport(track ? text(track, 'type') : null),
        offsetMinutes: null,
    };
}

/** One `.tcx`: laps of `Trackpoint`s, timestamped in the local zone. */
export function parseTcx(xml: string): ParsedTrack | null {
    const doc = parseXml(xml);
    if (!doc) return null;

    const fixes: TrackFix[] = [];
    let offsetMinutes: number | null = null;
    const points = doc.getElementsByTagNameNS('*', 'Trackpoint');

    for (let i = 0; i < points.length; i++) {
        const point = points[i];
        const stamp = text(point, 'Time');
        const ms = instantMs(stamp);
        const position = point.getElementsByTagNameNS('*', 'Position')[0];
        // A `.tcx` keeps writing trackpoints indoors, and Strava's oldest ones
        // are a mix of positioned and bare points in one lap.
        if (ms == null || !position) continue;

        const lat = number(position, 'LatitudeDegrees');
        const lon = number(position, 'LongitudeDegrees');
        if (lat == null || lon == null) continue;

        offsetMinutes ??= statedOffsetMinutes(stamp);
        const heartRate = point.getElementsByTagNameNS('*', 'HeartRateBpm')[0];

        fixes.push({
            ms,
            lat,
            lon,
            distance: number(point, 'DistanceMeters'),
            speed: number(point, 'Speed'),
            altitude: number(point, 'AltitudeMeters'),
            heartRate: heartRate ? number(heartRate, 'Value') : null,
            cadence: number(point, 'Cadence') ?? number(point, 'RunCadence'),
        });
    }

    if (fixes.length === 0) return null;
    const activity = doc.getElementsByTagNameNS('*', 'Activity')[0];
    return {
        fixes,
        sport: normaliseSport(activity?.getAttribute('Sport')),
        offsetMinutes,
    };
}
