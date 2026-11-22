import { describe, it, expect } from 'vitest';
import * as d3 from 'd3';
import type { ConnectablePoint } from '#lib/data/queries/behaviorQueries.ts';
import {
    barPop,
    buildQuadtree,
    clampHourDomain,
    clampTimeDomain,
    hourBars,
    monthStarts,
    monthlyBars,
    nearestMatched,
    pointPasses,
    resolveTimeDomain,
    timeAxisTicks,
    type BarWeighting,
    type ScaledPoint,
} from './constellation';

const DAY = 86_400_000;
const at = (y: number, m: number, d: number) => new Date(y, m, d).getTime();

const point = (x: number, y: number, matched = true, kind = 'a'): ConnectablePoint =>
    ({ x, y, matched, metadata: {}, kind }) as unknown as ConnectablePoint;

const COUNT: BarWeighting = { weight: () => 1, segments: null };

describe('resolveTimeDomain', () => {
    it('keeps a usable requested domain', () => {
        expect(resolveTimeDomain([1, 2], [])).toEqual([1, 2]);
    });

    it('falls back to the extent of the points', () => {
        expect(resolveTimeDomain(null, [point(5, 0), point(2, 0), point(9, 0)])).toEqual([2, 9]);
        expect(resolveTimeDomain([3, 3], [point(5, 0), point(9, 0)])).toEqual([5, 9]);
    });

    it('gives the last day when there is nothing to span', () => {
        expect(resolveTimeDomain(null, [], 10 * DAY)).toEqual([9 * DAY, 10 * DAY]);
        expect(resolveTimeDomain(null, [point(4, 0)], 10 * DAY)).toEqual([9 * DAY, 10 * DAY]);
    });
});

describe('clampTimeDomain', () => {
    const bounds: [number, number] = [0, 100 * DAY];

    it('orders and clamps into the bounds', () => {
        expect(clampTimeDomain([50 * DAY, -DAY], bounds)).toEqual([0, 50 * DAY]);
        expect(clampTimeDomain([DAY, 200 * DAY], bounds)).toEqual([DAY, 100 * DAY]);
    });

    it('never collapses below a day', () => {
        expect(clampTimeDomain([200 * DAY, 300 * DAY], bounds)).toEqual([99 * DAY, 100 * DAY]);
    });
});

describe('clampHourDomain', () => {
    it('orders, clamps to [0, 24], and keeps an hour at least', () => {
        expect(clampHourDomain([30, -2])).toEqual([0, 24]);
        expect(clampHourDomain([5, 5])).toEqual([5, 6]);
        expect(clampHourDomain([24, 24])).toEqual([24, 24]);
    });
});

describe('monthlyBars', () => {
    it('gives every month of the axis a bar, empty ones included', () => {
        expect(monthStarts([at(2024, 0, 15), at(2024, 2, 3)])).toEqual([
            at(2024, 0, 1),
            at(2024, 1, 1),
            at(2024, 2, 1),
        ]);
        const bars = monthlyBars(
            [point(at(2024, 0, 20), 10), point(at(2024, 2, 1), 10)],
            [at(2024, 0, 15), at(2024, 2, 3)],
            [0, 24],
            COUNT
        );
        expect(bars.map((b) => b.count)).toEqual([1, 0, 1]);
    });

    it('counts only matched points inside the hour window, with their weight', () => {
        const bars = monthlyBars(
            [
                point(at(2024, 0, 2), 8),
                point(at(2024, 0, 3), 22), // outside the hour window
                point(at(2024, 0, 4), 8, false), // not matched
            ],
            [at(2024, 0, 1), at(2024, 0, 31)],
            [6, 12],
            { weight: () => 2.5, segments: null }
        );
        expect(bars).toEqual([{ monthStartMs: at(2024, 0, 1), count: 2.5, segments: null }]);
    });

    it('splits by category in colour mode, leaving uncategorised months plain', () => {
        const weighting: BarWeighting = {
            weight: () => 1,
            segments: {
                count: 2,
                of: (p) => ((p as unknown as { kind: string }).kind === 'a' ? 0 : -1),
            },
        };
        const bars = monthlyBars(
            [point(at(2024, 0, 2), 8, true, 'a'), point(at(2024, 1, 2), 8, true, 'z')],
            [at(2024, 0, 1), at(2024, 1, 28)],
            [0, 24],
            weighting
        );
        expect(bars[0].segments).toEqual([1, 0]);
        expect(bars[1]).toMatchObject({ count: 1, segments: null });
    });
});

