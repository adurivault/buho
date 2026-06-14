export interface SpotifyPlay {
    timestamp: Date;
    date: Date; // day only (for grouping)
    hour: number; // 0-23
    minute: number; // 0-59
    msPlayed: number;
    trackName: string | null;
    artistName: string | null;
    albumName: string | null;
    trackUri: string | null;
    platform: string;
    platformClean: string; // Normalized platform (macOS, iOS, Windows, Android, Web, Other)
    country: string;
    ipAddr: string | null;
    skipped: boolean;
    shuffle: boolean;
    offline: boolean;
    reasonStart: string | null;
    reasonEnd: string | null;
    episodeName: string | null;
    episodeShowName: string | null;
    episodeUri: string | null;
    incognitoMode: boolean;
    mediaType: 'track' | 'podcast';
    playCount: number; // nth time this track/episode has been played (1 = first ever listen)
}

/**
 * Raw Spotify export entry from Takeout JSON files.
 * Contains all fields from the Spotify extended streaming history export.
 * All fields are now mapped to SpotifyPlay.
 */
export interface RawSpotifyEntry {
    ts: string;
    platform: string;
    ms_played: number;
    conn_country: string;
    ip_addr: string;
    master_metadata_track_name: string | null;
    master_metadata_album_artist_name: string | null;
    master_metadata_album_album_name: string | null;
    spotify_track_uri: string | null;
    episode_name: string | null;
    episode_show_name: string | null;
    spotify_episode_uri: string | null;
    reason_start: string;
    reason_end: string;
    shuffle: boolean;
    skipped: boolean;
    offline: boolean;
    offline_timestamp: number | null;
    incognito_mode: boolean;
}
