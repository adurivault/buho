import { describe, expect, it } from 'vitest';
import { coverageOf, yearRows, type YearSummary } from './years';

const summary = (
    module: YearSummary['module'],
    year: number,
    total: number,
    firstDay = `${year}-01-01`,
    lastDay = `${year}-12-31`
): YearSummary => ({ module, year, total, firstDay, lastDay });

describe('yearRows', () => {
    it('scales each module against its own best year', () => {
        const rows = yearRows([
            summary('steps', 2024, 2_000_000),
            summary('steps', 2025, 4_000_000),
            summary('messages', 2024, 300),
            summary('messages', 2025, 100),
        ]);

        expect(rows.map((r) => r.year)).toEqual([2024, 2025]);
        expect(rows[0].glyphs.steps?.share).toBe(0.5);
        expect(rows[1].glyphs.steps?.share).toBe(1);
        expect(rows[0].glyphs.messages?.share).toBe(1);
        expect(rows[1].glyphs.messages?.share).toBeCloseTo(1 / 3);
    });

    it('keeps a year nothing was recorded in, empty, in its place', () => {
        const rows = yearRows([summary('listening', 2021, 10), summary('listening', 2023, 20)]);

        expect(rows.map((r) => r.year)).toEqual([2021, 2022, 2023]);
        expect(rows[1]).toEqual({
            year: 2022,
            glyphs: {},
            firstDay: null,
            lastDay: null,
            to: null,
        });
    });

    it('says when a module started late or stopped early, past two weeks of slack', () => {
        const [row] = yearRows([
            summary('health', 2024, 200, '2024-03-10', '2024-12-31'),
            summary('messages', 2024, 50, '2024-01-12', '2024-12-20'),
            summary('activity', 2024, 80, '2024-01-01', '2024-11-02'),
        ]);

        expect(row.glyphs.health).toMatchObject({ from: '2024-03-10', to: null });
        // The 12th of January and the 20th of December are both inside the slack.
        expect(row.glyphs.messages).toMatchObject({ from: null, to: null });
        expect(row.glyphs.activity).toMatchObject({ from: null, to: '2024-11-02' });
        // Something ran to the 31st, so the year itself is whole.
        expect(row.to).toBeNull();
        expect([row.firstDay, row.lastDay]).toEqual(['2024-01-01', '2024-12-31']);
    });

    it('marks the year partial when every module stops early', () => {
        const [row] = yearRows([
            summary('listening', 2026, 900, '2026-01-01', '2026-11-02'),
            summary('steps', 2026, 1_000, '2026-01-01', '2026-10-30'),
        ]);

        expect(row.to).toBe('2026-11-02');
    });

    it('gives a module whose best year is zero a flat bar, not NaN', () => {
        const [row] = yearRows([summary('listening', 2019, 0)]);
        expect(row.glyphs.listening?.share).toBe(0);
    });

    it('returns no row for no data', () => {
        expect(yearRows([])).toEqual([]);
    });
});

describe('coverageOf', () => {
    it('spans each module from its first day to its last, across years', () => {
        const coverage = coverageOf([
            summary('messages', 2023, 1, '2023-05-04', '2023-12-31'),
            summary('messages', 2024, 1, '2024-01-01', '2024-08-15'),
            summary('steps', 2024, 1, '2024-03-10', '2024-12-31'),
        ]);

        expect(coverage).toEqual({
            messages: { first: '2023-05-04', last: '2024-08-15' },
            steps: { first: '2024-03-10', last: '2024-12-31' },
        });
    });
});
