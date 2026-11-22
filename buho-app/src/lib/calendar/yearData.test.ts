import { describe, expect, it } from 'vitest';
import { rampFor } from '#lib/visualizations/healthRamp.ts';
import { cityRanks, dailyFigures, type YearData } from './yearData';

const empty: YearData = {
    year: 2025,
    listening: null,
    positions: null,
    messages: null,
    activity: null,
    steps: null,
    health: null,
};

describe('cityRanks', () => {
    it('ranks the year’s cities by days spent, ties by name', () => {
        const day = (date: string, city: string | null) => ({ date, km: 0, city });
        const ranks = cityRanks([
            day('2025-01-01', 'Lyon'),
            day('2025-01-02', 'Lyon'),
            day('2025-01-03', 'Paris'),
            day('2025-01-04', 'Annecy'),
            day('2025-01-05', null),
        ]);
        expect([...ranks.entries()]).toEqual([
            ['Lyon', 0],
            ['Annecy', 1],
            ['Paris', 2],
        ]);
    });
});

describe('dailyFigures', () => {
    it('ranks positions on kilometres and health on its heartbeats', () => {
        const figures = dailyFigures({
            ...empty,
            positions: [{ date: '2025-03-10', km: 6.5, city: 'Lyon' }],
            health: {
                stops: rampFor({ low: 50, high: 100, peak: 150 }),
                days: [{ date: '2025-03-10', minutes: [600, 300, 100, 30, 20, 10, 5] }],
                beats: [{ date: '2025-03-10', beats: 103_450, worn: 1065 }],
            },
        });

        expect(figures.positions).toEqual([{ date: '2025-03-10', value: 6.5 }]);
        expect(figures.health).toEqual([{ date: '2025-03-10', value: 103_450 }]);
    });

    it('passes the counted modules through and leaves the unloaded ones out', () => {
        const messages = [{ date: '2025-03-10', value: 4 }];
        const figures = dailyFigures({ ...empty, messages, steps: [] });

        expect(figures).toEqual({ messages, steps: [] });
    });
});
