/**
 * The glyphs {@link Icon} can draw, named after what they depict rather than
 * where they're used.
 *
 * Naming them by shape is what lets the two axes disagree where they should:
 * the Steps *dataset* is footprints, while Garmin the *device maker* is its
 * triangle — one glyph per meaning, not one per row of a table. Same for
 * Listening, which is a note: Spotify, Deezer and Last.fm each keep their own
 * mark, on the rows that are actually about them.
 */
export type IconName =
    | 'music-note'
    | 'spotify'
    | 'deezer'
    | 'lastfm'
    | 'map-pin'
    | 'message'
    | 'google-activity'
    | 'footprints'
    | 'heartbeat'
    | 'garmin'
    | 'apple-health'
    | 'strava'
    | 'calendar';