describe('hourBars', () => {
    it('bins matched points of the time window by quarter hour', () => {
        const bins = hourBars(
            [point(5, 0), point(5, 0.2), point(5, 23.99), point(50, 1)],
            [0, 10],
            COUNT
        );
        expect(bins).toHaveLength(96);
        expect(bins[0].count).toBe(2);
        expect(bins[95].count).toBe(1);
        expect(bins[4].count).toBe(0); // the point at x = 50 is outside the window
    });
});

describe('pointPasses', () => {
    const scaled = (x: number, y: number, matched: boolean, kind = 'a'): ScaledPoint => ({
        x,
        y,
        original: point(0, 0, matched, kind),
    });
    const style = {
        unmatched: { color: 'grey', alpha: 0.2 },
        matched: { color: 'green', alpha: 0.6 },
        colorOf: null,
        coloredAlpha: 0.7,
    };
    const plate = { x: [0, 10] as [number, number], y: [0, 10] as [number, number] };

    it('paints dimmed points first and drops what is off the plate', () => {
        const passes = pointPasses(
            [scaled(1, 1, true), scaled(2, 2, false), scaled(50, 1, true)],
            plate,
            style
        );
        expect(passes.map((p) => [p.color, p.points.length])).toEqual([
            ['grey', 1],
            ['green', 1],
        ]);
    });

    it('groups matched points by colour in colour mode', () => {
        const passes = pointPasses(
            [scaled(1, 1, true, 'a'), scaled(2, 2, true, 'b'), scaled(3, 3, true, 'a')],
            plate,
            {
                ...style,
                colorOf: (p) => (p as unknown as { kind: string }).kind,
            }
        );
        expect(passes.slice(1).map((p) => [p.color, p.points.length, p.alpha])).toEqual([
            ['a', 2, 0.7],
            ['b', 1, 0.7],
        ]);
    });
});

describe('nearestMatched', () => {
    const scaled = (x: number, y: number, matched: boolean): ScaledPoint => ({
        x,
        y,
        original: point(0, 0, matched),
    });

    it('finds the nearest matched point, looking past dimmed ones', () => {
        const near = scaled(10, 10, true);
        const tree = buildQuadtree([scaled(1, 1, false), near, scaled(40, 40, true)]);
        // The dimmed point is closer, but owns no hover area.
        expect(nearestMatched(tree, 3, 3, 12)).toBe(near);
    });

    it('returns null outside the radius or on an empty plate', () => {
        const tree = buildQuadtree([scaled(10, 10, true)]);
        expect(nearestMatched(tree, 100, 100, 12)).toBeNull();
        expect(nearestMatched(buildQuadtree([]), 0, 0, 12)).toBeNull();
    });
});

describe('barPop', () => {
    it('is a half-sine over the window after the threshold, zero elsewhere', () => {
        expect(barPop(0.5, 0.5, 0.2)).toBe(0);
        expect(barPop(0.6, 0.5, 0.2)).toBeCloseTo(1);
        expect(barPop(0.4, 0.5, 0.2)).toBe(0);
        expect(barPop(0.8, 0.5, 0.2)).toBe(0);
    });
});

describe('timeAxisTicks', () => {
    /** Six pixels a character: close enough to the axis font for spacing. */
    const measure = (label: string) => label.length * 6;
    const scaleOver = (from: number, to: number, width: number) =>
        d3
            .scaleTime<number, number>()
            .domain([new Date(from), new Date(to)])
            .range([40, 40 + width]);

    it('never lets two labels touch, however narrow the plot', () => {
        for (const width of [180, 320, 600, 900]) {
            const scale = scaleOver(at(2024, 0, 1), at(2026, 10, 22), width);
            const ticks = timeAxisTicks(scale, measure);
            expect(ticks.length).toBeGreaterThan(0);
            for (let i = 1; i < ticks.length; i++) {
                const gap =
                    scale(ticks[i].value) -
                    measure(ticks[i].label) / 2 -
                    (scale(ticks[i - 1].value) + measure(ticks[i - 1].label) / 2);
                expect(gap).toBeGreaterThanOrEqual(16);
            }
        }
    });

    it('writes only the year when every tick is a New Year', () => {
        const scale = scaleOver(at(2016, 5, 1), at(2026, 10, 22), 600);
        const labels = timeAxisTicks(scale, measure).map((tick) => tick.label);
        expect(labels.length).toBeGreaterThan(2);
        for (const label of labels) expect(label).toMatch(/^\d{4}$/);
    });

    it('names the month when the ticks fall within the year', () => {
        const scale = scaleOver(at(2026, 0, 1), at(2026, 10, 22), 600);
        const labels = timeAxisTicks(scale, measure).map((tick) => tick.label);
        expect(labels.some((label) => /^[A-Z][a-z]{2} 2026$/.test(label))).toBe(true);
    });
});
