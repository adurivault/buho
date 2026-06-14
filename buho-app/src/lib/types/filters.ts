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
