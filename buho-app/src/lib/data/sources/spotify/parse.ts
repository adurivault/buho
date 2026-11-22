import type { Play } from '#lib/types/play.ts';
import type { RawSpotifyEntry } from '#lib/data/sources/spotify/types.ts';

/**
 * Normalize platform string to a clean category.
 * Handles various platform identifiers from Spotify exports.
 */
function cleanPlatform(platform: string): string {
    if (!platform) return 'Other';
    const p = platform.toLowerCase();
    // Check Android and Windows first to avoid false iOS matches
    if (p.includes('android')) {
        return 'Android';
    }
    if (p.includes('windows')) {
        return 'Windows';
    }
    if (p.includes('ios')) {
        return 'iOS';
    }
    if (p === 'osx' || p.includes('os x') || p.includes('macos')) {
        return 'macOS';
    }
    if (p.includes('web') || p.includes('browser')) {
        return 'Web';
    }
    return 'Other';
}

/**
 * True for an entry carrying Spotify's streaming-history shape. Used both to
 * skip the other JSON files in an export and to score the file during routing.
 */
export function isSpotifyEntry(value: unknown): value is RawSpotifyEntry {
    if (!value || typeof value !== 'object') return false;
    const entry = value as Record<string, unknown>;
    return typeof entry.ts === 'string' && 'ms_played' in entry;
}

/**
 * Parse raw Spotify JSON data into structured play records.
 *
 * @param jsonData - Array of raw Spotify entries from Takeout JSON files.
 *                   Must be a valid array (can be empty).
 * @returns Array of parsed plays, sorted by timestamp ascending.
 * @throws {Error} If jsonData is null, undefined, or not an array.
 */
export function parseSpotifyData(jsonData: RawSpotifyEntry[]): Play[] {
    // Input validation
    if (jsonData === null || jsonData === undefined) {
        throw new Error('parseSpotifyData: input cannot be null or undefined');
    }
    if (!Array.isArray(jsonData)) {
        throw new Error('parseSpotifyData: input must be an array');
    }

    const sortedEntries = [...jsonData].sort(
        (a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime()
    );

    const plays: Play[] = [];

    for (const entry of sortedEntries) {
        const timestamp = new Date(entry.ts);
        const date = new Date(timestamp);
        date.setHours(0, 0, 0, 0); // Normalize to start of day

        const isPodcast = !!entry.episode_name;
        const mediaType: 'track' | 'podcast' = isPodcast ? 'podcast' : 'track';

        plays.push({
            source: 'spotify',
            timestamp,
            date,
            msPlayed: entry.ms_played,
            // For podcasts: use episode name as track, show name as artist
            trackName: isPodcast
                ? (entry.episode_name ?? null)
                : (entry.master_metadata_track_name ?? null),
            artistName: isPodcast
                ? (entry.episode_show_name ?? null)
                : (entry.master_metadata_album_artist_name ?? null),
            albumName: isPodcast ? null : (entry.master_metadata_album_album_name ?? null),
            trackUri: isPodcast
                ? (entry.spotify_episode_uri ?? null)
                : (entry.spotify_track_uri ?? null),
            // Spotify's export carries no ISRC.
            isrc: null,
            platform: entry.platform,
            platformClean: cleanPlatform(entry.platform),
            country: entry.conn_country,
            ipAddr: entry.ip_addr ?? null,
            // Recalculate skipped from reason_end: fwdbtn, backbtn, endplay → true
            skipped: ['fwdbtn', 'backbtn', 'endplay'].includes(
                entry.reason_end?.toLowerCase() ?? ''
            ),
            shuffle: entry.shuffle,
            offline: entry.offline,
            reasonStart: entry.reason_start ?? null,
            reasonEnd: entry.reason_end ?? null,
            episodeName: entry.episode_name ?? null,
            episodeShowName: entry.episode_show_name ?? null,
            episodeUri: entry.spotify_episode_uri ?? null,
            incognitoMode: entry.incognito_mode ?? false,
            mediaType,
        });
    }

    // Already sorted by pre-sorting input above
    return plays;
}
