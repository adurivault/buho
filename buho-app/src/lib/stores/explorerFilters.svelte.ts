import type { FilterOrigin, FilterState, FilterValue } from "$lib/types/filters";
import { filterCombo, smallBucket, trackEvent, trackThrottled } from "$lib/analytics";

/**
 * Cross-filtering state for one Explorer, plus its analytics.
 *
 * Every filter interaction in the app funnels through `setFilter` /
 * `removeFilter` / `clearAll`, so this is the one place that knows which
 * dimensions people filter on, from which view, and which combinations they
 * build. Only dimension *keys*, origins and counts are reported — never the
 * selected values, which are the user's own data.
 *
 * The two sources share this base: the Spotify and Maps explorers hold separate
 * instances so switching sources never leaves the other one's filters active.
 */
export class ExplorerFiltersStore {
    filters = $state<FilterState>({});

    setFilter(key: string, value: FilterValue, origin: FilterOrigin = "unknown") {
        const isNew = !(key in this.filters);
        // Throttled per dimension: a brush drag is one intent, not fifty.
        // `dimOrigin` pre-composes dimension × origin into one value because
        // Umami breaks properties down one at a time — it can't cross two.
        trackThrottled("filter-set", `${key}:${origin}`, {
            dimension: key,
            origin,
            dimOrigin: `${key}@${origin}`,
            values: smallBucket(valueCount(value)),
            fresh: isNew
        });
        this.filters = {
            ...this.filters,
            [key]: value
        };
        this.reportCombo();
    }

    removeFilter(key: string, origin: FilterOrigin = "unknown") {
        if (!(key in this.filters)) return;
        trackThrottled("filter-remove", `${key}:${origin}`, {
            dimension: key,
            origin,
            dimOrigin: `${key}@${origin}`
        });
        const { [key]: _removed, ...nextFilters } = this.filters;
        this.filters = nextFilters;
        this.reportCombo();
    }

    clearAll(origin: FilterOrigin = "unknown") {
        if (this.hasActiveFilters) {
            trackEvent("filter-clear", {
                origin,
                dimensions: smallBucket(Object.keys(this.filters).length),
                combo: filterCombo(Object.keys(this.filters))
            });
        }
        this.filters = {};
    }

    /**
     * The set of dimensions currently active, e.g. "artist+year" — which filters
     * get used *together*. Throttled because a sunburst click rewrites several
     * keys in a row and only the resulting combination is interesting.
     */
    private reportCombo() {
        const keys = Object.keys(this.filters);
        if (keys.length === 0) return;
        const combo = filterCombo(keys);
        trackThrottled("filter-combo", combo, { combo, dimensions: smallBucket(keys.length) });
    }

    get hasActiveFilters(): boolean {
        return Object.keys(this.filters).length > 0;
    }

    get activeFilters(): FilterState {
        return this.filters;
    }
}

/** How many values a filter selects (ranges and objects count as one). */
function valueCount(value: FilterValue): number {
    if (value instanceof Set) return value.size;
    if (Array.isArray(value)) return value.length;
    return 1;
}
