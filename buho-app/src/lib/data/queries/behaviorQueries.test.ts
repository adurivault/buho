import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as behaviorQueries from './behaviorQueries';
import * as db from '../db';

vi.mock('../db', () => ({
    query: vi.fn(),
}));

describe('Behavior Queries', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('getMacroStats', () => {
        it('should return default stats when no data is returned', async () => {
            vi.mocked(db.query).mockResolvedValue([]);

            const stats = await behaviorQueries.getMacroStats();

            expect(stats).toEqual({
                totalMinutes: 0,
                uniqueArtists: 0,
                uniqueTracks: 0,
                skipRate: 0
            });
        });

        it('should parse and return stats correctly', async () => {
            vi.mocked(db.query).mockResolvedValue([{
                totalMinutes: 1234.5,
                uniqueArtists: 50,
                uniqueTracks: 100,
                skipRate: 0.15
            }]);

            const stats = await behaviorQueries.getMacroStats();

            expect(stats).toEqual({
                totalMinutes: 1235,
                uniqueArtists: 50,
                uniqueTracks: 100,
                skipRate: 15
            });
        });

        it('should handle filters if provided', async () => {
            vi.mocked(db.query).mockResolvedValue([{
                totalMinutes: 100,
                uniqueArtists: 10,
                uniqueTracks: 20,
                skipRate: 0.05
            }]);

            await behaviorQueries.getMacroStats({ dateRange: { start: '2023-01-01', end: '2023-12-31' } } as any);
            expect(db.query).toHaveBeenCalled();
        });
    });

    describe('getPlatformDistribution', () => {
        it('should return platform distribution', async () => {
            vi.mocked(db.query).mockResolvedValue([
                { platform: 'macOS', minutes: 3000 },
                { platform: 'iOS', minutes: 1500 }
            ]);

            const result = await behaviorQueries.getPlatformDistribution();

            expect(result).toHaveLength(2);
            expect(result[0]).toEqual({ platform: 'macOS', minutes: 3000 });
        });
    });

    describe('getReasonStartDistribution', () => {
        it('should return reason_start distribution', async () => {
            vi.mocked(db.query).mockResolvedValue([
                { reason: 'trackdone', minutes: 4100 },
                { reason: 'fwdbtn', minutes: 1300 }
            ]);

            const result = await behaviorQueries.getReasonStartDistribution();

            expect(result).toHaveLength(2);
            expect(result[0]).toEqual({ reason: 'trackdone', minutes: 4100 });
        });
    });

    describe('getReasonEndDistribution', () => {
        it('should return reason_end distribution', async () => {
            vi.mocked(db.query).mockResolvedValue([
                { reason: 'trackdone', minutes: 3900 },
                { reason: 'endplay', minutes: 800 }
            ]);

            const result = await behaviorQueries.getReasonEndDistribution();

            expect(result).toHaveLength(2);
            expect(result[0]).toEqual({ reason: 'trackdone', minutes: 3900 });
        });
    });

    describe('getReasonStartEndFlow', () => {
        it('should return reason_start to reason_end flow', async () => {
            vi.mocked(db.query).mockResolvedValue([
                { reasonStart: 'trackdone', reasonEnd: 'trackdone', minutes: 2800 },
                { reasonStart: 'fwdbtn', reasonEnd: 'fwdbtn', minutes: 900 }
            ]);

            const result = await behaviorQueries.getReasonStartEndFlow();

            expect(result).toHaveLength(2);
            expect(result[0]).toEqual({
                reasonStart: 'trackdone',
                reasonEnd: 'trackdone',
                minutes: 2800
            });
        });
    });

    describe('getAllConnectablePoints', () => {
        it('should return connectable points with correct structure', async () => {
            vi.mocked(db.query).mockResolvedValue([{
                x: 1672531200000,
                y: 0.5,
                track: 'Song A',
                artist: 'Artist A',
                playedAt: '2023-01-01T00:30:00Z'
            }]);

            const result = await behaviorQueries.getAllConnectablePoints();

            expect(result).toHaveLength(1);
            expect(result[0].x).toBeDefined();
            expect(result[0].matched).toBe(true);
        });
    });

    describe('buildMatchExpression', () => {
        it('should return TRUE when no filters are active', () => {
            expect(behaviorQueries.buildMatchExpression({})).toBe('TRUE');
        });

        it('should build an IN condition wrapped in COALESCE', () => {
            const expression = behaviorQueries.buildMatchExpression({
                artist_name: ['Radiohead', 'Björk']
            });

            expect(expression).toContain("artist_name IN ('Radiohead', 'Björk')");
            expect(expression).toMatch(/^COALESCE\(/);
            expect(expression).toMatch(/, FALSE\)$/);
        });

        it('should ignore excluded keys', () => {
            const expression = behaviorQueries.buildMatchExpression(
                {
                    artist_name: ['Radiohead'],
                    timestamp: { min: 0, max: 100 },
                    hour_of_day: { min: 8, max: 20 }
                },
                ['timestamp', 'hour_of_day']
            );

            expect(expression).toContain('artist_name');
            expect(expression).not.toContain('timestamp');
            expect(expression).not.toContain('hour');
        });
    });

    describe('getExplorerConnectablePoints', () => {
        it('should flag rows instead of filtering them out', async () => {
            vi.mocked(db.query).mockResolvedValue([
                { x: 1672531200000, y: 0.5, track: 'Song A', artist: 'Artist A', playedAt: '2023-01-01T00:30:00Z', matched: true },
                { x: 1672617600000, y: 9.25, track: 'Song B', artist: 'Artist B', playedAt: '2023-01-02T09:15:00Z', matched: false }
            ]);

            const result = await behaviorQueries.getExplorerConnectablePoints({
                artist_name: ['Artist A']
            });

            const sql = vi.mocked(db.query).mock.calls[0][0] as string;
            // Dimension filters live in the matched flag, not in the WHERE clause
            expect(sql).toContain('as matched');
            expect(sql).toContain('WHERE timestamp IS NOT NULL');
            expect(sql.split('WHERE')[1]).not.toContain('artist_name');

            expect(result).toHaveLength(2);
            expect(result[0].matched).toBe(true);
            expect(result[1].matched).toBe(false);
        });
    });
});

