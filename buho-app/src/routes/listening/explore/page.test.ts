import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import Page from './+page.svelte';
import { listeningExplorerFilters } from '#lib/stores/listeningExplorerFilters.svelte.ts';
import { dataStore } from '#lib/stores/dataStore.svelte.ts';

describe('Explore Page', () => {
    beforeEach(() => {
        listeningExplorerFilters.clearAll();
        dataStore.reset();
    });

    afterEach(() => {
        dataStore.reset();
    });

    /**
     * This used to assert "Rendering universe..." on a page with nothing
     * imported, which is precisely the bug: `initialLoad` only clears inside the
     * query effect, and the query effect never runs without data — so the
     * spinner was permanent and the page read as hung.
     */
    it('offers a way in when nothing is loaded, instead of spinning', () => {
        const { container } = render(Page);

        expect(screen.queryByText('Rendering universe...')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Load demo data' })).toBeInTheDocument();
        expect(container.querySelector('.explorer-grid')).toBeNull();
    });

    it('renders chart placeholders once a history is loaded', () => {
        dataStore.loadUserData('listening');
        const { container } = render(Page);

        expect(screen.getByText('Rendering universe...')).toBeInTheDocument();
        expect(container.querySelector('.explorer-grid')).toBeInTheDocument();
        expect(screen.queryByText('Temporal')).not.toBeInTheDocument();
        expect(screen.queryByText('Hourly')).not.toBeInTheDocument();
    });

    it('shows clear-all button only when filters are active', () => {
        dataStore.loadUserData('listening');
        const { rerender } = render(Page);
        expect(screen.queryByRole('button', { name: 'Clear all filters' })).not.toBeInTheDocument();

        listeningExplorerFilters.setFilter('artist_name', 'Phoenix');
        rerender({});

        expect(screen.getByRole('button', { name: 'Clear all filters' })).toBeInTheDocument();
    });

    it('does not render guide quick link', () => {
        dataStore.loadUserData('listening');
        render(Page);
        expect(screen.queryByRole('link', { name: 'Back to Guide' })).not.toBeInTheDocument();
    });
});
