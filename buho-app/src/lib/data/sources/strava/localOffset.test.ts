import { describe, expect, it } from 'vitest';
import { inferredOffsetMinutes, solarOffsetMinutes } from './localOffset';

/**
 * The browser's own offset is passed in explicitly throughout: these have to
 * mean the same thing whatever zone the machine running them is set to.
 */
describe('inferredOffsetMinutes', () => {
    const PARIS_LON = 2.35;
    const SANTA_MARTA_LON = -72.15;
    const instant = Date.parse('2021-07-05T18:00:00Z');

    it('trusts the browser’s zone for a track recorded in it', () => {
        // Paris sits on a longitude whose solar time is UTC, and runs at +2 in
        // July. Two hours apart, so still home — and the DST-aware answer wins.
        expect(inferredOffsetMinutes(instant, PARIS_LON, 120)).toBe(120);
    });

    it('falls back to the sun for a track recorded somewhere else', () => {
        // Same machine, still set to Paris, but the run is in Colombia.
        expect(inferredOffsetMinutes(instant, SANTA_MARTA_LON, 120)).toBe(-300);
    });

    it('agrees with the browser when the importer is where the track is', () => {
        expect(inferredOffsetMinutes(instant, SANTA_MARTA_LON, -300)).toBe(-300);
    });
});

describe('solarOffsetMinutes', () => {
    it('rounds to the nearest hour of longitude', () => {
        expect(solarOffsetMinutes(2.35)).toBe(0);
        expect(solarOffsetMinutes(-72.15)).toBe(-300);
        expect(solarOffsetMinutes(139.7)).toBe(540);
    });
});
