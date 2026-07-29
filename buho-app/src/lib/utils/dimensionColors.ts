// Shared colors for the Explorer's dimensions (pies, constellation, barcharts).
// A given value (e.g. "iOS") always keeps the same color, regardless of its rank.
// The registry is shared across components and scoped by dimension (filterKey), so
// the "platform" pie, the constellation points, and the stacked barcharts match to
// the pixel.

// Soft palette tuned to the theme (Other = gray).
export const PALETTE = [
    "#4cc38a",
    "#5ab0d6",
    "#e0a458",
    "#c98bdb",
    "#e08a7d",
    "#7ec9a3",
    "#9ab0e0",
    "#d6c25a",
];
export const OTHER_COLOR = "#4a443d";

const colorRegistry = new Map<string, Map<string, string>>();

export function stickyColor(key: string, value: string): string {
    if (value === "Other") return OTHER_COLOR;
    let dimColors = colorRegistry.get(key);
    if (!dimColors) {
        dimColors = new Map();
        colorRegistry.set(key, dimColors);
    }
    let c = dimColors.get(value);
    if (!c) {
        c = PALETTE[dimColors.size % PALETTE.length];
        dimColors.set(value, c);
    }
    return c;
}
