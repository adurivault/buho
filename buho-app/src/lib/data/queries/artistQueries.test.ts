
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as spotifyQueries from './spotifyQueries';
import * as db from '../db';

// Mock the db module
vi.mock('../db', () => ({
    query: vi.fn(),
}));

describe('Spotify Queries', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    // Story 3-4: Tests for visualization section queries
    describe('getTopArtists', () => {
        it('should return top artists with correct structure', async () => {
            vi.mocked(db.query).mockResolvedValue([
                { artist: 'Artist A', minutes: 1000 },
                { artist: 'Artist B', minutes: 500 }
            ]);

            const result = await spotifyQueries.getTopArtists(15);

            expect(result).toHaveLength(2);
            expect(result[0]).toEqual({ artist: 'Artist A', minutes: 1000 });
            expect(db.query).toHaveBeenCalled();
        });

        it('should throw an error on db failure', async () => {
            vi.mocked(db.query).mockRejectedValue(new Error('DB Error'));

            await expect(spotifyQueries.getTopArtists()).rejects.toThrow('DB Error');
        });
    });


    describe('getTopArtistsMonthlyAligned', () => {
        it('should return monthly aligned data for top artists', async () => {
            vi.mocked(db.query).mockResolvedValue([
                { artist: 'Artist A', monthIndex: 0, minutes: 120 },
                { artist: 'Artist A', monthIndex: 1, minutes: 180 },
                { artist: 'Artist B', monthIndex: 0, minutes: 90 }
            ]);

            const result = await spotifyQueries.getTopArtistsMonthlyAligned(20);

            expect(result).toHaveLength(3);
            expect(result[0]).toEqual({ artist: 'Artist A', monthIndex: 0, minutes: 120 });
            expect(db.query).toHaveBeenCalled();
            const sql = vi.mocked(db.query).mock.calls[0][0] as string;
            expect(sql).toContain('top_artists');
            expect(sql).toContain('DATE_DIFF');
            expect(sql).toContain('monthIndex');
        });

        it('should throw an error on db failure', async () => {
            vi.mocked(db.query).mockRejectedValue(new Error('DB Error'));

            await expect(spotifyQueries.getTopArtistsMonthlyAligned(20)).rejects.toThrow('DB Error');
        });
    });


    describe('getArtistAnalysis', () => {
        it('should return artist analytics with converted rates', async () => {
            vi.mocked(db.query).mockResolvedValue([
                {
                    artist: 'Artist A',
                    totalMinutes: 1234.56,
                    playCount: 321,
                    uniqueTracksRaw: 140,
                    intentionalStopRateRaw: 0.4123,
                    shuffleRateRaw: 0.6722,
                    intentionalStartRateRaw: 0.5555,
                    meanListenEpochSecondsRaw: 1704153600,
                    listenDateVarianceDays2Raw: 42.4242,
                    eveningRateRaw: 0.3456,
                    recencyDaysRaw: 12.34,
                    activeDaysRaw: 44,
                    skipRateRaw: 0.2199,
                    repeatIntensityRaw: 2.7182
                }
            ]);

            const result = await spotifyQueries.getArtistAnalysis(50);

            expect(result).toHaveLength(1);
            expect(result[0]).toEqual({
                artist: 'Artist A',
                totalMinutes: 1234.56,
                playCount: 321,
                uniqueTracks: 140,
                intentionalStopRate: 41.2,
                shuffleRate: 67.2,
                intentionalStartRate: 55.6,
                meanListenDateEpochMs: 1704153600000,
                listenDateVarianceDays2: 42.424,
                eveningRate: 34.6,
                recencyDays: 12.3,
                activeDays: 44,
                skipRate: 22,
                repeatIntensity: 2.718
            });
        });

        it('should include reason computation blocks in SQL', async () => {
            vi.mocked(db.query).mockResolvedValue([]);

            await spotifyQueries.getArtistAnalysis(25);

            const sql = String(vi.mocked(db.query).mock.calls[0][0]);
            expect(sql).toContain('reasonStart');
            expect(sql).toContain('reasonEnd IN');
            expect(sql).toContain('meanListenEpochSecondsRaw');
            expect(sql).toContain('listenDateVarianceDays2Raw');
            expect(sql).toContain('hourOfDay >= 19 OR hourOfDay <= 5');
            expect(sql).toContain('activeDaysRaw');
            expect(sql).toContain('uniqueTrackCount');
            expect(sql).toContain('skipRateRaw');
            expect(sql).toContain('repeatIntensityRaw');
            expect(sql).toContain('recencyDaysRaw');
        });
    });

    describe('getArtistAlbumTrackSunburst', () => {
        it('should return full track-level aggregates', async () => {
            vi.mocked(db.query).mockResolvedValue([
                { artist: 'Artist A', album: 'Album A', track: 'Song A', minutes: 120.5, playCount: 40, trackUri: 'spotify:track:a' },
                { artist: 'Artist A', album: 'Album A', track: 'Song B', minutes: 12.2, playCount: 9, trackUri: null }
            ]);

            const result = await spotifyQueries.getArtistAlbumTrackSunburst();

            expect(result).toHaveLength(2);
            expect(result[0]).toEqual({
                artist: 'Artist A',
                album: 'Album A',
                track: 'Song A',
                minutes: 120.5,
                playCount: 40,
                trackUri: 'spotify:track:a'
            });
        });

        it('should fall back labels for missing album/track and aggregate in SQL', async () => {
            vi.mocked(db.query).mockResolvedValue([
                { artist: 'Artist A', album: null, track: null, minutes: 5, playCount: 2 }
            ]);

            const result = await spotifyQueries.getArtistAlbumTrackSunburst();

            expect(result[0].album).toBe('Unknown album');
            expect(result[0].track).toBe('Unknown track');

            const sql = String(vi.mocked(db.query).mock.calls[0][0]);
            expect(sql).toContain('GROUP BY artist_name, album, track');
            expect(sql).toContain("COALESCE(album_name, 'Unknown album')");
        });

        it('should throw an error on db failure', async () => {
            vi.mocked(db.query).mockRejectedValue(new Error('DB Error'));

            await expect(spotifyQueries.getArtistAlbumTrackSunburst()).rejects.toThrow('DB Error');
        });
    });

});
