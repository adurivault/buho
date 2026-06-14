import type { FilterState, FilterValue } from "$lib/types/filters";
import { trackThrottled, trackEvent } from "$lib/analytics";

class SpotifyExplorerFiltersStore {
    filters = $state<FilterState>({});

    setFilter(key: string, value: FilterValue) {
        // Only the dimension key is sent (e.g. "artist") — never the selected
        // value, which is the user's own data. Throttled so continuous brushing
        // counts as one interaction, not hundreds.
        trackThrottled("explore-filter", key, { dimension: key });
        this.filters = {
            ...this.filters,
            [key]: value
        };
    }

    removeFilter(key: string) {
        if (!(key in this.filters)) return;

        const { [key]: _removed, ...nextFilters } = this.filters;
        this.filters = nextFilters;
    }

    clearAll() {
        if (this.hasActiveFilters) trackEvent("explore-filters-clear");
        this.filters = {};
    }

    get hasActiveFilters(): boolean {
        return Object.keys(this.filters).length > 0;
    }

    get activeFilters(): FilterState {
        return this.filters;
    }
}

export const spotifyExplorerFilters = new SpotifyExplorerFiltersStore();
