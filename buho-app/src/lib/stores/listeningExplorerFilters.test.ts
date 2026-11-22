import { beforeEach, describe, expect, it } from 'vitest';
import { listeningExplorerFilters } from './listeningExplorerFilters.svelte';

describe('listeningExplorerFilters', () => {
    beforeEach(() => {
        listeningExplorerFilters.clearAll();
    });

    it('starts empty', () => {
        expect(listeningExplorerFilters.activeFilters).toEqual({});
        expect(listeningExplorerFilters.hasActiveFilters).toBe(false);
    });

    it('sets and removes dynamic filters', () => {
        listeningExplorerFilters.setFilter('artist_name', 'Daft Punk');
        listeningExplorerFilters.setFilter('date_range', {
            start: '2024-01-01',
            end: '2024-01-31',
        });

        expect(listeningExplorerFilters.hasActiveFilters).toBe(true);
        expect(listeningExplorerFilters.activeFilters).toEqual({
            artist_name: 'Daft Punk',
            date_range: {
                start: '2024-01-01',
                end: '2024-01-31',
            },
        });

        listeningExplorerFilters.removeFilter('artist_name');

        expect(listeningExplorerFilters.activeFilters).toEqual({
            date_range: {
                start: '2024-01-01',
                end: '2024-01-31',
            },
        });
    });

    it('clears all filters', () => {
        listeningExplorerFilters.setFilter('hour', [7, 8, 9]);
        expect(listeningExplorerFilters.hasActiveFilters).toBe(true);

        listeningExplorerFilters.clearAll();

        expect(listeningExplorerFilters.activeFilters).toEqual({});
        expect(listeningExplorerFilters.hasActiveFilters).toBe(false);
    });
});
