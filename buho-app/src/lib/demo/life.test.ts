import { describe, expect, it } from 'vitest';
import { lifeDays } from './life';

/**
 * The shared calendar is uneven on purpose: these hold it to the turns the
 * samples depend on, so a change to the model cannot flatten it unnoticed.
 */

const days = lifeDays({ until: new Date('2026-06-30') });
const count = (keep: (day: (typeof days)[number]) => boolean) => days.filter(keep).length;

describe('the life turns halfway', () => {
    it('moves once, then works from home two days a week', () => {
        const moved = days.findIndex((day) => day.phase === 'B');
        expect(moved).toBeGreaterThan(days.length * 0.4);
        expect(days.slice(moved).every((day) => day.phase === 'B')).toBe(true);
        expect(count((day) => day.kind === 'remote' && day.phase === 'A')).toBe(0);
        expect(count((day) => day.kind === 'remote')).toBeGreaterThan(80);
    });

    it('spends a few weeks between the two jobs', () => {
        expect(count((day) => day.kind === 'off')).toBeGreaterThan(10);
        expect(count((day) => day.kind === 'off')).toBeLessThan(20);
    });

    it('takes up running late, and races once', () => {
        const first = days.findIndex((day) => day.run !== 'none');
        expect(first).toBeGreaterThan(days.length * 0.6);
        expect(count((day) => day.run === 'race')).toBe(1);
        expect(days[days.length - 1].fitness).toBeGreaterThan(0.6);
    });
});

describe('the weeks are not all alike', () => {
    it('goes out more in summer than in winter', () => {
        const outings = (months: number[]) => {
            const span = days.filter(
                (day) => months.includes(day.start.getMonth()) && day.kind !== 'holiday'
            );
            return span.reduce((sum, day) => sum + day.outings.length, 0) / span.length;
        };
        expect(outings([5, 6, 7])).toBeGreaterThan(outings([0, 1, 11]) * 1.2);
    });

    it('has trips, colds, late nights and three weeks without the watch', () => {
        expect(count((day) => day.kind === 'holiday')).toBeGreaterThan(60);
        expect(count((day) => day.kind === 'sick')).toBeGreaterThan(6);
        expect(count((day) => day.late)).toBeGreaterThan(40);
        expect(count((day) => day.watchless)).toBeGreaterThan(15);
    });
});
