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
                totalMinutes: null,
                uniqueArtists: 0,
                uniqueTracks: 0,
                skipRate: null,
            });
        });

        it('keeps a duration and a skip rate nothing recorded apart from zero', async () => {
            // What a Last.fm-only history looks like: the counts are real, the
            // two aggregates over columns no scrobble carries come back NULL.
            vi.mocked(db.query).mockResolvedValue([
                {
                    totalMinutes: null,
                    uniqueArtists: 941,
                    uniqueTracks: 2224,
                    skipRate: null,
                },
            ]);

            const stats = await behaviorQueries.getMacroStats();

            expect(stats).toEqual({
                totalMinutes: null,
                uniqueArtists: 941,
                uniqueTracks: 2224,
                skipRate: null,
            });
        });

        it('should parse and return stats correctly', async () => {
            vi.mocked(db.query).mockResolvedValue([
                {
                    totalMinutes: 1234.5,
                    uniqueArtists: 50,
                    uniqueTracks: 100,
                    skipRate: 0.15,
                },
            ]);

            const stats = await behaviorQueries.getMacroStats();

            expect(stats).toEqual({
                totalMinutes: 1235,
                uniqueArtists: 50,
                uniqueTracks: 100,
                skipRate: 15,
            });
        });

        it('should handle filters if provided', async () => {
            vi.mocked(db.query).mockResolvedValue([
                {
                    totalMinutes: 100,
                    uniqueArtists: 10,
                    uniqueTracks: 20,
                    skipRate: 0.05,
                },
            ]);

            await behaviorQueries.getMacroStats({
                dateRange: { start: '2023-01-01', end: '2023-12-31' },
            });
            expect(db.query).toHaveBeenCalled();
        });
    });

    describe('getAllConnectablePoints', () => {
        it('should return connectable points with correct structure', async () => {
            vi.mocked(db.query).mockResolvedValue([
                {
                    x: 1672531200000,
                    y: 0.5,
                    track: 'Song A',
                    artist: 'Artist A',
                    playedAt: '2023-01-01T00:30:00Z',
                },
            ]);

            const result = await behaviorQueries.getAllConnectablePoints();

            expect(result).toHaveLength(1);
            expect(result[0].x).toBeDefined();
            expect(result[0].matched).toBe(true);
        });
    });

    describe('buildWhereExceptMultiple', () => {
        it('should keep only the timestamp guard when no filters are active', () => {
            expect(behaviorQueries.buildWhereExceptMultiple({}, [])).toBe(
                'WHERE timestamp IS NOT NULL'
            );
        });

        it('should build an IN condition', () => {
            const where = behaviorQueries.buildWhereExceptMultiple(
                { artist_name: ['Radiohead', 'Björk'] },
                []
            );

            expect(where).toContain("artist_name IN ('Radiohead', 'Björk')");
        });

        it('should read the search as a match over the play text, never as a column', () => {
            const where = behaviorQueries.buildWhereExceptMultiple(
                { search: "l'amour, remix" },
                []
            );

            expect(where).toContain('regexp_matches(');
            expect(where).toContain('track_name');
            expect(where).not.toMatch(/search\s*=/);
            // The quote in the query is escaped, not left to close the literal.
            expect(where).toContain("l''amour");
        });

        it('should ignore excluded keys', () => {
            const where = behaviorQueries.buildWhereExceptMultiple(
                {
                    artist_name: ['Radiohead'],
                    timestamp: { min: 0, max: 100 },
                    hour_of_day: { min: 8, max: 20 },
                },
                ['timestamp', 'hour_of_day']
            );

            expect(where).toContain('artist_name');
            expect(where).not.toContain('epoch_ms');
            expect(where).not.toContain('hour');
        });
    });
});
