import { render, screen, waitFor } from '@testing-library/svelte';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Page from './+page.svelte';
import { dayStartMs } from '#lib/visualizations/listeningStory.ts';

const loaded = {
    listening: true,
    positions: false,
    messages: false,
    activity: false,
    steps: false,
    health: false,
};

vi.mock('#lib/stores/dataStore.svelte.ts', () => ({
    dataStore: {
        get loaded() {
            return loaded;
        },
        get isLoading() {
            return false;
        },
        isDemo: true,
        files: [],
    },
}));

// The chart factories draw real SVG; the page test is about the narration around them.
vi.mock('#lib/visualizations/d3/listeningCharts.ts', () => ({
    listeningClockChart: () => document.createElement('div'),
    calendarHeatmapChart: () => document.createElement('div'),
    artistRidgelineChart: () => document.createElement('div'),
    discoveryRecencyChart: () => document.createElement('div'),
}));

const points = [8, 10, 13, 16, 19, 21, 23].map((hour) => ({
    x: dayStartMs('2023-03-14') + hour * 3_600_000,
    y: hour,
    matched: true,
    metadata: {
        track: 'Nightcall',
        artist: 'Kavinsky',
        playedAt: `2023-03-14 ${String(hour).padStart(2, '0')}:00:00`,
        trackUri: null,
    },
}));

vi.mock('#lib/data/queries/behaviorQueries.ts', () => ({
    getAllConnectablePoints: vi.fn(),
    getMacroStats: vi.fn(),
    getPlayRecord: vi.fn(),
}));
vi.mock('#lib/data/queries/temporalQueries.ts', () => ({
    getHourWeekdayMinutes: vi.fn(),
    getDailyListeningCalendar: vi.fn(),
}));
vi.mock('#lib/data/queries/artistQueries.ts', () => ({
    getTopArtistsMonthly: vi.fn(),
}));
vi.mock('#lib/data/queries/discoveryQueries.ts', () => ({
    getMonthlyDiscoveryCohorts: vi.fn(),
    getArtistDiscoveryRecency: vi.fn(),
}));

import * as behaviorQueries from '#lib/data/queries/behaviorQueries.ts';
import * as temporalQueries from '#lib/data/queries/temporalQueries.ts';
import * as artistQueries from '#lib/data/queries/artistQueries.ts';
import * as discoveryQueries from '#lib/data/queries/discoveryQueries.ts';

const SECTION_IDS = [
    'spotify-one-point',
    'spotify-clock',
    'spotify-calendar',
    'spotify-totals',
    'spotify-artist-race',
    'spotify-ridgeline',
    'spotify-discovery-sediment',
    'spotify-discovery-recency',
    'spotify-handoff',
];

describe('Spotify guide page', () => {
    beforeEach(() => {
        vi.mocked(behaviorQueries.getAllConnectablePoints).mockResolvedValue(points);
        vi.mocked(behaviorQueries.getMacroStats).mockResolvedValue({
            totalMinutes: 12_345,
            uniqueArtists: 210,
            uniqueTracks: 1_400,
            skipRate: 18,
        });
        vi.mocked(behaviorQueries.getPlayRecord).mockResolvedValue({
            track: 'Nightcall',
            artist: 'Kavinsky',
            album: 'OutRun',
            playedAt: '2023-03-14 08:00:00',
            msPlayed: 204_000,
            platform: 'iOS',
            country: 'FR',
            shuffle: false,
            skipped: false,
            offline: false,
            reasonStart: 'clickrow',
            reasonEnd: 'trackdone',
        });
        vi.mocked(temporalQueries.getHourWeekdayMinutes).mockResolvedValue([
            { dow: 2, hour: 19, minutes: 900, plays: 300 },
            { dow: 5, hour: 9, minutes: 120, plays: 40 },
        ]);
        vi.mocked(temporalQueries.getDailyListeningCalendar).mockResolvedValue([
            { date: '2023-03-13', value: 40 },
            { date: '2023-03-14', value: 210 },
        ]);
        vi.mocked(artistQueries.getTopArtistsMonthly).mockResolvedValue([
            { artist: 'Kavinsky', month: '2023-03-01', value: 240 },
        ]);
        vi.mocked(discoveryQueries.getMonthlyDiscoveryCohorts).mockResolvedValue([]);
        vi.mocked(discoveryQueries.getArtistDiscoveryRecency).mockResolvedValue([
            {
                artist: 'Kavinsky',
                firstDate: '2019-01-01',
                lastDate: '2023-03-14',
                plays: 120,
                minutes: 400,
            },
        ]);
    });

    it('renders every act of the narrative', async () => {
        const { container } = render(Page);

        await waitFor(() => {
            expect(container.querySelector('#spotify-one-point')).toBeInTheDocument();
        });

        for (const id of SECTION_IDS) {
            expect(container.querySelector(`#${id}`)).toBeInTheDocument();
        }
    });

    it('opens on the whole export, then shows one play as its raw fields', async () => {
        render(Page);

        expect(await screen.findByText('Everything you played')).toBeInTheDocument();
        expect(await screen.findByText('One play')).toBeInTheDocument();

        // The record card: field labels with the values behind them, not JSON.
        expect(await screen.findByText('Album')).toBeInTheDocument();
        expect(await screen.findByText('OutRun')).toBeInTheDocument();
        expect(await screen.findByText('Listened for')).toBeInTheDocument();
        expect(await screen.findByText('3 min 24 s')).toBeInTheDocument();
        // Spotify's internal codes are spelled out.
        expect(await screen.findByText('you picked it from a list')).toBeInTheDocument();
        expect(await screen.findByText('the track finished')).toBeInTheDocument();
    });

    it('reports the totals in the section that earns them', async () => {
        render(Page);

        // toLocaleString() uses the runtime locale, whose group separator may be a
        // narrow no-break space — compare with whitespace stripped.
        const expectedTracks = (1400).toLocaleString().replace(/\s/g, '');
        expect(
            await screen.findByText((content) => content.replace(/\s/g, '') === expectedTracks)
        ).toBeInTheDocument();
        expect(await screen.findByText('Spent listening')).toBeInTheDocument();
    });

    it('names the densest hour of the week under the clock fold', async () => {
        render(Page);

        expect(await screen.findByText(/Tuesday at 19:00/)).toBeInTheDocument();
    });

    it('hands off to the explorer at the end', async () => {
        render(Page);

        expect(await screen.findByTestId('explore-cta')).toHaveAttribute(
            'href',
            expect.stringContaining('/listening/explore')
        );
    });
});
