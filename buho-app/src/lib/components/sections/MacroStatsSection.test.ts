
import { render, screen, waitFor } from '@testing-library/svelte';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import MacroStatsSection from './MacroStatsSection.svelte';
import * as behaviorQueries from '$lib/data/queries/behaviorQueries';
import { dataStore } from '$lib/stores/dataStore.svelte';

// Mock the queries
vi.mock('$lib/data/queries/behaviorQueries', () => ({
    getMacroStats: vi.fn()
}));

describe('MacroStatsSection', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Set dataStore to trigger the $effect - isLoading must be false and source must be truthy
        dataStore.loadDemoData('spotify');
    });

    afterEach(() => {
        dataStore.reset();
    });

    it('should display stats after loading', async () => {
        // Mock return value
        vi.mocked(behaviorQueries.getMacroStats).mockResolvedValue({
            totalMinutes: 1234,
            uniqueArtists: 50,
            uniqueTracks: 100,
            skipRate: 15
        });

        render(MacroStatsSection);

        // Verify it was called
        expect(behaviorQueries.getMacroStats).toHaveBeenCalled();

        // Should eventually display the stats
        // The component renders numbers via toLocaleString() with the runtime's
        // locale, whose group separator can be a narrow no-break space (fr-FR).
        // Compare with all whitespace stripped to stay locale-independent.
        const expectedMinutes = (1234).toLocaleString().replace(/\s/g, '');
        expect(
            await screen.findByText((content) => content.replace(/\s/g, '') === expectedMinutes)
        ).toBeInTheDocument(); // total minutes (check formatting)
        expect(await screen.findByText('50')).toBeInTheDocument();   // artists
        expect(await screen.findByText('100')).toBeInTheDocument();  // tracks
        expect(await screen.findByText('15%')).toBeInTheDocument();  // skip rate

        // Should display labels
        expect(screen.getByText(/Total Minutes/i)).toBeInTheDocument();
        expect(screen.getByText(/Unique Artists/i)).toBeInTheDocument();
        expect(screen.getByText(/Unique Tracks/i)).toBeInTheDocument();
        expect(screen.getByText(/Skip Rate/i)).toBeInTheDocument();
    });

    it('should handle zero states', async () => {
        vi.mocked(behaviorQueries.getMacroStats).mockResolvedValue({
            totalMinutes: 0,
            uniqueArtists: 0,
            uniqueTracks: 0,
            skipRate: 0
        });

        render(MacroStatsSection);

        const zeros = await screen.findAllByText('0');
        expect(zeros.length).toBeGreaterThan(0);

        const zeroPercents = await screen.findAllByText('0%');
        expect(zeroPercents.length).toBeGreaterThan(0);
    });
});
