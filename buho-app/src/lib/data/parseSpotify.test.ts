import { describe, it, expect } from 'vitest';
import { parseSpotifyData } from './parseSpotify';
import type { RawSpotifyEntry } from '$lib/types/spotify';

describe('parseSpotifyData', () => {
    it('parses valid Spotify entries correctly', () => {
        const mockData: RawSpotifyEntry[] = [
            {
                ts: "2023-10-27T10:30:00Z",
                platform: "iOS",
                ms_played: 180000,
                conn_country: "US",
                ip_addr: "127.0.0.1",
                master_metadata_track_name: "Test Track",
                master_metadata_album_artist_name: "Test Artist",
                master_metadata_album_album_name: "Test Album",
                spotify_track_uri: "spotify:track:123",
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
            }
        ];

        const result = parseSpotifyData(mockData);

        expect(result).toHaveLength(1);
        expect(result[0].trackName).toBe("Test Track");
        expect(result[0].artistName).toBe("Test Artist");
        expect(result[0].msPlayed).toBe(180000);
        expect(result[0].platformClean).toBe("iOS");
        expect(result[0].timestamp).toBeInstanceOf(Date);
    });

    it('handles missing optional fields by returning null', () => {
        const mockData: RawSpotifyEntry[] = [
            {
                ts: "2023-10-27T10:30:00Z",
                platform: "Windows",
                ms_played: 0,
                conn_country: "US",
                ip_addr: "127.0.0.1",
                master_metadata_track_name: null,
                master_metadata_album_artist_name: null,
                master_metadata_album_album_name: null,
                spotify_track_uri: null,
                episode_name: null,
                episode_show_name: null,
                spotify_episode_uri: null,
                reason_start: "appload",
                reason_end: "endplay",
                shuffle: false,
                skipped: true,
                offline: false,
                offline_timestamp: null,
                incognito_mode: false
            }
        ];

        const result = parseSpotifyData(mockData);

        expect(result).toHaveLength(1);
        expect(result[0].trackName).toBeNull();
        expect(result[0].artistName).toBeNull();
        expect(result[0].albumName).toBeNull();
        expect(result[0].trackUri).toBeNull();
        expect(result[0].skipped).toBe(true);
    });

    it('handles undefined platform gracefully', () => {
        const mockData = [{
            ts: "2023-10-27T10:30:00Z",
            // platform is missing
            ms_played: 180000,
            conn_country: "US",
            ip_addr: "127.0.0.1",
            master_metadata_track_name: "Test Track",
            master_metadata_album_artist_name: "Test Artist",
            master_metadata_album_album_name: "Test Album",
            spotify_track_uri: "spotify:track:123",
            skipped: false,
            offline: false,
            incognito_mode: false,
            reason_start: "trackdone",
            reason_end: "trackdone",
        }] as unknown as RawSpotifyEntry[];

        const result = parseSpotifyData(mockData);
        expect(result).toHaveLength(1);
        expect(result[0].platform).toBeUndefined(); // Or however we handle it
        expect(result[0].platformClean).toBe('Other');
    });

    it('handles empty input array', () => {
        const result = parseSpotifyData([]);
        expect(result).toHaveLength(0);
    });

    it('throws error for null input', () => {
        expect(() => parseSpotifyData(null as any)).toThrow('input cannot be null or undefined');
    });

    it('throws error for undefined input', () => {
        expect(() => parseSpotifyData(undefined as any)).toThrow('input cannot be null or undefined');
    });

    it('throws error for non-array input', () => {
        expect(() => parseSpotifyData("not an array" as any)).toThrow('input must be an array');
        expect(() => parseSpotifyData({} as any)).toThrow('input must be an array');
        expect(() => parseSpotifyData(123 as any)).toThrow('input must be an array');
    });

    it('sorts entries by timestamp ascending', () => {
        const mockData: RawSpotifyEntry[] = [
            {
                ts: "2023-10-27T12:00:00Z",
                platform: "Web",
                ms_played: 100,
                conn_country: "FR",
                ip_addr: "1.1.1.1",
                master_metadata_track_name: "Second",
                master_metadata_album_artist_name: "Artist",
                master_metadata_album_album_name: "Album",
                spotify_track_uri: "uri:2",
                episode_name: null,
                episode_show_name: null,
                spotify_episode_uri: null,
                reason_start: "click",
                reason_end: "end",
                shuffle: false,
                skipped: false,
                offline: false,
                offline_timestamp: null,
                incognito_mode: false
            },
            {
                ts: "2023-10-27T10:00:00Z",
                platform: "Web",
                ms_played: 100,
                conn_country: "FR",
                ip_addr: "1.1.1.1",
                master_metadata_track_name: "First",
                master_metadata_album_artist_name: "Artist",
                master_metadata_album_album_name: "Album",
                spotify_track_uri: "uri:1",
                episode_name: null,
                episode_show_name: null,
                spotify_episode_uri: null,
                reason_start: "click",
                reason_end: "end",
                shuffle: false,
                skipped: false,
                offline: false,
                offline_timestamp: null,
                incognito_mode: false
            }
        ];

        const result = parseSpotifyData(mockData);

        expect(result).toHaveLength(2);
        expect(result[0].trackName).toBe("First");
        expect(result[1].trackName).toBe("Second");
    });
});
