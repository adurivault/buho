import { describe, it, expect } from 'vitest';
import {
    artistAnalysisScatterChart,
    dailyAnalysisScatterChart,
    trackAnalysisScatterChart,
} from './metricScatter';
import type { ArtistAnalysisData } from '#lib/data/queries/artistQueries.ts';
import type { DailyAnalysisData } from '#lib/data/queries/temporalQueries.ts';
import type { TrackAnalysisData } from '#lib/data/queries/trackQueries.ts';

const artists = [
    { artist: 'A', totalMinutes: 2000, repeatIntensity: 1.9, meanListenDateEpochMs: 1704153600000 },
    { artist: 'B', totalMinutes: 950, repeatIntensity: 2.4, meanListenDateEpochMs: 1711929600000 },
] as unknown as ArtistAnalysisData[];

const dots = (node: Element) => node.querySelectorAll('svg circle[fill-opacity]');

describe('metric scatter charts', () => {
    it('places one dot per artist', () => {
        const node = artistAnalysisScatterChart({
            data: artists,
            xMetric: 'totalMinutes',
            yMetric: 'repeatIntensity',
            xLabel: 'Listening time',
            yLabel: 'Repeat intensity',
        });
        expect(dots(node)).toHaveLength(2);
        expect(node.textContent).toContain('Listening time');
    });

    it('puts a date metric on a time axis without a zero line', () => {
        const node = artistAnalysisScatterChart({
            data: artists,
            xMetric: 'meanListenDateEpochMs',
            yMetric: 'repeatIntensity',
        });
        // Only the numeric y axis gets a zero line.
        expect(node.querySelectorAll('svg > g > line[stroke="var(--chart-axis)"]')).toHaveLength(1);
    });

    it('places one dot per track and per day', () => {
        const tracks = [
            { track: 'T', artist: 'A', skipRate: 12, recencyDays: 3 },
        ] as unknown as TrackAnalysisData[];
        const days = [
            { date: '2024-01-01', dateEpochMs: 1704067200000, meanListenHour: 20 },
        ] as unknown as DailyAnalysisData[];
        expect(
            dots(
                trackAnalysisScatterChart({
                    data: tracks,
                    xMetric: 'skipRate',
                    yMetric: 'recencyDays',
                })
            )
        ).toHaveLength(1);
        expect(
            dots(
                dailyAnalysisScatterChart({
                    data: days,
                    xMetric: 'dateEpochMs',
                    yMetric: 'meanListenHour',
                })
            )
        ).toHaveLength(1);
    });

    it('falls back to an empty state when no row has both metrics', () => {
        const node = artistAnalysisScatterChart({
            data: artists,
            xMetric: 'artist' as keyof ArtistAnalysisData,
            yMetric: 'repeatIntensity',
        });
        expect(node.classList.contains('chart-empty')).toBe(true);
    });
});
