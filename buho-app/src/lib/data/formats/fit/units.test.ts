import { describe, expect, it } from 'vitest';
import {
    FIT_EPOCH_UNIX_SECONDS,
    SEMICIRCLES_TO_DEGREES,
    fitSeconds,
    fitSecondsToMs,
    localOffsetMinutes,
    makeTimestamp16Resolver,
} from './units';

describe('fitSeconds', () => {
    it('counts from the FIT epoch, not the Unix one', () => {
        expect(fitSeconds(new Date('1989-12-31T00:00:00Z'))).toBe(0);
        expect(fitSeconds(new Date('1990-01-01T00:00:00Z'))).toBe(86_400);
    });

    it('round-trips a real export timestamp', () => {
        // Taken from a monitoring file's monitoring_info message.
        expect(fitSeconds(new Date('2024-05-31T14:58:00Z'))).toBe(1_086_101_880);
        expect(fitSecondsToMs(1_086_101_880)).toBe(Date.parse('2024-05-31T14:58:00Z'));
    });

    it('accepts raw FIT seconds as well as Dates', () => {
        expect(fitSeconds(FIT_EPOCH_UNIX_SECONDS + 120)).toBe(120);
    });
});

describe('localOffsetMinutes', () => {
    // Both cases come from the same export: the watch was in North America in
    // spring 2024 and in France in summer 2026. Assuming one offset for a file
    // would put every step packet in the wrong hour of the day.
    it('reads a negative offset', () => {
        expect(
            localOffsetMinutes({
                timestamp: new Date('2024-05-31T14:58:00Z'),
                localTimestamp: 1_086_083_880,
            })
        ).toBe(-300);
    });

    it('reads a positive offset', () => {
        expect(
            localOffsetMinutes({
                timestamp: new Date('2026-07-12T21:09:00Z'),
                localTimestamp: 1_152_832_140,
            })
        ).toBe(120);
    });

    it('returns null when either clock is missing', () => {
        expect(localOffsetMinutes({ timestamp: new Date() })).toBeNull();
        expect(localOffsetMinutes({ localTimestamp: 1_086_083_880 })).toBeNull();
        expect(localOffsetMinutes(undefined)).toBeNull();
    });
});

describe('makeTimestamp16Resolver', () => {
    const at = (seconds: number) => new Date(fitSecondsToMs(seconds));

    it('carries the last full timestamp forward', () => {
        const resolve = makeTimestamp16Resolver();

        expect(resolve({ timestamp: at(1_000_000) })).toBe(1_000_000);
        // 1_000_000 & 0xffff === 16960, so +60 seconds reads as 17020.
        expect(resolve({ timestamp16: 17_020 })).toBe(1_000_060);
        expect(resolve({ timestamp16: 17_080 })).toBe(1_000_120);
    });

    it('moves forward across a 16-bit wrap instead of back a day', () => {
        const resolve = makeTimestamp16Resolver();
        // 65_500 sits 36 seconds below the rollover.
        resolve({ timestamp: at(65_500) });

        // 20 wraps past 65_535 — naively it would read as 65_480 seconds earlier.
        expect(resolve({ timestamp16: 20 })).toBe(65_556);
    });

    it('resumes from a fresh full timestamp', () => {
        const resolve = makeTimestamp16Resolver();
        resolve({ timestamp: at(1_000_000) });
        resolve({ timestamp16: 17_020 });

        expect(resolve({ timestamp: at(2_000_000) })).toBe(2_000_000);
        // 2_000_000 & 0xffff === 33_920.
        expect(resolve({ timestamp16: 33_980 })).toBe(2_000_060);
    });

    it('has nothing to resolve before the first full timestamp', () => {
        const resolve = makeTimestamp16Resolver();
        expect(resolve({ timestamp16: 17_020 })).toBeNull();
    });
});

describe('SEMICIRCLES_TO_DEGREES', () => {
    it('converts a recorded position to degrees', () => {
        expect(559_539_988 * SEMICIRCLES_TO_DEGREES).toBeCloseTo(46.9001, 5);
        expect(82_679_313 * SEMICIRCLES_TO_DEGREES).toBeCloseTo(6.9301, 5);
    });

    it('maps the semicircle range onto a full turn', () => {
        expect(2 ** 31 * SEMICIRCLES_TO_DEGREES).toBe(180);
        expect(-(2 ** 31) * SEMICIRCLES_TO_DEGREES).toBe(-180);
    });
});
