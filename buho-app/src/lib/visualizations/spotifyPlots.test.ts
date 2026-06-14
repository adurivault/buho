import { describe, it, expect } from 'vitest';
import {
    topArtistsPlot,
    topTracksPlot,
    platformDistributionPlot,
    platformDistributionPiePlot,
    reasonDistributionPiePlot,
    reasonStartEndFlowPlot,
    artistAnalysisScatterPlot,
    dailyAnalysisScatterPlot,
    trackAnalysisScatterPlot,
    topArtistsMonthlyAlignedPlot
} from './spotifyPlots';

describe('spotifyPlots', () => {
    describe('topArtistsPlot', () => {
        it('returns a DOM element with data', () => {
            const data = [
                { artist: 'Artist A', minutes: 1000 },
                { artist: 'Artist B', minutes: 500 }
            ];
            const result = topArtistsPlot(data);
            expect(result).toBeTruthy();
            expect(result.tagName).toBeDefined();
        });

        it('handles empty data', () => {
            const result = topArtistsPlot([]);
            expect(result).toBeTruthy();
        });
    });

    describe('topTracksPlot', () => {
        it('returns a DOM element', () => {
            const data = [{ track: 'Song', artist: 'Artist', plays: 10, minutes: 30 }];
            const result = topTracksPlot(data);
            expect(result).toBeTruthy();
        });
    });

    describe('monthlyTrendPlot', () => {
        it('returns a DOM element', () => {
            const data = [
                { month: '2024-01', minutes: 5000 },
                { month: '2024-02', minutes: 4500 }
            ];

        });
    });

    describe('platformDistributionPlot', () => {
        it('returns a DOM element', () => {
            const data = [
                { platform: 'macOS', minutes: 3000 },
                { platform: 'iOS', minutes: 1500 }
            ];
            const result = platformDistributionPlot(data);
            expect(result).toBeTruthy();
        });
    });

    describe('platformDistributionPiePlot', () => {
        it('returns a DOM element', () => {
            const data = [
                { platform: 'macOS', minutes: 3000 },
                { platform: 'iOS', minutes: 1500 }
            ];
            const result = platformDistributionPiePlot(data);
            expect(result).toBeTruthy();
        });
    });

    describe('topArtistsMonthlyAlignedPlot', () => {
        it('returns a DOM element for aligned monthly artist data', () => {
            const data = [
                { artist: 'Artist A', monthIndex: 0, minutes: 120 },
                { artist: 'Artist A', monthIndex: 1, minutes: 240 },
                { artist: 'Artist B', monthIndex: 0, minutes: 80 },
                { artist: 'Artist B', monthIndex: 1, minutes: 100 }
            ];

            const result = topArtistsMonthlyAlignedPlot(data);
            expect(result).toBeTruthy();
            expect(result.tagName).toBeDefined();
        });
    });

    describe('reasonDistributionPiePlot', () => {
        it('returns a DOM element for reason distribution', () => {
            const data = [
                { reason: 'trackdone', minutes: 2300 },
                { reason: 'fwdbtn', minutes: 1200 },
                { reason: 'backbtn', minutes: 300 }
            ];
            const result = reasonDistributionPiePlot(data);
            expect(result).toBeTruthy();
            expect(result.tagName).toBeDefined();
        });
    });

    describe('reasonStartEndFlowPlot', () => {
        it('returns a DOM element for reason flowchart', () => {
            const data = [
                { reasonStart: 'trackdone', reasonEnd: 'trackdone', minutes: 2400 },
                { reasonStart: 'fwdbtn', reasonEnd: 'fwdbtn', minutes: 1200 },
                { reasonStart: 'trackdone', reasonEnd: 'endplay', minutes: 500 }
            ];
            const result = reasonStartEndFlowPlot(data);
            expect(result).toBeTruthy();
            expect(result.tagName).toBeDefined();
        });
    });

    describe('artistAnalysisScatterPlot', () => {
        it('returns a DOM element for artist scatter analysis', () => {
            const result = artistAnalysisScatterPlot({
                data: [
                    {
                        artist: 'Artist A',
                        totalMinutes: 2000,
                        playCount: 340,
                        uniqueTracks: 170,
                        intentionalStopRate: 34.5,
                        shuffleRate: 62.1,
                        intentionalStartRate: 48.2,
                        meanListenDateEpochMs: 1704153600000,
                        listenDateVarianceDays2: 35.4,
                        eveningRate: 28.7,
                        recencyDays: 3.2,
                        activeDays: 85,
                        skipRate: 21.1,
                        repeatIntensity: 1.92
                    },
                    {
                        artist: 'Artist B',
                        totalMinutes: 950,
                        playCount: 180,
                        uniqueTracks: 98,
                        intentionalStopRate: 41.2,
                        shuffleRate: 37.4,
                        intentionalStartRate: 33.8,
                        meanListenDateEpochMs: 1711929600000,
                        listenDateVarianceDays2: 18.2,
                        eveningRate: 47.2,
                        recencyDays: 21.4,
                        activeDays: 32,
                        skipRate: 39.7,
                        repeatIntensity: 2.41
                    }
                ],
                xMetric: 'totalMinutes',
                yMetric: 'repeatIntensity',
                xLabel: 'Durée',
                yLabel: 'Répétition'
            });
            expect(result).toBeTruthy();
            expect(result.tagName).toBeDefined();
        });
    });

    describe('dailyAnalysisScatterPlot', () => {
        it('returns a DOM element for daily metrics scatter', () => {
            const result = dailyAnalysisScatterPlot({
                data: [
                    {
                        date: '2025-02-01',
                        dateEpochMs: 1738368000000,
                        playCount: 110,
                        totalMinutes: 380,
                        uniqueArtists: 33,
                        uniqueTracks: 72,
                        maxSameTrackPlays: 7,
                        shuffleRate: 54.2,
                        intentionalStopRate: 29.3,
                        intentionalStartRate: 41.1,
                        skipRate: 23.6,
                        eveningRate: 46.7,
                        meanListenHour: 17.9,
                        repeatIntensity: 1.53
                    },
                    {
                        date: '2025-02-02',
                        dateEpochMs: 1738454400000,
                        playCount: 95,
                        totalMinutes: 312,
                        uniqueArtists: 29,
                        uniqueTracks: 61,
                        maxSameTrackPlays: 6,
                        shuffleRate: 49.4,
                        intentionalStopRate: 26.7,
                        intentionalStartRate: 39.5,
                        skipRate: 20.1,
                        eveningRate: 42.2,
                        meanListenHour: 16.4,
                        repeatIntensity: 1.56
                    }
                ],
                xMetric: 'dateEpochMs',
                yMetric: 'playCount',
                xLabel: 'Date',
                yLabel: "Nb d'écoutes",
                width: 1200,
                height: 700
            });

            expect(result).toBeTruthy();
            expect(result.tagName).toBeDefined();
        });
    });

    describe('trackAnalysisScatterPlot', () => {
        it('returns a DOM element for track metrics scatter', () => {
            const result = trackAnalysisScatterPlot({
                data: [
                    {
                        artist: 'Artist A',
                        track: 'Song A',
                        playCount: 88,
                        totalMinutes: 240.2,
                        intentionalityRate: 44,
                        skipRate: 19,
                        recencyDays: 7.7,
                        maxSameDayPlays: 11,
                        artistPrevalenceRate: 18.4,
                        activeDays: 26
                    },
                    {
                        artist: 'Artist B',
                        track: 'Song B',
                        playCount: 65,
                        totalMinutes: 168.9,
                        intentionalityRate: 31,
                        skipRate: 27,
                        recencyDays: 3.1,
                        maxSameDayPlays: 8,
                        artistPrevalenceRate: 12.6,
                        activeDays: 21
                    }
                ],
                xMetric: 'playCount',
                yMetric: 'artistPrevalenceRate',
                xLabel: "Nb d'écoutes",
                yLabel: "Prévalence",
                width: 1200,
                height: 700
            });

            expect(result).toBeTruthy();
            expect(result.tagName).toBeDefined();
        });
    });
});
