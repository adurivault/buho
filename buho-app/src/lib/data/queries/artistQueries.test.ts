import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getArtistAnalysis } from './artistQueries';
import * as db from '../db';

vi.mock('../db', () => ({
    query: vi.fn(),
}));

describe('artistQueries', () => {
    beforeEach(() => {
        vi.clearAllMocks();
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
                    repeatIntensityRaw: 2.7182,
                },
            ]);

            const result = await getArtistAnalysis(50);

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
                repeatIntensity: 2.718,
            });
        });

        it('should include reason computation blocks in SQL', async () => {
            vi.mocked(db.query).mockResolvedValue([]);

            await getArtistAnalysis(25);

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
});
