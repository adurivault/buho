import type { FilterState, FilterValue } from "$lib/types/filters";
import { trackThrottled, trackEvent } from "$lib/analytics";

// Separate instance from spotifyExplorerFilters so switching sources never
// leaves the other source's filters active.
class GoogleMapsExplorerFiltersStore {
    filters = $state<FilterState>({});

    setFilter(key: string, value: FilterValue) {
        // Only the dimension key is tracked, never the (user-data) value.
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

export const googleMapsExplorerFilters = new GoogleMapsExplorerFiltersStore();
