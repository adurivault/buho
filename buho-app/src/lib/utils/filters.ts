import type { FilterScalar, FilterState } from "$lib/types/filters";

/**
 * First scalar value of a filter, as a string — or null when the filter is
 * absent or holds a non-scalar (range/object). Used by Explorer pages to feed
 * DimensionPie's `selectedValue` from the active filter state.
 */
export function firstFilterValue(filters: FilterState, key: string): string | null {
    const v = filters[key];
    if (v === undefined || v === null) return null;
    if (v instanceof Set) {
        const a = [...v];
        return a.length ? String(a[0]) : null;
    }
    if (Array.isArray(v)) return v.length ? String(v[0]) : null;
    if (typeof v === "object") return null;
    return String(v as FilterScalar);
}
