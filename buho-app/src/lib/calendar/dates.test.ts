import { describe, expect, it } from 'vitest';
import {
    clock,
    dayInYear,
    dayOfYear,
    sameDayIn,
    shiftDay,
    stepDay,
    weekdayFromMonday,
    yearLabel,
} from './dates';

describe('shiftDay', () => {
    it('moves across months, years and changes of clocks one day at a time', () => {
        expect(shiftDay('2025-03-29', 1)).toBe('2025-03-30');
        expect(shiftDay('2025-03-30', 1)).toBe('2025-03-31');
        expect(shiftDay('2025-10-26', -1)).toBe('2025-10-25');
        expect(shiftDay('2024-12-31', 1)).toBe('2025-01-01');
        expect(shiftDay('2024-03-01', -1)).toBe('2024-02-29');
    });
});

describe('sameDayIn', () => {
    it('keeps the month and day, the 29th of February falling back to the 28th', () => {
        expect(sameDayIn('2025-08-14', 2023)).toBe('2023-08-14');
        expect(sameDayIn('2024-02-29', 2025)).toBe('2025-02-28');
    });
});

describe('dayOfYear and weekdayFromMonday', () => {
    it('count from the 1st of January and from Monday', () => {
        expect(dayOfYear('2025-01-01')).toBe(0);
        expect(dayOfYear('2024-12-31')).toBe(365);
        expect(weekdayFromMonday('2024-01-01')).toBe(0); // a Monday
        expect(weekdayFromMonday('2025-03-30')).toBe(6); // a Sunday
    });
});

describe('dayInYear', () => {
    const span = { firstDay: '2024-03-10', lastDay: '2024-12-31' };

    it('opens the same date when the year recorded around it', () => {
        expect(dayInYear('2025-08-14', 2024, span)).toBe('2024-08-14');
    });

    it('falls back to the last recorded day outside what the year holds', () => {
        expect(dayInYear('2025-01-20', 2024, span)).toBe('2024-12-31');
        expect(dayInYear(null, 2024, span)).toBe('2024-12-31');
        expect(dayInYear('2025-01-20', 2022, { firstDay: null, lastDay: null })).toBeNull();
    });
});

describe('stepDay', () => {
    it('steps inside the span and stops at its ends', () => {
        expect(stepDay('2024-12-31', 1, '2024-03-10', '2025-11-02')).toBe('2025-01-01');
        expect(stepDay('2024-03-10', -1, '2024-03-10', '2025-11-02')).toBeNull();
        expect(stepDay('2025-11-02', 1, '2024-03-10', '2025-11-02')).toBeNull();
    });
});

describe('clock and yearLabel', () => {
    it('write a minute of the day and a year the way the page shows them', () => {
        expect(clock(0)).toBe('00:00');
        expect(clock(484.5)).toBe('08:04');
        expect(clock(1440)).toBe('24:00');
        expect(yearLabel(2025)).toBe('’25');
    });
});
