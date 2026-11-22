import { describe, expect, it } from 'vitest';
import { laneScale } from './scales';

describe('laneScale', () => {
    it('fills the lane at a high percentile, so one exceptional day does not flatten the year', () => {
        const values = [...Array.from({ length: 99 }, (_, i) => i + 1), 1000];
        const scale = laneScale(values, { kind: 'cap', capAt: 0.98 });

        expect(scale.top).toBe(99); // the 98th percentile of 1…99, 1000
        expect(scale.fill(49.5)).toBeCloseTo(0.5);
        expect(scale.fill(1000)).toBe(1);
        // Past the top, the reach still tells the exceptional day apart.
        expect(scale.reach(1000)).toBeCloseTo(1000 / 99);
    });

    it('takes the square root for distances, the longest day at the top', () => {
        const scale = laneScale([1, 4, 100, null], { kind: 'sqrt', capAt: 1 });
        expect(scale.top).toBe(100);
        expect(scale.fill(25)).toBe(0.5);
        expect(scale.fill(100)).toBe(1);
    });

    it('runs from a low percentile to a high one for figures that barely move', () => {
        const values = Array.from({ length: 100 }, (_, i) => 100_000 + i * 100);
        const scale = laneScale(values, { kind: 'range', capAt: 0.98, floorAt: 0.02 });

        expect(scale.top).toBe(109_800);
        // The calmest days stand at the floor, the busiest fill the lane.
        expect(scale.fill(100_200)).toBe(0);
        expect(scale.fill(100_000)).toBe(0);
        expect(scale.fill(105_000)).toBeCloseTo(4800 / 9600);
        expect(scale.fill(109_900)).toBe(1);
    });

    it('stands nothing up for a year of zeros', () => {
        const scale = laneScale([0, null, 0], { kind: 'cap', capAt: 0.98 });
        expect(scale.top).toBe(0);
        expect(scale.fill(5)).toBe(0);
    });
});
