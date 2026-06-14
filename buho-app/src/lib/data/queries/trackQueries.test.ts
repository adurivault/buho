import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as trackQueries from './trackQueries';
import * as db from '../db';

vi.mock('../db', () => ({
    query: vi.fn(),
}));

describe('Track Queries', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('getTopTracks', () => {
        it('should return top tracks with correct structure', async () => {
            vi.mocked(db.query).mockResolvedValue([
                { track: 'Song A', artist: 'Artist A', plays: 100, minutes: 300 }
            ]);

            const result = await trackQueries.getTopTracks(10);

            expect(result).toHaveLength(1);
            expect(result[0]).toEqual({ track: 'Song A', artist: 'Artist A', plays: 100, minutes: 300 });
        });
    });

    describe('getTrackAnalysis', () => {
        it('should return track metrics rows', async () => {
            vi.mocked(db.query).mockResolvedValue([
                {
                    artist: 'Artist A',
                    track: 'Song A',
                    playCount: 88,
                    totalMinutes: 240.2,
                    intentionalityRateRaw: 0.44,
                    skipRateRaw: 0.19,
                    recencyDaysRaw: 7.66,
                    maxSameDayPlays: 11,
                    artistPrevalenceRateRaw: 0.184,
                    activeDaysRaw: 26
                }
            ]);

            const result = await trackQueries.getTrackAnalysis(500);

            expect(result).toHaveLength(1);
            expect(result[0]).toEqual({
                artist: 'Artist A',
                track: 'Song A',
                playCount: 88,
                totalMinutes: 240.2,
                intentionalityRate: 44,
                skipRate: 19,
                recencyDays: 7.7,
                maxSameDayPlays: 11,
                artistPrevalenceRate: 18.4,
                activeDays: 26
            });
        });
    });
});
