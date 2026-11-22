import { describe, it, expect } from 'vitest';
import {
    breakdowns,
    dowLabel,
    filterValueSet,
    inWindow,
    markMatched,
    soleFailure,
    topNSlices,
    valueTests,
    type CrossfilterTest,
    type ValueDimension,
} from './crossfilter';

interface Pt {
    x: number;
    y: number;
    matched: boolean;
    day: string;
    kind: string;
    km: number;
}

const pt = (x: number, y: number, day: string, kind: string, km = 1): Pt => ({
    x,
    y,
    matched: true,
    day,
    kind,
    km,
});

const DIMS: ValueDimension<Pt>[] = [
    { key: 'day', field: 'day' },
    { key: 'kind', field: 'kind' },
];

const ALL = { time: null, hour: null };

const POINTS = [
    pt(1, 8, 'Mon', 'walk'),
    pt(1, 9, 'Mon', 'run'),
    pt(2, 8, 'Tue', 'walk'),
    pt(3, 20, 'Wed', 'run'),
];

describe('filterValueSet', () => {
    it('reads scalars, arrays and sets as strings', () => {
        expect(filterValueSet({ a: 1 }, 'a')).toEqual(new Set(['1']));
        expect(filterValueSet({ a: [true, 'x'] }, 'a')).toEqual(new Set(['true', 'x']));
        expect(filterValueSet({ a: new Set([2]) }, 'a')).toEqual(new Set(['2']));
    });

    it('ignores unset filters and ranges', () => {
        expect(filterValueSet({}, 'a')).toBeNull();
        expect(filterValueSet({ a: null }, 'a')).toBeNull();
        expect(filterValueSet({ a: { min: 1, max: 2 } }, 'a')).toBeNull();
    });
});

describe('valueTests + markMatched', () => {
    it('matches the points passing every active filter', () => {
        const points = POINTS.map((p) => ({ ...p }));
        markMatched(points, valueTests({ day: ['Mon'], kind: 'walk' }, DIMS));
        expect(points.map((p) => p.matched)).toEqual([true, false, false, false]);
    });

    it('matches everything when nothing is filtered', () => {
        const points = POINTS.map((p) => ({ ...p, matched: false }));
        markMatched(points, valueTests({}, DIMS));
        expect(points.every((p) => p.matched)).toBe(true);
    });
});

describe('soleFailure', () => {
    const tests = valueTests({ day: ['Mon'], kind: ['walk'] }, DIMS);
    it('says whether a point passes all, fails one (which), or fails several', () => {
        expect(soleFailure(pt(0, 0, 'Mon', 'walk'), tests)).toBeNull();
        expect(soleFailure(pt(0, 0, 'Mon', 'run'), tests)).toBe('kind');
        expect(soleFailure(pt(0, 0, 'Tue', 'run'), tests)).toBe(false);
    });
});

describe('inWindow', () => {
    it('keeps points inside both windows, bounds included', () => {
        expect(inWindow(pt(2, 8, '', ''), { time: [1, 2], hour: [8, 9] })).toBe(true);
        expect(inWindow(pt(3, 8, '', ''), { time: [1, 2], hour: null })).toBe(false);
        expect(inWindow(pt(2, 10, '', ''), { time: null, hour: [8, 9] })).toBe(false);
    });
});

describe('breakdowns', () => {
    it('keeps a filtered dimension whole while narrowing the others', () => {
        const totals = breakdowns(POINTS, {
            tests: valueTests({ day: ['Mon'] }, DIMS),
            dimensions: DIMS,
            window: ALL,
        });
        // The day pie ignores its own filter…
        expect(Object.fromEntries(totals.day)).toEqual({ Mon: 2, Tue: 1, Wed: 1 });
        // …the kind pie only sees Mondays.
        expect(Object.fromEntries(totals.kind)).toEqual({ walk: 1, run: 1 });
    });

    it('drops a point failing two filters from every breakdown', () => {
        const totals = breakdowns(POINTS, {
            tests: valueTests({ day: ['Mon'], kind: ['walk'] }, DIMS),
            dimensions: DIMS,
            window: ALL,
        });
        // Wed/run fails both: it shows up nowhere.
        expect(totals.day.has('Wed')).toBe(false);
        expect(totals.kind.get('run')).toBe(1); // Mon/run fails only on kind
    });

    it('treats a custom test like a dimension of the same key', () => {
        const range: CrossfilterTest<Pt> = { key: 'kind', pass: (p) => p.y < 12 };
        const totals = breakdowns(POINTS, {
            tests: [range],
            dimensions: DIMS,
            window: ALL,
        });
        // The evening run fails only the "kind" test, so the kind pie still counts it.
        expect(totals.kind.get('run')).toBe(2);
        expect(totals.day.has('Wed')).toBe(false);
    });

    it('weighs, windows, and reports full matches', () => {
        const matched: Pt[] = [];
        const totals = breakdowns(POINTS, {
            tests: valueTests({ kind: ['walk'] }, DIMS),
            dimensions: DIMS,
            window: { time: [1, 2], hour: null },
            weight: (p) => p.km * 10,
            onMatch: (p) => matched.push(p),
        });
        expect(Object.fromEntries(totals.day)).toEqual({ Mon: 10, Tue: 10 });
        expect(matched).toHaveLength(2);
    });

    it('skips empty values', () => {
        const totals = breakdowns([pt(1, 1, '', 'walk')], {
            tests: [],
            dimensions: DIMS,
            window: ALL,
        });
        expect(totals.day.size).toBe(0);
        expect(totals.kind.get('walk')).toBe(1);
    });
});

describe('topNSlices', () => {
    it('keeps the largest values and folds the rest into Other', () => {
        const slices = topNSlices(
            new Map([
                ['a', 5],
                ['b', 3],
                ['c', 1],
                ['d', 1],
            ]),
            2
        );
        expect(slices.map((s) => [s.value, s.plays])).toEqual([
            ['a', 5],
            ['b', 3],
            ['Other', 2],
        ]);
    });
});

describe('dowLabel', () => {
    it('names DuckDB weekdays and passes anything else through', () => {
        expect(dowLabel('0')).toBe('Sun');
        expect(dowLabel('6')).toBe('Sat');
        expect(dowLabel('Unknown')).toBe('Unknown');
    });
});
