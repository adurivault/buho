import { describe, expect, it } from 'vitest';
import { buildYearDays, daysOfYear, layOnYear, standoutModules, type DayValue } from './days';

describe('daysOfYear', () => {
    it('lists every day of the year once, leap days included', () => {
        const leap = daysOfYear(2024);
        expect(leap).toHaveLength(366);
        expect(leap[0]).toBe('2024-01-01');
        expect(leap[59]).toBe('2024-02-29');
        expect(leap[365]).toBe('2024-12-31');
        expect(daysOfYear(2025)).toHaveLength(365);
    });

    it('keeps the days the clocks change on, once each', () => {
        const days = daysOfYear(2025);
        expect(days.filter((d) => d === '2025-03-30')).toHaveLength(1);
        expect(days.filter((d) => d === '2025-10-26')).toHaveLength(1);
        expect(new Set(days).size).toBe(days.length);
    });
});

describe('layOnYear', () => {
    const days = ['2025-01-01', '2025-01-02', '2025-01-03', '2025-01-04'];
    const values: DayValue[] = [{ date: '2025-01-02', value: 7 }];

    it('reads a silent day inside the export as zero for a log', () => {
        const coverage = { first: '2025-01-02', last: '2025-01-03' };
        expect(layOnYear(days, values, coverage, true)).toEqual([null, 7, 0, null]);
    });

    it('leaves a silent day as a hole for a recorder', () => {
        const coverage = { first: '2024-06-01', last: '2025-06-01' };
        expect(layOnYear(days, values, coverage, false)).toEqual([null, 7, null, null]);
    });

    it('knows nothing of a day without coverage, log or not', () => {
        expect(layOnYear(days, values, undefined, true)).toEqual([null, 7, null, null]);
    });
});

describe('standoutModules', () => {
    it('picks the module whose bar stands tallest that day', () => {
        const standout = standoutModules(
            { listening: [60, 10], messages: [3, 50] },
            { listening: [0.9, 0.2], messages: [0.4, 0.95] },
            2
        );
        expect(standout).toEqual([
            { module: 'listening', fill: 0.9 },
            { module: 'messages', fill: 0.95 },
        ]);
    });

    it('tells two full bars apart by how far past the top each went', () => {
        const standout = standoutModules(
            { listening: [500], messages: [90] },
            { listening: [2.5], messages: [1.2] },
            1
        );
        expect(standout).toEqual([{ module: 'listening', fill: 1 }]);
    });

    it('lets no module stand out on a day it recorded nothing', () => {
        const standout = standoutModules(
            { listening: [0], steps: [null] },
            { listening: [0], steps: [null] },
            1
        );
        expect(standout).toEqual([null]);
    });

    it('settles an exact tie by the order of the modules', () => {
        const standout = standoutModules(
            { messages: [4], listening: [9] },
            { messages: [0.7], listening: [0.7] },
            1
        );
        expect(standout[0]?.module).toBe('listening');
    });
});

describe('buildYearDays', () => {
    it('lays every loaded module on the year, on its lane’s scale', () => {
        const year = buildYearDays(
            2025,
            {
                messages: [
                    { date: '2025-01-01', value: 4 },
                    { date: '2025-01-03', value: 12 },
                ],
                steps: [{ date: '2025-01-02', value: 8000 }],
            },
            {
                messages: { first: '2024-11-20', last: '2025-01-03' },
                steps: { first: '2025-01-02', last: '2025-01-02' },
            }
        );

        expect(year.days).toHaveLength(365);
        expect(year.values.listening).toBeUndefined();
        expect(year.values.messages?.slice(0, 4)).toEqual([4, 0, 12, null]);
        expect(year.values.steps?.slice(0, 3)).toEqual([null, 8000, null]);
        // Messages fill their lane at the 98th percentile of 4 and 12: 12.
        expect(year.tops.messages).toBe(12);
        expect(year.fills.messages?.slice(0, 4)).toEqual([1 / 3, 0, 1, null]);
        expect(year.fills.steps?.slice(0, 3)).toEqual([null, 1, null]);
        expect(year.standout.slice(0, 4)).toEqual([
            { module: 'messages', fill: 1 / 3 },
            { module: 'steps', fill: 1 },
            { module: 'messages', fill: 1 },
            null,
        ]);
    });
});
