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
 * Minimal cross-filtering store surface shared by spotifyExplorerFilters and
 * googleMapsExplorerFilters, so the generic SunburstExplorer can drive either.
 */
export interface ExplorerFilterStore {
    readonly activeFilters: FilterState;
    setFilter(key: string, value: FilterValue): void;
    removeFilter(key: string): void;
}
