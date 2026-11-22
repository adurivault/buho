import { describe, expect, it } from 'vitest';
import { GIF_MAX_SECONDS, GIF_MAX_WIDTH, gifDelayCs, gifFps, gifFrameCount, gifScale } from './gif';

describe('gifDelayCs', () => {
    it('is always a whole number of centiseconds, which is all GIF can store', () => {
        for (const speed of [1, 2, 4, 8, 16]) {
            expect(Number.isInteger(gifDelayCs(speed))).toBe(true);
        }
    });

    it('shortens the delay as the clip speeds up', () => {
        expect(gifDelayCs(1)).toBeGreaterThan(gifDelayCs(4));
        expect(gifDelayCs(4)).toBeGreaterThan(gifDelayCs(8));
    });

    it('never goes under 4cs, where old renderers start rewriting the delay', () => {
        expect(gifDelayCs(16)).toBeGreaterThanOrEqual(4);
    });
});

describe('gifFps', () => {
    it('is exactly what the delay says, with no rounding drift', () => {
        expect(gifFps(1)).toBeCloseTo(12.5);
        expect(gifFps(8)).toBe(25);
    });
});

describe('gifFrameCount', () => {
    it('follows the animation while it is short enough', () => {
        expect(gifFrameCount(4000)).toBe(Math.round(4 * gifFps(1)));
    });

    it('stops growing at the cap, so a long race stays pasteable', () => {
        expect(gifFrameCount(600_000)).toBe(Math.round(GIF_MAX_SECONDS * gifFps(1)));
    });

    it('packs more frames into the same second at speed', () => {
        expect(gifFrameCount(4000, 8)).toBeGreaterThan(gifFrameCount(4000, 1));
    });

    it('always has something to animate between', () => {
        expect(gifFrameCount(0)).toBeGreaterThanOrEqual(2);
    });
});

describe('gifScale', () => {
    it('never enlarges a chart that already fits', () => {
        expect(gifScale(400)).toBe(1);
    });

    it('brings a wide chart down to the cap', () => {
        expect(gifScale(1120) * 1120).toBeCloseTo(GIF_MAX_WIDTH);
    });
});
