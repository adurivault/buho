import { describe, it, expect } from 'vitest';
import {
    artistRidgelineChart,
    calendarHeatmapChart,
    discoveryRecencyChart,
    listeningClockChart,
} from './listeningCharts';
import type { HourWeekdayCell } from '#lib/data/queries/temporalQueries.ts';

const clock: HourWeekdayCell[] = [
    { dow: 1, hour: 8, minutes: 40, plays: 12 },
    { dow: 1, hour: 18, minutes: 90, plays: 30 },
    { dow: 6, hour: 22, minutes: 10, plays: 3 },
];

describe('listeningClockChart', () => {
    it('draws every hour of every weekday, played or not', () => {
        const node = listeningClockChart(clock);
        expect(node.querySelectorAll('svg rect')).toHaveLength(7 * 24);
    });

    it('colours the played cells from the listening ramp, the rest as the grid', () => {
        const fills = [...listeningClockChart(clock).querySelectorAll('svg rect')].map((r) =>
            r.getAttribute('fill')
        );
        expect(fills.filter((f) => f?.includes('--accent-listening'))).toHaveLength(3);
        expect(fills.filter((f) => f === 'var(--chart-grid)')).toHaveLength(7 * 24 - 3);
    });

    it('shows a stepped legend above the chart', () => {
        const node = listeningClockChart(clock);
        expect(node.querySelectorAll('.chart-ramp-steps > span')).toHaveLength(6);
    });

    it('falls back to an empty state', () => {
        expect(listeningClockChart([]).classList.contains('chart-empty')).toBe(true);
    });
});

describe('calendarHeatmapChart', () => {
    it('draws one square per day with listening, a block per year', () => {
        const node = calendarHeatmapChart([
            { date: '2023-12-31', value: 5 },
            { date: '2024-01-01', value: 20 },
            { date: '2024-01-02', value: 0 },
        ]);
        const squares = [...node.querySelectorAll('svg rect')];
        expect(squares).toHaveLength(2);
        expect(node.textContent).toContain('2023');
        expect(node.textContent).toContain('2024');
    });

    it('falls back to an empty state when no day has any listening', () => {
        const node = calendarHeatmapChart([{ date: '2024-01-01', value: 0 }]);
        expect(node.classList.contains('chart-empty')).toBe(true);
    });
});

describe('discoveryRecencyChart', () => {
    it('draws one bubble per artist and the same-day diagonal', () => {
        const node = discoveryRecencyChart({
            data: [
                {
                    artist: 'A',
                    firstDate: '2020-01-01',
                    lastDate: '2024-01-01',
                    plays: 300,
                    minutes: 900,
                },
                {
                    artist: 'B',
                    firstDate: '2022-06-01',
                    lastDate: '2022-06-20',
                    plays: 25,
                    minutes: 0,
                },
            ],
        });
        expect(node.querySelectorAll('svg circle[fill-opacity]')).toHaveLength(2);
        expect(node.querySelector('line[stroke-dasharray]')).not.toBeNull();
    });
});

describe('artistRidgelineChart', () => {
    it('renders a ridge per artist', () => {
        const node = artistRidgelineChart([
            { artist: 'A', month: '2024-01-01', value: 4 },
            { artist: 'A', month: '2024-02-01', value: 9 },
        ]);
        expect(node.querySelectorAll('path.ridge-area')).toHaveLength(1);
    });
});
