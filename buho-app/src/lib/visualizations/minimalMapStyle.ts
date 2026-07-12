/**
 * Turns a MapLibre style (OpenFreeMap / OpenMapTiles schema) into a minimalist,
 * elegant variant for the location map:
 *   - all text labels removed (streets, places, countries, cities…);
 *   - buildings removed entirely;
 *   - administrative boundary lines removed;
 *   - the street network kept but simplified — casings/underlays/rails/paths
 *     dropped, dashes removed, and every remaining road drawn in one flat,
 *     high-contrast colour.
 *
 * Pure so it can be unit-tested; the component fetches the base style, patches
 * it, and passes the result to `new maplibre.Map({ style })` / `map.setStyle()`.
 */

interface StyleLayer {
    id: string;
    type: string;
    'source-layer'?: string;
    paint?: Record<string, unknown>;
    [k: string]: unknown;
}

interface MapStyle {
    layers?: StyleLayer[];
    [k: string]: unknown;
}

export interface MinimalStyleOptions {
    /** Flat colour applied to every street (high contrast with the background). */
    roadColor: string;
}

// Transportation lines that make the map look busy → dropped, leaving the plain
// road fills (minor / major inner / motorway inner).
const ROAD_CLUTTER_RE = /casing|subtle|railway|path|pier/i;

function isLabel(l: StyleLayer): boolean {
    return l.type === 'symbol';
}
function isBuilding(l: StyleLayer): boolean {
    return l.id === 'building' || l['source-layer'] === 'building';
}
function isBoundary(l: StyleLayer): boolean {
    return l['source-layer'] === 'boundary';
}
function isRoad(l: StyleLayer): boolean {
    return l.type === 'line' && l['source-layer'] === 'transportation';
}

export function toMinimalStyle<T extends MapStyle>(
    style: T,
    { roadColor }: MinimalStyleOptions,
): T {
    if (!Array.isArray(style.layers)) return style;
    const layers = style.layers
        .filter(
            (l) =>
                !isLabel(l) &&
                !isBuilding(l) &&
                !isBoundary(l) &&
                !(isRoad(l) && ROAD_CLUTTER_RE.test(l.id)),
        )
        .map((l) => {
            if (!isRoad(l)) return l;
            // Rebuild paint without the dash pattern (and flatten the colour).
            const paint: Record<string, unknown> = {};
            for (const [k, v] of Object.entries(l.paint ?? {})) {
                if (k !== 'line-dasharray') paint[k] = v;
            }
            paint['line-color'] = roadColor;
            return { ...l, paint };
        });
    return { ...style, layers };
}
