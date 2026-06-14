import type { RawSpotifyEntry, SpotifyPlay } from '$lib/types/spotify';

/**
 * Normalize platform string to a clean category.
 * Handles various platform identifiers from Spotify exports.
 */
function cleanPlatform(platform: string): string {
    if (!platform) return "Other";
    const p = platform.toLowerCase();
    // Check Android and Windows first to avoid false iOS matches
    if (p.includes("android")) {
        return "Android";
    }
    if (p.includes("windows")) {
        return "Windows";
    }
    if (p.includes("ios")) {
        return "iOS";
    }
    if (p === "osx" || p.includes("os x") || p.includes("macos")) {
        return "macOS";
    }
    if (p.includes("web") || p.includes("browser")) {
        return "Web";
    }
    return "Other";
}

/**
 * Parse raw Spotify JSON data into structured SpotifyPlay objects.
 * 
 * @param jsonData - Array of raw Spotify entries from Takeout JSON files.
 *                   Must be a valid array (can be empty).
 * @returns Array of parsed SpotifyPlay objects, sorted by timestamp ascending.
 * @throws {Error} If jsonData is null, undefined, or not an array.
 */
export function parseSpotifyData(jsonData: RawSpotifyEntry[]): SpotifyPlay[] {
    // Input validation
    if (jsonData === null || jsonData === undefined) {
        throw new Error('parseSpotifyData: input cannot be null or undefined');
    }
    if (!Array.isArray(jsonData)) {
        throw new Error('parseSpotifyData: input must be an array');
    }

    // Pre-sort by timestamp to ensure play_count is assigned in chronological order
    // (important when multiple JSON files are merged before calling this function)
    const sortedEntries = [...jsonData].sort(
        (a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime()
    );

    const plays: SpotifyPlay[] = [];
    // Map<trackKey, playCount> — counts how many times each track has been heard
    const playCountMap = new Map<string, number>();

    for (const entry of sortedEntries) {
        const timestamp = new Date(entry.ts);
        const date = new Date(timestamp);
        date.setHours(0, 0, 0, 0); // Normalize to start of day

        const isPodcast = !!entry.episode_name;
        const mediaType: 'track' | 'podcast' = isPodcast ? 'podcast' : 'track';

        // Unique key per track: title+artist (Option B) so multiple URIs for the
        // same song share the same play_count counter.
        // Tradeoff: two different songs with identical title+artist would be merged.
        const trackKey = isPodcast
            ? `${entry.episode_name}|${entry.episode_show_name}`
            : `${entry.master_metadata_track_name}|${entry.master_metadata_album_artist_name}`;

        const prevCount = playCountMap.get(trackKey) ?? 0;
        const playCount = prevCount + 1;
        playCountMap.set(trackKey, playCount);

        plays.push({
            timestamp,
            date,
            hour: timestamp.getHours(),
            minute: timestamp.getMinutes(),
            msPlayed: entry.ms_played,
            // For podcasts: use episode name as track, show name as artist
            trackName: isPodcast ? (entry.episode_name ?? null) : (entry.master_metadata_track_name ?? null),
            artistName: isPodcast ? (entry.episode_show_name ?? null) : (entry.master_metadata_album_artist_name ?? null),
            albumName: isPodcast ? null : (entry.master_metadata_album_album_name ?? null),
            trackUri: isPodcast ? (entry.spotify_episode_uri ?? null) : (entry.spotify_track_uri ?? null),
            platform: entry.platform,
            platformClean: cleanPlatform(entry.platform),
            country: entry.conn_country,
            ipAddr: entry.ip_addr ?? null,
            // Recalculate skipped from reason_end: fwdbtn, backbtn, endplay → true
            skipped: ['fwdbtn', 'backbtn', 'endplay'].includes(entry.reason_end?.toLowerCase() ?? ''),
            shuffle: entry.shuffle,
            offline: entry.offline,
            reasonStart: entry.reason_start ?? null,
            reasonEnd: entry.reason_end ?? null,
            episodeName: entry.episode_name ?? null,
            episodeShowName: entry.episode_show_name ?? null,
            episodeUri: entry.spotify_episode_uri ?? null,
            incognitoMode: entry.incognito_mode ?? false,
            mediaType,
            playCount,
        });
    }

    // Already sorted by pre-sorting input above
    return plays;
}
