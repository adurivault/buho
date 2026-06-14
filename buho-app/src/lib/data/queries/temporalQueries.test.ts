import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as temporalQueries from './temporalQueries';
import * as db from '../db';

vi.mock('../db', () => ({
    query: vi.fn(),
}));

describe('Temporal Queries', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('getDailyAnalysis', () => {
        it('should return daily metrics rows', async () => {
            vi.mocked(db.query).mockResolvedValue([
                {
                    date: '2025-02-01',
                    dateEpochMs: 1738368000000,
                    playCount: 120,
                    totalMinutes: 410.5,
                    uniqueArtists: 38,
                    uniqueTracks: 76,
                    maxSameTrackPlays: 9,
                    shuffleRateRaw: 0.52,
                    intentionalStopRateRaw: 0.31,
                    intentionalStartRateRaw: 0.47,
                    skipRateRaw: 0.22,
                    eveningRateRaw: 0.44,
                    meanListenHourRaw: 18.375,
                    repeatIntensityRaw: 1.578
                }
            ]);

            const result = await temporalQueries.getDailyAnalysis();

            expect(result).toHaveLength(1);
            expect(result[0]).toMatchObject({
                playCount: 120,
                totalMinutes: 410.5
            });
        });
    });

    describe('getTracklistSizeOverTime', () => {
        it('should return timeline points with mapped tracklist size', async () => {
            vi.mocked(db.query).mockResolvedValue([
                { date: '2025-02-01', tracklistSize: 128 },
                { date: '2025-02-02', tracklistSize: 131 }
            ]);

            const result = await temporalQueries.getTracklistSizeOverTime(5, 3);

            expect(result).toEqual([
                { date: '2025-02-01', tracklistSize: 128 },
                { date: '2025-02-02', tracklistSize: 131 }
            ]);
        });
    });
});
