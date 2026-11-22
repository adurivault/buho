import { describe, expect, test } from 'vitest';
import {
    DIAL_ORDER,
    dialAt,
    dialPaths,
    dialPoint,
    quarterGrid,
    quarterSteps,
    type DialGeometry,
    type QuarterCell,
} from './clock';

describe('DIAL_ORDER', () => {
    test('paints what runs on under what happens in an instant', () => {
        const at = (id: (typeof DIAL_ORDER)[number]) => DIAL_ORDER.indexOf(id);
        expect(at('steps')).toBeLessThan(at('listening'));
        expect(at('positions')).toBeLessThan(at('messages'));
        expect(DIAL_ORDER.at(-1)).toBe('messages');
    });
});

describe('the dial', () => {
    const g: DialGeometry = { cx: 100, cy: 100, inner: 20, outer: 80, days: 30, gap: 0.1 };

    test('finds the day and time back from where it draws them', () => {
        for (const [day, time] of [
            [0, 0.1],
            [7, 0.5],
            [29, 0.99],
        ]) {
            const [x, y] = dialPoint(g, day + 0.5, time);
            const at = dialAt(g, x, y);
            expect(at?.day).toBe(day);
            expect(at?.time).toBeCloseTo(time);
        }
    });

    test('starts the year just right of the top and turns it halfway at the bottom', () => {
        const [x, y] = dialPoint(g, 0, 0.5);
        expect(x).toBeGreaterThan(g.cx);
        expect(y).toBeLessThan(g.cy);
        const [, bottom] = dialPoint(g, 15, 0.5);
        expect(bottom).toBeCloseTo(g.cy + 50);
    });

    test('puts midnight at the inner edge and the end of the day at the rim', () => {
        const radius = ([x, y]: [number, number]) => Math.hypot(x - g.cx, y - g.cy);
        expect(radius(dialPoint(g, 4, 0))).toBeCloseTo(g.inner);
        expect(radius(dialPoint(g, 4, 1))).toBeCloseTo(g.outer);
    });

    test('is empty in the hole, past the rim and in the gap at the top', () => {
        expect(dialAt(g, 100, 100)).toBeNull();
        expect(dialAt(g, 100, 195)).toBeNull();
        expect(dialAt(g, 100, 50)).toBeNull();
    });
});

describe('quarterSteps', () => {
    const cells = (values: number[]): QuarterCell[] =>
        values.map((value, quarter) => ({ date: '2025-01-01', quarter, value }));

    test('cuts the values at quantiles, so each step holds about as many quarter-hours', () => {
        expect(quarterSteps(cells([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), 5)).toEqual([2, 4, 6, 8]);
    });

    test('keeps cuts that fall together once, and none at the top', () => {
        // Mostly single plays: three steps, each with something on it.
        expect(quarterSteps(cells([1, 1, 1, 1, 1, 1, 2, 3, 5, 9]), 5)).toEqual([1, 3]);
        expect(quarterSteps(cells([4, 4, 4]), 5)).toEqual([]);
        expect(quarterSteps([], 5)).toEqual([]);
    });
});

describe('quarterGrid', () => {
    test('puts each quarter-hour a module did anything in on its step, 0 elsewhere', () => {
        const grid = quarterGrid(
            [
                { date: '2025-01-01', quarter: 32, value: 10 },
                { date: '2025-01-02', quarter: 95, value: 0.5 },
                { date: '2025-01-02', quarter: 20, value: 0 },
                // Outside the year.
                { date: '2024-12-31', quarter: 4, value: 99 },
            ],
            ['2025-01-01', '2025-01-02'],
            [1, 5]
        );
        expect(grid).toHaveLength(192);
        expect(grid[32]).toBe(3);
        expect(grid[96 + 95]).toBe(1);
        expect(grid.filter((v) => v > 0)).toHaveLength(2);
    });
});

describe('dialPaths', () => {
    const g: DialGeometry = { cx: 100, cy: 100, inner: 10, outer: 50, days: 2, gap: 0.04 };

    test("draws each run of quarter-hours on one step as one wedge of its day, in that step's path", () => {
        const grid = new Uint8Array(192);
        grid[32] = 1;
        grid[33] = 1;
        grid[34] = 2;
        grid[96 + 10] = 1;
        const [low, high] = dialPaths(grid, g, 2);

        // 08:00–08:30 on the first day and 02:30–02:45 on the second, then 08:30–08:45.
        const wedges = (d: string) => d.split('M').slice(1);
        expect(wedges(low)).toHaveLength(2);
        expect(wedges(high)).toHaveLength(1);
        for (const wedge of [...wedges(low), ...wedges(high)]) {
            expect(wedge.split('L')).toHaveLength(4);
            expect(wedge.endsWith('Z')).toBe(true);
        }
        expect(dialPaths(new Uint8Array(192), g, 2)).toEqual(['', '']);
    });
});
