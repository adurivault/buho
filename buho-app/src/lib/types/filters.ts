export type FilterScalar = string | number | boolean | null;

export interface DateRangeFilterValue {
    start: string | null;
    end: string | null;
}

export interface NumericRangeFilterValue {
    min: number | null;
    max: number | null;
}

export type FilterValue =
    | FilterScalar
    | FilterScalar[]
    | Set<FilterScalar>
    | DateRangeFilterValue
    | NumericRangeFilterValue
    | Record<string, unknown>;

export type FilterState = Record<string, FilterValue>;

/**
 * Which view a filter change came from. Analytics-only: the same dimension can
 * be filtered from a pie, the sunburst, a satellite bar or a brush, and knowing
 * which control people actually reach for is the point of tracking it.
 */
export type FilterOrigin =
    | "pie"
    | "sunburst"
    | "bar"
    | "constellation"
    | "map"
    | "date-range"
    | "unknown";

/**
 * Minimal cross-filtering store surface shared by spotifyExplorerFilters and
 * googleMapsExplorerFilters, so the generic SunburstExplorer can drive either.
 */
export interface ExplorerFilterStore {
    readonly activeFilters: FilterState;
    setFilter(key: string, value: FilterValue, origin?: FilterOrigin): void;
    removeFilter(key: string, origin?: FilterOrigin): void;
}
