import { describe, expect, it } from 'vitest';
import { rampFor } from '#lib/visualizations/healthRamp.ts';
import { dayBeats, zoneDays } from './zones';

const day = (n: number) => Date.UTC(2025, 2, 29 + n);

// Stops at 50, 60, 70, 80, 90, 100, then the tail at 150.
const stops = rampFor({ low: 50, high: 100, peak: 150 });

describe('zoneDays', () => {
    it('counts each slot in the band of the ramp its reading falls in', () => {
        const days = zoneDays(
            [
                { x: day(0), slot: 0, value: 55 },
                { x: day(0), slot: 1, value: 59.9 },
                { x: day(0), slot: 2, value: 60 },
                { x: day(0), slot: 3, value: 120 },
                { x: day(0), slot: 4, value: 151 },
            ],
            stops,
            5
        );

        expect(days).toEqual([{ date: '2025-03-29', minutes: [10, 5, 0, 0, 0, 5, 5] }]);
    });

    it('clamps readings past either end into the end bands, as they are painted', () => {
        const [only] = zoneDays(
            [
                { x: day(0), slot: 0, value: 30 },
                { x: day(0), slot: 1, value: 220 },
            ],
            stops,
            5
        );

        expect(only.minutes[0]).toBe(5);
        expect(only.minutes[stops.length - 1]).toBe(5);
    });

    it('names each day by its date, across a change of clocks, and skips empty ones', () => {
        const days = zoneDays(
            [
                { x: day(0), slot: 10, value: 65 },
                { x: day(2), slot: 10, value: 65 },
            ],
            stops,
            5
        );

        // The 30th, when the clocks went forward, had no reading: no entry.
        expect(days.map((d) => d.date)).toEqual(['2025-03-29', '2025-03-31']);
    });

    it('returns nothing for no readings', () => {
        expect(zoneDays([], stops, 5)).toEqual([]);
    });
});

describe('dayBeats', () => {
    /** Five-minute slots: 288 a day. */
    const SLOTS = 288;

    it('adds up a day worn all day from its readings alone', () => {
        const slots = Array.from({ length: SLOTS }, (_, slot) => ({ x: day(0), slot, value: 60 }));

        expect(dayBeats(slots, 5)).toEqual([{ date: '2025-03-29', beats: 60 * 1440, worn: 1440 }]);
    });

    it('fills the hours without the watch with the usual heart rate at that time', () => {
        // Day 0 is worn all day: 50 at night (the first 96 slots), 80 after.
        const worn = Array.from({ length: SLOTS }, (_, slot) => ({
            x: day(0),
            slot,
            value: slot < 96 ? 50 : 80,
        }));
        // Day 1 only from 8:00: its night is day 0's, not its own 90.
        const daytime = Array.from({ length: SLOTS - 96 }, (_, k) => ({
            x: day(1),
            slot: 96 + k,
            value: 90,
        }));

        const [, second] = dayBeats([...worn, ...daytime], 5);

        expect(second.worn).toBe(16 * 60);
        // The night at 50, as on the night worn; the day as read.
        expect(second.beats).toBe(50 * 8 * 60 + 90 * 16 * 60);
    });

    it('leaves out days with no reading', () => {
        const days = dayBeats(
            [
                { x: day(0), slot: 10, value: 65 },
                { x: day(2), slot: 10, value: 65 },
            ],
            5
        );

        expect(days.map((d) => d.date)).toEqual(['2025-03-29', '2025-03-31']);
    });

    it('returns nothing for no readings', () => {
        expect(dayBeats([], 5)).toEqual([]);
    });
});
