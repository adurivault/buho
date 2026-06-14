import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { initDuckDB, insertSpotifyPlays, query, dropTable, isReady } from './db';
import { parseSpotifyData } from './parseSpotify';
import type { SpotifyPlay, RawSpotifyEntry } from '$lib/types/spotify';

/**
 * Integration tests for the Spotify Data Pipeline.
 * 
 * These tests verify the complete flow: Parse JSON -> Insert into DuckDB -> Query back.
 * 
 * IMPORTANT: These tests require a browser-like environment with Web Worker support.
 * They are skipped by default in Node/JSDOM environments.
 * 
 * To run manually in a browser environment:
 * 1. Remove .skip from describe
 * 2. Run tests in a browser test runner (e.g., Playwright component testing)
 * 
 * The unit tests in parseSpotify.test.ts and db.test.ts cover the logic independently.
 */

// Sample test data for integration testing
const SAMPLE_RAW_ENTRY: RawSpotifyEntry = {
    ts: "2023-10-27T10:30:00Z",
    platform: "iOS",
    ms_played: 180000,
    conn_country: "FR",
    ip_addr: "127.0.0.1",
    master_metadata_track_name: "Integration Test Track",
    master_metadata_album_artist_name: "Test Artist",
    master_metadata_album_album_name: "Test Album",
    spotify_track_uri: "spotify:track:integration123",
    episode_name: null,
    episode_show_name: null,
    spotify_episode_uri: null,
    reason_start: "trackdone",
    reason_end: "trackdone",
    shuffle: false,
    skipped: false,
    offline: false,
    offline_timestamp: null,
    incognito_mode: false
};

describe.skip('Spotify Data Pipeline Integration', () => {
    // NOTE: Skip by default - requires browser environment with Web Worker support.
    // DuckDB-WASM uses Web Workers which don't work in JSDOM.

    beforeAll(async () => {
        await initDuckDB();
    });

    afterAll(async () => {
        if (isReady()) {
            await dropTable('spotify_plays');
        }
    });

    it('should parse, insert, and query Spotify data correctly', async () => {
        // 1. Parse raw data
        const parsed = parseSpotifyData([SAMPLE_RAW_ENTRY]);
        expect(parsed).toHaveLength(1);
        expect(parsed[0].trackName).toBe("Integration Test Track");

        // 2. Insert into DuckDB
        await insertSpotifyPlays(parsed);

        // 3. Query back
        const results = await query<SpotifyPlay>('SELECT * FROM spotify_plays');
        expect(results).toHaveLength(1);
        expect(results[0].trackName).toBe("Integration Test Track");
        expect(results[0].artistName).toBe("Test Artist");
        expect(results[0].msPlayed).toBe(180000);
    });

    it('should handle multiple entries', async () => {
        const entries: RawSpotifyEntry[] = [
            { ...SAMPLE_RAW_ENTRY, ts: "2023-10-27T11:00:00Z", master_metadata_track_name: "Track 1" },
            { ...SAMPLE_RAW_ENTRY, ts: "2023-10-27T12:00:00Z", master_metadata_track_name: "Track 2" },
        ];

        const parsed = parseSpotifyData(entries);
        await dropTable('spotify_plays'); // Clean slate
        await insertSpotifyPlays(parsed);

        const results = await query<SpotifyPlay>('SELECT * FROM spotify_plays ORDER BY timestamp');
        expect(results).toHaveLength(2);
        expect(results[0].trackName).toBe("Track 1");
        expect(results[1].trackName).toBe("Track 2");
    });

    it('should preserve null values through pipeline', async () => {
        const entryWithNulls: RawSpotifyEntry = {
            ...SAMPLE_RAW_ENTRY,
            master_metadata_track_name: null,
            master_metadata_album_artist_name: null,
        };

        const parsed = parseSpotifyData([entryWithNulls]);
        await dropTable('spotify_plays');
        await insertSpotifyPlays(parsed);

        const results = await query<SpotifyPlay>('SELECT * FROM spotify_plays');
        expect(results[0].trackName).toBeNull();
        expect(results[0].artistName).toBeNull();
    });
});
