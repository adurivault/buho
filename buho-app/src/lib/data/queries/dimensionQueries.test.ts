import { describe, it, expect, vi } from 'vitest';
import { getTopItemsByDimensions } from './dimensionQueries';
import * as db from '../db';
import type { FilterState } from '$lib/types/filters';

vi.mock('../db', () => ({
    query: vi.fn(),
    withConnection: vi.fn((fn) => fn({}))
}));

describe('dimensionQueries', () => {
    describe('getTopItemsByDimensions', () => {
        it('executes a query containing UNION ALL CTEs', async () => {
            // db.ts transforms all column names to camelCase before returning results.
            // Mock must use camelCase keys to match production behavior.
            const mockData = [
                { dimensionName: 'artist', itemValue: 'The Beatles', itemCount: 10, totalMinutes: 50 }
            ];
            vi.mocked(db.query).mockResolvedValueOnce(mockData);

            const result = await getTopItemsByDimensions();

            expect(db.query).toHaveBeenCalled();
            const queryCall = vi.mocked(db.query).mock.calls[0][0] as string;
            // Verify our key elements are inside the generated sql
            expect(queryCall).toContain('UNION ALL');
            expect(queryCall).toContain('WITH artist AS');
            expect(queryCall).toContain('album AS');
            expect(queryCall).toContain('track AS');

            expect(result).toHaveLength(1);
            // Result is normalized back to snake_case DimensionAggregation interface
            expect(result[0]).toEqual({
                dimension_name: 'artist',
                item_value: 'The Beatles',
                item_count: 10,
                total_minutes: 50,
            });
        });

        it('cross-filter exclusion: artist CTE does not filter on artist_name', async () => {
            vi.mocked(db.query).mockResolvedValueOnce([]);

            const filters: FilterState = {
                artist_name: ['The Beatles']
            };

            await getTopItemsByDimensions(filters);

            expect(db.query).toHaveBeenCalled();
            const sql = vi.mocked(db.query).mock.calls[0][0] as string;

            // The SQL must include artist_name constraint somewhere (for other CTEs)
            // or at minimum be a valid multi-CTE query
            expect(sql).toContain('WITH artist AS');
            expect(sql).toContain('track AS');

            // Critical invariant: the artist CTE must NOT filter on artist_name
            // (it must see all artists, not just the selected one — cross-filter exclusion)
            const artistCteMatch = sql.match(/WITH artist AS \(([\s\S]*?)\),\s*album AS/);
            expect(artistCteMatch).not.toBeNull();
            const artistCteBody = artistCteMatch![1];
            expect(artistCteBody).not.toContain("artist_name IN");
        });
    });
});
