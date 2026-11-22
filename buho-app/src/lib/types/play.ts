/**
 * One play, whichever service recorded it.
 *
 * Spotify, Deezer and Last.fm land in the same `plays` table, the way Messenger,
 * Instagram and WhatsApp share `messages` — so this is the union of what the
 * exports carry, not the intersection. Fields only some of them record are
 * nullable and are NULL for the others; the views that depend on them say so
 * rather than pretending a missing flag is a `false`.
 *
 * The three are unequal by a wide margin: Spotify records how a play went, Deezer
 * records that it happened and for how long, and a Last.fm scrobble records only
 * that it happened. Most of this interface is therefore NULL for a scrobble.
 */

export type PlaySource = 'spotify' | 'deezer' | 'lastfm';

export interface Play {
    /** Which export this row came out of. Never inferred — routing knows it. */
    source: PlaySource;
    timestamp: Date;
    /** Day only, for grouping. */
    date: Date;
    /**
     * Milliseconds actually listened, or null when the export doesn't say.
     * Deezer writes `-1` for roughly one row in twenty-five — mostly its oldest —
     * and that is "unknown", not "skipped instantly", so it stays NULL and drops
     * out of every SUM rather than dragging averages to zero. A Last.fm scrobble
     * carries no duration at all, so it is NULL for every one of them.
     */
    msPlayed: number | null;
    trackName: string | null;
    artistName: string | null;
    albumName: string | null;
    /** Spotify only — the `spotify:track:…` URI the sunburst opens. */
    trackUri: string | null;
    /** Deezer only — the recording's ISRC, the one stable id it ships. */
    isrc: string | null;
    platform: string | null;
    /**
     * Normalized device family: macOS, iOS, Windows, Android, Web, Desktop,
     * Other — or Unknown for Last.fm, which names no device at all. "Other"
     * means a device that was recorded and wasn't one of the known ones, which
     * is a different statement.
     */
    platformClean: string;
    /** Spotify only — neither Deezer's export nor a scrobble carries a country. */
    country: string | null;
    ipAddr: string | null;
    /**
     * Spotify only, and derived from `reason_end` rather than its own `skipped`
     * field. Neither Deezer nor Last.fm records why a track ended, so this is
     * NULL there.
     */
    skipped: boolean | null;
    shuffle: boolean | null;
    offline: boolean | null;
    reasonStart: string | null;
    reasonEnd: string | null;
    episodeName: string | null;
    episodeShowName: string | null;
    episodeUri: string | null;
    incognitoMode: boolean | null;
    /**
     * Deezer's listening history holds no podcasts — it keeps them on a separate
     * sheet with no play records — and podcast listening isn't scrobbled, so
     * every Deezer and Last.fm row is a track.
     */
    mediaType: 'track' | 'podcast';
}
