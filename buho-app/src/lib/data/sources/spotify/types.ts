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
