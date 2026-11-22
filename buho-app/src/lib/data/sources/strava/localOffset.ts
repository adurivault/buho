/**
 * Deciding what time of day a track happened, when the file doesn't say.
 *
 * Every table in Buho stores the wall clock its owner lived, and most exports
 * carry what it takes to work that out: a watch records the offset it was set
 * to, Google Timeline stamps its own. A Strava `.gpx` records neither — the
 * whole file is normalised to UTC — and so does a `.fit` Strava converted from
 * one. Left at UTC, an evening run in Paris is filed at 17:00 and every
 * hour-of-day view built on it is wrong by an hour or two.
 *
 * So it is inferred, from the two things actually available: the longitude of
 * the start, and the zone the browser doing the import is in.
 */

/** Minutes to add to UTC for the sun to be overhead at noon at this longitude. */
export function solarOffsetMinutes(lon: number): number {
    return Math.round(lon / 15) * 60;
}

/** What the importing machine's own zone was at that instant, DST included. */
export function browserOffsetMinutes(instantMs: number): number {
    return -new Date(instantMs).getTimezoneOffset();
}

/**
 * The offset to file a track under.
 *
 * The sun gives a coarse answer everywhere — good to the hour, blind to DST and
 * to where a border was drawn. The browser's zone gives an exact one, DST and
 * all, but only for activities that happened in it. So the sun is used to decide
 * *whether* the browser's zone applies: within two hours of solar time the
 * activity is plausibly at home and the precise answer wins, and beyond that it
 * is a trip and the coarse one is the only one left.
 *
 * Two hours rather than one because a zone can legitimately sit that far from
 * its own sun in summer — Paris runs at UTC+2 on a longitude whose solar time is
 * UTC — and being an hour out on a run abroad costs less than being an hour out
 * on every run at home.
 */
export function inferredOffsetMinutes(
    instantMs: number,
    lon: number,
    localOffset = browserOffsetMinutes(instantMs)
): number {
    const solar = solarOffsetMinutes(lon);
    return Math.abs(localOffset - solar) <= 120 ? localOffset : solar;
}
