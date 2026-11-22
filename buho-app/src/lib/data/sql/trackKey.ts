/**
 * How a track is identified across services.
 *
 * Deezer ships no Spotify URI and Spotify ships no ISRC, so neither id can be
 * the key: the two exports have no track identifier in common at all. Title +
 * artist, case-folded, is what they do share — and it is already how Spotify's
 * own play counter was keyed, so nothing about single-source behaviour changes.
 *
 * The cost is the same as it was: two genuinely different songs with identical
 * title and artist collapse into one.
 *
 * Kept in its own module, free of any import, because both sides need it — the
 * importer in `db/plays.ts` ranks plays with it, and the query layer groups by it —
 * and neither should have to depend on the other to say what a track is.
 *
 * @param prefix table alias to qualify the columns with, e.g. `'p.'`.
 */
export function trackKeySql(prefix = ''): string {
    return `(
        LOWER(COALESCE(NULLIF(TRIM(${prefix}track_name), ''), '__unknown_track__'))
        || ' :: ' ||
        LOWER(COALESCE(NULLIF(TRIM(${prefix}artist_name), ''), '__unknown_artist__'))
    )`;
}
