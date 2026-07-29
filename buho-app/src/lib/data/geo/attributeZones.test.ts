import { describe, it, expect, vi, beforeEach } from 'vitest';
import { attributeZones } from './attributeZones';
import { DEFAULT_BATCH_SIZE } from './attributionSql';

// The SQL itself is covered end-to-end against real DuckDB in
// attributeZones.headless.test.ts; here the DB is stubbed so the batching and
// the abort contract can be observed statement by statement.
const query = vi.hoisted(() => vi.fn());
vi.mock('../db', () => ({ query }));

const TOTAL_POSITIONS = DEFAULT_BATCH_SIZE * 3;

/** Every statement resolves; only the position count query returns a row. */
function stubDb() {
    query.mockImplementation(async (sql: string) =>
        sql.includes('count(*) AS total') ? [{ total: TOTAL_POSITIONS }] : []
    );
}

const batchStatements = () =>
    query.mock.calls.filter(([sql]) => String(sql).startsWith('INSERT INTO location_zones'));

describe('attributeZones', () => {
    beforeEach(() => {
        query.mockReset();
        stubDb();
    });

    it('resolves every batch and reports progress up to the total', async () => {
        const progress: [number, number][] = [];

        const completed = await attributeZones((p, t) => progress.push([p, t]));

        expect(completed).toBe(true);
        expect(batchStatements()).toHaveLength(3);
        expect(progress.at(-1)).toEqual([TOTAL_POSITIONS, TOTAL_POSITIONS]);
    });

    it('stops between batches when the run has been superseded', async () => {
        // A newer import lands while the first batch is being resolved.
        let aborted = false;
        const signal = { get aborted() { return aborted; } };

        const completed = await attributeZones(() => { aborted = true; }, signal);

        expect(completed).toBe(false);
        expect(batchStatements()).toHaveLength(1);
        // Crucially, it never reaches finalize: the UPDATE would otherwise write
        // into a segments table the new import has already rebuilt.
        expect(query.mock.calls.some(([sql]) =>
            String(sql).startsWith('UPDATE google_maps_segments'))).toBe(false);
    });

    it('does not even set up when it starts already superseded', async () => {
        const completed = await attributeZones(undefined, { aborted: true });

        expect(completed).toBe(false);
        expect(query).not.toHaveBeenCalled();
    });
});
