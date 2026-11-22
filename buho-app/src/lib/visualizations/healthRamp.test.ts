import { describe, expect, it } from 'vitest';
import { RAMP, TAIL_COLOR, colorAt, rampFor } from './healthRamp';

describe('rampFor', () => {
    it('lays the ramp evenly from the 5th to the 95th percentile', () => {
        const stops = rampFor({ low: 50, high: 100, peak: 102 });

        expect(stops.map((s) => s.value)).toEqual([50, 60, 70, 80, 90, 100]);
        expect(stops.map((s) => s.color)).toEqual(RAMP);
    });

    it('runs on to a magenta stop when the tail reaches well past p95', () => {
        const stops = rampFor({ low: 50, high: 100, peak: 160 });

        expect(stops).toHaveLength(RAMP.length + 1);
        expect(stops[stops.length - 1]).toEqual({ value: 160, color: TAIL_COLOR });
    });

    it('gives a signal that stops near its 95th percentile no tail', () => {
        // 5 points past p95 on a 50-point range is a tenth of it: not enough.
        expect(rampFor({ low: 50, high: 100, peak: 105 })).toHaveLength(RAMP.length);
        expect(rampFor({ low: 50, high: 100, peak: 105.5 })).toHaveLength(RAMP.length + 1);
    });
});

describe('colorAt', () => {
    const color = colorAt([
        { value: 50, color: '#000000' },
        { value: 100, color: '#ffffff' },
    ]);

    it('blends between the stops around a reading, and holds the end colours past them', () => {
        expect(color(75)).toBe('rgb(128, 128, 128)');
        expect(color(20)).toBe('rgb(0, 0, 0)');
        expect(color(180)).toBe('rgb(255, 255, 255)');
    });
});
