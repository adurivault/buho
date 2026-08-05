import { describe, it, expect } from 'vitest';
import { longestDailyStreak } from './streak';

describe('longestDailyStreak', () => {
    it('returns an empty streak for no days', () => {
        expect(longestDailyStreak([])).toEqual({ length: 0, start: null, end: null });
    });

    it('counts a single day as a streak of one', () => {
        expect(longestDailyStreak(['2024-05-01'])).toEqual({
            length: 1,
            start: '2024-05-01',
            end: '2024-05-01',
        });
    });

    it('finds the longest run and ignores order and duplicates', () => {
        const streak = longestDailyStreak([
            '2024-05-04',
            '2024-05-01',
            '2024-05-02',
            '2024-05-02',
            '2024-05-03',
            '2024-05-09',
        ]);
        expect(streak).toEqual({ length: 4, start: '2024-05-01', end: '2024-05-04' });
    });

    it('breaks the run on a missing day', () => {
        expect(longestDailyStreak(['2024-05-01', '2024-05-03']).length).toBe(1);
    });

    it('spans a month boundary', () => {
        const streak = longestDailyStreak(['2024-05-30', '2024-05-31', '2024-06-01']);
        expect(streak).toEqual({ length: 3, start: '2024-05-30', end: '2024-06-01' });
    });

    it('spans a DST transition without dropping a day', () => {
        // Europe/Paris springs forward on 2024-03-31.
        const streak = longestDailyStreak(['2024-03-30', '2024-03-31', '2024-04-01']);
        expect(streak.length).toBe(3);
    });
});
