import { describe, it, expect } from 'vitest';
import { formatDuration, formatDurationLong } from './duration';

describe('formatDuration', () => {
    it('keeps short durations in minutes', () => {
        expect(formatDuration(0)).toBe(`${(0).toLocaleString()} min`);
        expect(formatDuration(42)).toBe(`${(42).toLocaleString()} min`);
        expect(formatDuration(59.4)).toBe(`${(59).toLocaleString()} min`);
    });

    it('uses one decimal hour under 10h', () => {
        expect(formatDuration(90)).toBe(`${(1.5).toLocaleString()} h`);
        expect(formatDuration(150)).toBe(`${(2.5).toLocaleString()} h`);
    });

    it('uses whole hours past 10h', () => {
        expect(formatDuration(5000)).toBe(`${(83).toLocaleString()} h`);
        expect(formatDuration(75000)).toBe(`${(1250).toLocaleString()} h`);
    });

    it('handles invalid input', () => {
        expect(formatDuration(Number.NaN)).toBe('—');
        expect(formatDuration(Number.POSITIVE_INFINITY)).toBe('—');
    });
});

describe('formatDurationLong', () => {
    it('shows seconds under a minute', () => {
        expect(formatDurationLong(0)).toBe('0 seconds');
        expect(formatDurationLong(1 / 60)).toBe('1 second');
        expect(formatDurationLong(45 / 60)).toBe('45 seconds');
    });

    it('shows minutes and seconds under an hour', () => {
        expect(formatDurationLong(5)).toBe('5 minutes');
        expect(formatDurationLong(5 + 12 / 60)).toBe('5 minutes 12 seconds');
        expect(formatDurationLong(59 + 59 / 60)).toBe('59 minutes 59 seconds');
    });

    it('shows hours and minutes from 1h up to the 72h handoff', () => {
        expect(formatDurationLong(60)).toBe('1 hour');
        expect(formatDurationLong(60 + 43)).toBe('1 hour 43 minutes');
        // Just under 72h stays in hours.
        expect(formatDurationLong(71 * 60 + 43)).toBe('71 hours 43 minutes');
    });

    it('rolls into days at/above 72h', () => {
        expect(formatDurationLong(72 * 60)).toBe('3 days');
        expect(formatDurationLong(73 * 60)).toBe('3 days 1 hour');
        expect(formatDurationLong((4 * 24 + 4) * 60)).toBe('4 days 4 hours');
    });

    it('rolls into years at/above 365 days', () => {
        expect(formatDurationLong(365 * 24 * 60)).toBe('1 year');
        expect(formatDurationLong((365 + 12) * 24 * 60)).toBe('1 year 12 days');
        expect(formatDurationLong(2 * 365 * 24 * 60)).toBe('2 years');
    });

    it('drops the secondary unit when zero', () => {
        expect(formatDurationLong(120)).toBe('2 hours');
        expect(formatDurationLong(4 * 24 * 60)).toBe('4 days');
    });

    it('handles invalid input', () => {
        expect(formatDurationLong(Number.NaN)).toBe('—');
        expect(formatDurationLong(Number.POSITIVE_INFINITY)).toBe('—');
    });
});
