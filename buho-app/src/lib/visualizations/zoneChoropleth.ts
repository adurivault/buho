/**
 * Pure logic behind the guide's zone choropleth: hierarchy keys, the zoom → depth
 * mapping, the continuous colour scale, label placement, and per-zone bounds.
 *
 * The map renders the *leaf* polygons of `geo_zones.topojson` at every depth and
 * fills each one with the aggregate of its ancestor at the current depth. Sibling
 * leaves of one ancestor therefore share a fill, and with the internal borders
 * dropped the result reads as a dissolved choropleth without any geometric union.
 *
 * There is no basemap: these polygons are the entire map, so everything the reader
 * sees — land, borders, names — is derived here.
 */

import { interpolateRgbBasis, rgb } from 'd3';
import type { Feature, Geometry } from 'geojson';
import type { MapBounds } from './locationMapData';

export type Depth = 1 | 2 | 3 | 4;
export const DEPTHS: readonly Depth[] = [1, 2, 3, 4] as const;

export const DEPTH_LABELS: Record<Depth, string> = {
    1: 'Countries',
    2: 'Regions',
    3: 'Departments',
    4: 'Arrondissements',
};

/**
 * The ordered hierarchy, carried identically by the topojson feature properties
 * and by the `google_maps_segments` columns — attribution copies the zone strings
 * verbatim from the same asset, so the two sides always agree byte for byte.
 */
export interface ZonePath {
    country: string | null;
    region: string | null;
    department: string | null;
    arrondissement: string | null;
}

const clean = (v: unknown): string | null =>
    typeof v === 'string' && v.trim() !== '' ? v : null;

/**
 * Puts a raw hierarchy into the canonical shape both sides key on. Two fixes, and
 * `ZONE_ROLLUP_SQL` in geoQueries.ts mirrors them exactly — the join between
 * polygons and aggregates is only sound while the two agree:
 *
 *  1. **Country falls back to region.** 16 leaves have no `country`: territories
 *     Natural Earth gives no ADM0 parent — Gibraltar, Akrotiri, Dhekelia,
 *     Guantanamo Bay, Baykonur, Clipperton, the US minor outlying islands, the
 *     Spratly and Coral Sea islands. Without this they would key to '' at every
 *     depth, so they could never be filled *and* any time spent there would be
 *     dropped from the aggregate query outright.
 *  2. **A region equal to its country collapses.** Otherwise those same
 *     territories — and any country whose ADM1 repeats its name — would key as
 *     'Gibraltar/Gibraltar' at depth 2, reading as a level that does not exist.
 */
export function normalizePath(raw: {
    country?: unknown;
    region?: unknown;
    department?: unknown;
    arrondissement?: unknown;
}): ZonePath {
    const region = clean(raw.region);
    const country = clean(raw.country) ?? region;
    return {
        country,
        region: region !== null && region !== country ? region : null,
        department: clean(raw.department),
        arrondissement: clean(raw.arrondissement),
    };
}

/** ASCII unit separator: cannot occur in a place name, so keys stay injective. */
const SEP = '\u001f';

/**
 * Key of `path` at `depth`: the hierarchy walked down from `country`, stopping at
 * `depth` or at the first missing component, whichever comes first. Returns '' for
 * a row with no country (unmappable).
 *
 * Stopping at the first gap — rather than taking the deepest non-null component —
 * matters for the 7 leaves that have a null `region` (Russia, Mexico, Colombia,
 * Venezuela, Antarctica, Kiribati, Anguilla): they must stay keyed on their country
 * at every depth instead of skipping the hole.
 *
 *   ({France, Île-de-France, Paris, Paris 11e}, 2) → 'France␟Île-de-France'
 *   ({Spain, Comunidad de Madrid, null, null}, 4)  → 'Spain␟Comunidad de Madrid'
 *   ({Russia, null, null, null}, 3)                → 'Russia'
 */
export function zoneKey(path: ZonePath, depth: Depth): string {
    const comps = [path.country, path.region, path.department, path.arrondissement];
    const out: string[] = [];
    for (let i = 0; i < depth; i++) {
        const c = comps[i];
        if (c === null || c === undefined || c === '') break;
        out.push(c);
    }
    return out.join(SEP);
}

/** Human-readable breadcrumb of a key ('France › Île-de-France › Paris'). */
export function keyLabel(key: string): string {
    return key.split(SEP).join(' › ');
}

/** Deepest component of a key — the zone's own name. */
export function keyName(key: string): string {
    const parts = key.split(SEP);
    return parts[parts.length - 1] ?? '';
}

// --- Aggregates ------------------------------------------------------------

/** The Explorer's measures, so both Google Maps views speak the same language. */
export type ZoneMetric = 'hours' | 'km' | 'points';

export const ZONE_METRICS: { key: ZoneMetric; label: string }[] = [
    { key: 'hours', label: 'time' },
    { key: 'km', label: 'km' },
    { key: 'points', label: 'points' },
];

export interface ZoneAgg {
    hours: number;
    km: number;
    points: number;
}

/**
 * One row of the ROLLUP. `depthMask` is the `GROUPING()` bitmask: a set bit means
 * that column was rolled up, so 7 = country only, 3 = country+region, 1 = down to
 * department, 0 = the full leaf, 15 = the grand total.
 */
export interface ZoneRollupRow extends ZonePath {
    depthMask: number;
    hours: number;
    km: number;
    points: number;
}

/** ROLLUP bitmask that corresponds to each depth. */
export const MASK_FOR_DEPTH: Record<Depth, number> = { 1: 7, 2: 3, 3: 1, 4: 0 };
/** The grand-total row's mask (every column rolled up). */
export const TOTAL_MASK = 15;

const DEPTH_FOR_MASK = new Map<number, Depth>(
    DEPTHS.map((d) => [MASK_FOR_DEPTH[d], d]),
);

export interface ZoneRollup {
    /** depth → key → aggregate, keys built by `zoneKey` at that depth. */
    byDepth: Record<Depth, Map<string, ZoneAgg>>;
    /** The grand total across every mapped zone, for the tooltip's share line. */
    total: ZoneAgg | null;
}

export function buildZoneRollup(rows: readonly ZoneRollupRow[]): ZoneRollup {
    const byDepth = { 1: new Map(), 2: new Map(), 3: new Map(), 4: new Map() } as Record<
        Depth,
        Map<string, ZoneAgg>
    >;
    let total: ZoneAgg | null = null;

    for (const row of rows) {
        if (row.depthMask === TOTAL_MASK) {
            total = { hours: row.hours, km: row.km, points: row.points };
            continue;
        }
        const depth = DEPTH_FOR_MASK.get(row.depthMask);
        if (depth === undefined) continue;

        const key = zoneKey(row, depth);
        if (key === '') continue;

        // Truncation can only ever merge a row with itself, so a collision would
        // mean the asset's hierarchy changed shape — sum rather than lose data.
        const existing = byDepth[depth].get(key);
        if (existing) {
            existing.hours += row.hours;
            existing.km += row.km;
            existing.points += row.points;
        } else {
            byDepth[depth].set(key, {
                hours: row.hours,
                km: row.km,
                points: row.points,
            });
        }
    }

    return { byDepth, total };
}

export function metricValue(agg: ZoneAgg, metric: ZoneMetric): number {
    return metric === 'hours' ? agg.hours : metric === 'km' ? agg.km : agg.points;
}

/** Display string for a metric value; locale-free per the project convention. */
export function formatMetric(value: number, metric: ZoneMetric): string {
    if (metric === 'hours') {
        return value < 10
            ? `${value.toFixed(1)}h`
            : `${Math.round(value).toLocaleString()}h`;
    }
    const n = Math.round(value).toLocaleString();
    return metric === 'km' ? `${n} km` : n;
}

// --- Zoom → depth ----------------------------------------------------------

/**
 * Upper zoom bound of each depth, tuned to the OpenFreeMap/OSM zoom levels: below
 * ~3.6 the whole world fits (countries), ~3.6–6.2 a country fills the viewport
 * (regions), ~6.2–8.6 a region fills it (departments), and from ~8.6 up we are at
 * city scale (arrondissements — Paris/Lyon/Marseille span roughly z10–11).
 */
export const DEPTH_ZOOM_BREAKS = [3.6, 6.2, 8.6] as const;

/**
 * Deadband around each break. MapLibre emits continuous fractional zooms during a
 * wheel/pinch gesture and its inertial easing overshoots before settling, so a bare
 * threshold flips depth several times per gesture near a boundary — each flip
 * recolouring the whole polygon buffer. You must overshoot by this much to switch.
 */
export const DEPTH_ZOOM_HYSTERESIS = 0.25;

/** Depth a zoom maps to, ignoring hysteresis. */
function rawDepthForZoom(zoom: number): Depth {
    let depth = 1;
    for (const brk of DEPTH_ZOOM_BREAKS) {
        if (zoom >= brk) depth++;
    }
    return depth as Depth;
}

/**
 * Depth for `zoom`, holding `current` while inside the deadband of the break being
 * crossed. A jump of more than one level commits immediately (that is a `fitBounds`
 * flight, not gesture jitter).
 */
export function depthForZoom(zoom: number, current: Depth): Depth {
    const raw = rawDepthForZoom(zoom);
    if (raw === current) return current;
    if (Math.abs(raw - current) > 1) return raw;

    // The break separating the two candidate depths: index = the lower depth - 1.
    const brk = DEPTH_ZOOM_BREAKS[Math.min(raw, current) - 1];
    // Symmetric bounds, so the deadband is exactly as wide in both directions.
    if (raw > current) {
        // Zooming in: commit only once clearly past the break.
        return zoom >= brk + DEPTH_ZOOM_HYSTERESIS ? raw : current;
    }
    return zoom <= brk - DEPTH_ZOOM_HYSTERESIS ? raw : current;
}

// --- Colour ----------------------------------------------------------------

/**
 * Sequential single-hue ramp, pale → deep, shared with DistanceCalendar so the
 * guide reads as one system. One direction in both themes: more time is always the
 * deeper, more saturated red. (An earlier version flipped the anchor in dark mode
 * so the top of the ramp was the *lightest* step; it read backwards, because a
 * saturated red is what says "a lot" regardless of the background.)
 */
export const ZONE_RAMP = ['#fee2e2', '#fca5a5', '#f87171', '#ef4444', '#b91c1c'];

const interpolateRamp = interpolateRgbBasis(ZONE_RAMP);

/**
 * The map has no basemap: the reference polygons *are* the map. Every zone that
 * exists in `geo_zones` is drawn as white land with an outline, and the sea is
 * simply the page showing through. So a zone's fill is always composited over
 * white here, which keeps the colour identical in both themes and lets the legend
 * show exactly the colours the map uses.
 */
export const LAND_RGB: [number, number, number] = [255, 255, 255];

/**
 * How much of the ramp a zone takes on, from barely-there to solid. Value is
 * carried by saturation as well as hue: a zone visited once stays a whisper of
 * pink against the white land instead of reading as a full category.
 */
export const MIN_MIX = 0.16;
export const MAX_MIX = 1;

export interface ZoneColorScale {
    /** Domain, in metric units. */
    lo: number;
    hi: number;
    /** Position of a value along the ramp in [0,1]; -1 when there is nothing. */
    t(value: number | undefined): number;
    /** Opaque fill for a value, composited over the white land. */
    fill(value: number | undefined): [number, number, number];
    /** `count` CSS colours evenly along the ramp, for the legend gradient. */
    samples(count: number): string[];
    /** `count` domain values evenly along the ramp, for the legend ticks. */
    ticks(count: number): number[];
}

/**
 * Continuous colour scale over the positive values, spaced **logarithmically**.
 *
 * Continuous rather than binned: the buckets were an artefact of the ramp having
 * five steps, and they invented boundaries the data does not have — two zones a
 * minute apart could land in different bins while a 10x gap sat inside one.
 *
 * Log rather than linear because the range is extreme: the home region against a
 * country crossed once spans four or five orders of magnitude, and a linear domain
 * paints everything but home in the palest sliver of the ramp. On a log domain each
 * equal step of colour means the same *multiple* of time, which is how this reads
 * naturally anyway ("ten times more than there").
 */
export function makeColorScale(values: readonly number[]): ZoneColorScale {
    const positive = values.filter((v) => v > 0);
    const lo = positive.length ? Math.min(...positive) : 0;
    const hi = positive.length ? Math.max(...positive) : 0;
    const logLo = Math.log(lo);
    const span = Math.log(hi) - logLo;

    const t = (value: number | undefined): number => {
        if (value === undefined || !(value > 0)) return -1;
        // No domain at all (nothing visited): there is nothing to place a value
        // against, so it stays "no data" rather than defaulting to the top.
        if (positive.length === 0) return -1;
        // A single visited zone (or all-equal values) has no span to speak of, so it
        // takes the top of the ramp rather than dividing by zero.
        if (!(span > 0)) return 1;
        return Math.min(1, Math.max(0, (Math.log(value) - logLo) / span));
    };

    /** Ramp colour at `u`, mixed into the land by the same amount. */
    const at = (u: number): [number, number, number] => {
        const c = rgb(interpolateRamp(u));
        const mix = MIN_MIX + u * (MAX_MIX - MIN_MIX);
        return [
            Math.round(c.r * mix + LAND_RGB[0] * (1 - mix)),
            Math.round(c.g * mix + LAND_RGB[1] * (1 - mix)),
            Math.round(c.b * mix + LAND_RGB[2] * (1 - mix)),
        ];
    };

    return {
        lo,
        hi,
        t,
        fill(value) {
            const u = t(value);
            return u < 0 ? LAND_RGB : at(u);
        },
        samples(count) {
            const n = Math.max(2, count);
            return Array.from({ length: n }, (_, i) => {
                const [r, g, b] = at(i / (n - 1));
                return `rgb(${r} ${g} ${b})`;
            });
        },
        ticks(count) {
            const n = Math.max(2, count);
            if (!(span > 0)) return Array.from({ length: n }, () => hi);
            return Array.from({ length: n }, (_, i) =>
                Math.exp(logLo + (i / (n - 1)) * span),
            );
        },
    };
}

// --- Geometry-derived indexes ---------------------------------------------

export type ZoneFeature = Feature<Geometry, Record<string, unknown>>;

/** A feature's normalized hierarchy, read off the topojson properties. */
export function pathOfFeature(f: ZoneFeature): ZonePath {
    return normalizePath(f.properties ?? {});
}

/**
 * Property under which each feature carries its own four keys. deck.gl's
 * GeoJsonLayer splits its input into point/line/polygon sub-layers, so the `index`
 * handed to an accessor indexes the *sub-layer's* data rather than ours — reading
 * the key off the feature keeps the lookup correct regardless of that split.
 */
export const ZONE_KEYS_PROP = 'zoneKeys';

/** The stashed key of `f` at `depth`, or '' when it has none. */
export function keyOfFeature(f: ZoneFeature, depth: Depth): string {
    const keys = (f.properties ?? {})[ZONE_KEYS_PROP] as string[] | undefined;
    return keys?.[depth - 1] ?? '';
}

/** Writes each feature's four keys onto its properties, for `keyOfFeature`. */
export function stashFeatureKeys(
    features: readonly ZoneFeature[],
    featureKeys: readonly string[][],
): void {
    for (let i = 0; i < features.length; i++) {
        const f = features[i];
        f.properties = { ...(f.properties ?? {}), [ZONE_KEYS_PROP]: featureKeys[i] };
    }
}

/**
 * Per feature, its key at each of the four depths — precomputed once, since the
 * fill accessor runs per feature on every depth/metric change.
 */
export function buildFeatureKeys(features: readonly ZoneFeature[]): string[][] {
    return features.map((f) => {
        const path = pathOfFeature(f);
        return DEPTHS.map((d) => zoneKey(path, d));
    });
}

/**
 * Longitude-aware bounding box per feature, as a flat [w, s, e, n, …] array.
 *
 * A feature whose own longitude span exceeds 180° straddles the antimeridian
 * (Russia, Fiji), and a naive min/max there spans the planet — `fitBounds` would
 * then zoom *out*. Such features are measured in a shifted frame where negative
 * longitudes are moved by +360; MapLibre accepts lng > 180 and wraps correctly.
 */
export function buildFeatureBoxes(features: readonly ZoneFeature[]): Float64Array {
    const out = new Float64Array(features.length * 4);
    for (let i = 0; i < features.length; i++) {
        const lons: number[] = [];
        const lats: number[] = [];
        eachPosition(features[i].geometry, (lon, lat) => {
            lons.push(lon);
            lats.push(lat);
        });
        if (lons.length === 0) {
            out.set([NaN, NaN, NaN, NaN], i * 4);
            continue;
        }
        let w = Math.min(...lons);
        let e = Math.max(...lons);
        if (e - w > 180) {
            const shifted = lons.map((l) => (l < 0 ? l + 360 : l));
            w = Math.min(...shifted);
            e = Math.max(...shifted);
        }
        out.set([w, Math.min(...lats), e, Math.max(...lats)], i * 4);
    }
    return out;
}

/**
 * Latitude bound for anything handed to deck.gl. Web Mercator is undefined at the
 * poles, and `lngLatToWorld` hard-asserts the range: a single out-of-range vertex
 * makes SolidPolygonLayer throw during initialization, which kills the *entire*
 * fill layer and leaves a blank map. Antarctica's simplified ring reaches
 * −90.00000000000001, so this is not hypothetical.
 */
export const MAX_LATITUDE = 89.9;

/**
 * Prepares raw topojson features for deck.gl: clamps latitudes into the
 * projectable range and drops features left with no coordinates at all
 * (simplification emptied two sea polygons, which deck reports as malformed).
 * Mutates coordinates in place — the features are freshly parsed and owned here.
 */
export function sanitizeFeatures(features: readonly ZoneFeature[]): ZoneFeature[] {
    const out: ZoneFeature[] = [];
    for (const f of features) {
        let count = 0;
        eachPositionRef(f.geometry, (pos) => {
            count++;
            if (pos[1] > MAX_LATITUDE) pos[1] = MAX_LATITUDE;
            else if (pos[1] < -MAX_LATITUDE) pos[1] = -MAX_LATITUDE;
        });
        if (count > 0) out.push(f);
    }
    return out;
}

/** Clamps a mesh's line coordinates, which come from arcs rather than features. */
export function sanitizeLines(lines: number[][][]): number[][][] {
    for (const line of lines) {
        for (const pos of line) {
            if (pos[1] > MAX_LATITUDE) pos[1] = MAX_LATITUDE;
            else if (pos[1] < -MAX_LATITUDE) pos[1] = -MAX_LATITUDE;
        }
    }
    return lines;
}

function eachPositionRef(geom: Geometry, fn: (pos: number[]) => void): void {
    if (geom == null) return;
    if (geom.type === 'GeometryCollection') {
        for (const g of geom.geometries) eachPositionRef(g, fn);
        return;
    }
    const walk = (coords: unknown): void => {
        if (!Array.isArray(coords)) return;
        if (typeof coords[0] === 'number') {
            fn(coords as number[]);
            return;
        }
        for (const c of coords) walk(c);
    };
    walk((geom as { coordinates?: unknown }).coordinates);
}

function eachPosition(geom: Geometry, fn: (lon: number, lat: number) => void): void {
    if (geom.type === 'GeometryCollection') {
        for (const g of geom.geometries) eachPosition(g, fn);
        return;
    }
    const walk = (coords: unknown): void => {
        if (!Array.isArray(coords)) return;
        if (typeof coords[0] === 'number') {
            fn(coords[0] as number, coords[1] as number);
            return;
        }
        for (const c of coords) walk(c);
    };
    walk((geom as { coordinates?: unknown }).coordinates);
}

/**
 * Per feature, the centroid of its largest outer ring and that ring's area, as
 * flat [lon, lat, …] / [area, …] arrays. With no basemap there are no place labels
 * to borrow, so the map draws its own from these anchors.
 *
 * The *largest ring* rather than an area-weighted mean over all of them: a mean
 * drags a country with far-flung territories out into the ocean (France's overseas
 * departments would pull its label into the Atlantic), whereas the biggest single
 * landmass is where a reader expects the name. Ring areas are compared in degrees²
 * scaled by cos(latitude), which is enough to rank them.
 */
export function buildFeatureAnchors(features: readonly ZoneFeature[]): {
    anchors: Float64Array;
    areas: Float64Array;
} {
    const anchors = new Float64Array(features.length * 2);
    const areas = new Float64Array(features.length);
    for (let i = 0; i < features.length; i++) {
        let best = -1;
        let bestAnchor: [number, number] = [NaN, NaN];
        eachOuterRing(features[i].geometry, (ring) => {
            const c = ringCentroid(ring);
            if (c === null) return;
            if (c.area > best) {
                best = c.area;
                bestAnchor = [c.x, c.y];
            }
        });
        anchors[i * 2] = bestAnchor[0];
        anchors[i * 2 + 1] = bestAnchor[1];
        areas[i] = best;
    }
    return { anchors, areas };
}

/** Label anchor per zone key at one depth: the anchor of its largest member. */
export function anchorsByKey(
    featureKeys: readonly string[][],
    anchors: Float64Array,
    areas: Float64Array,
    depth: Depth,
): Map<string, [number, number]> {
    const best = new Map<string, number>();
    const out = new Map<string, [number, number]>();
    for (let i = 0; i < featureKeys.length; i++) {
        const key = featureKeys[i][depth - 1];
        if (key === '' || !(areas[i] > 0)) continue;
        const lon = anchors[i * 2];
        if (Number.isNaN(lon)) continue;
        if (areas[i] > (best.get(key) ?? -1)) {
            best.set(key, areas[i]);
            out.set(key, [lon, anchors[i * 2 + 1]]);
        }
    }
    return out;
}

function eachOuterRing(geom: Geometry, fn: (ring: number[][]) => void): void {
    if (geom == null) return;
    if (geom.type === 'Polygon') {
        const ring = (geom.coordinates ?? [])[0];
        if (ring) fn(ring as number[][]);
    } else if (geom.type === 'MultiPolygon') {
        for (const poly of geom.coordinates ?? []) {
            const ring = poly[0];
            if (ring) fn(ring as number[][]);
        }
    } else if (geom.type === 'GeometryCollection') {
        for (const g of geom.geometries) eachOuterRing(g, fn);
    }
}

/** Shoelace centroid and cos-scaled area of a ring; null when degenerate. */
function ringCentroid(ring: number[][]): { x: number; y: number; area: number } | null {
    if (ring.length < 3) return null;
    let twiceArea = 0;
    let cx = 0;
    let cy = 0;
    let latSum = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i];
        const [xj, yj] = ring[j];
        const cross = xj * yi - xi * yj;
        twiceArea += cross;
        cx += (xj + xi) * cross;
        cy += (yj + yi) * cross;
        latSum += yi;
    }
    const meanLat = latSum / ring.length;
    const scale = Math.max(0.05, Math.cos((meanLat * Math.PI) / 180));
    if (twiceArea === 0) {
        // A degenerate sliver still deserves an anchor, just a negligible weight.
        let sx = 0;
        let sy = 0;
        for (const [x, y] of ring) {
            sx += x;
            sy += y;
        }
        return { x: sx / ring.length, y: sy / ring.length, area: 0 };
    }
    return {
        x: cx / (3 * twiceArea),
        y: cy / (3 * twiceArea),
        area: Math.abs(twiceArea / 2) * scale,
    };
}

// --- Labels ----------------------------------------------------------------

export interface LabelCandidate {
    text: string;
    position: [number, number];
    /** Ranking weight — the metric value, so the biggest zones win a contest. */
    value: number;
}

export interface LabelViewport {
    width: number;
    height: number;
    longitude: number;
    latitude: number;
    zoom: number;
}

/** Web Mercator world size in pixels at a zoom level (512 px tiles). */
const worldSize = (zoom: number) => 512 * Math.pow(2, zoom);

function project(
    lon: number,
    lat: number,
    vp: LabelViewport,
): [number, number] {
    const size = worldSize(vp.zoom);
    const clamp = Math.max(-85.051129, Math.min(85.051129, lat));
    const rad = (clamp * Math.PI) / 180;
    const toX = (l: number) => ((l + 180) / 360) * size;
    const toY = (r: number) =>
        ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * size;

    const cx = toX(vp.longitude);
    const cy = toY((Math.max(-85.051129, Math.min(85.051129, vp.latitude)) * Math.PI) / 180);
    return [toX(lon) - cx + vp.width / 2, toY(rad) - cy + vp.height / 2];
}

/** Rough text box, good enough to keep labels from colliding. */
const CHAR_WIDTH_RATIO = 0.55;
const LABEL_PADDING = 4;

/**
 * Greedy label placement: project the candidates, drop the off-screen ones, then
 * keep them in descending order of value, skipping any whose box would overlap one
 * already kept.
 *
 * With no basemap the map draws its own names, so nothing else is de-cluttering
 * them — and a few dozen candidates is far too few to justify pulling in
 * `@deck.gl/extensions` for its collision filter. Ranking by value means that when
 * two names fight for the same space, the zone you spent more time in wins.
 */
export function layoutLabels(
    candidates: readonly LabelCandidate[],
    vp: LabelViewport,
    fontSize = 11,
): LabelCandidate[] {
    if (!vp.width || !vp.height) return [];
    const margin = 40;
    const placed: { x0: number; y0: number; x1: number; y1: number }[] = [];
    const kept: LabelCandidate[] = [];

    const ranked = [...candidates].sort((a, b) => b.value - a.value);
    for (const c of ranked) {
        const [x, y] = project(c.position[0], c.position[1], vp);
        if (
            !Number.isFinite(x) ||
            !Number.isFinite(y) ||
            x < -margin ||
            y < -margin ||
            x > vp.width + margin ||
            y > vp.height + margin
        ) {
            continue;
        }
        const halfW = (c.text.length * fontSize * CHAR_WIDTH_RATIO) / 2 + LABEL_PADDING;
        const halfH = fontSize / 2 + LABEL_PADDING;
        const box = { x0: x - halfW, y0: y - halfH, x1: x + halfW, y1: y + halfH };
        const hits = placed.some(
            (p) => box.x0 < p.x1 && box.x1 > p.x0 && box.y0 < p.y1 && box.y1 > p.y0,
        );
        if (hits) continue;
        placed.push(box);
        kept.push(c);
    }
    return kept;
}

/**
 * Bounds per zone key at one depth, unioning every feature that shares the key —
 * necessary because 28 leaves are multi-part geometries with identical properties,
 * so key → feature is one-to-many.
 */
export function boundsByKey(
    featureKeys: readonly string[][],
    boxes: Float64Array,
    depth: Depth,
): Map<string, MapBounds> {
    const acc = new Map<string, BoxAcc>();
    for (let i = 0; i < featureKeys.length; i++) {
        const key = featureKeys[i][depth - 1];
        if (key === '') continue;
        const w = boxes[i * 4];
        if (Number.isNaN(w)) continue;
        let cur = acc.get(key);
        if (!cur) acc.set(key, (cur = newBoxAcc()));
        addBox(cur, w, boxes[i * 4 + 1], boxes[i * 4 + 2], boxes[i * 4 + 3]);
    }
    const out = new Map<string, MapBounds>();
    for (const [key, a] of acc) out.set(key, finishBoxAcc(a));
    return out;
}

/**
 * Union of several zones' bounds — used to frame the visited world on reset.
 *
 * Longitude is treated as circular, because the inputs are not all in the same
 * frame: `boundsByKey` hands back a zone that wraps the antimeridian in a shifted
 * frame (the USA comes out as 172.5°→293°, its Aleutians through to Maine). Adding
 * that to European boxes as if it were ordinary degrees produced a box spanning
 * 324° the long way round through Asia, which framed the map on the wrong ocean.
 *
 * So: every box is folded onto the circle, the covered arcs are merged, and the
 * answer is the complement of the **largest uncovered gap** — the smallest arc that
 * actually contains every zone.
 */
export function unionBounds(all: readonly MapBounds[]): MapBounds | null {
    if (all.length === 0) return null;

    let south = Infinity;
    let north = -Infinity;
    const arcs: { start: number; end: number }[] = [];
    for (const b of all) {
        south = Math.min(south, b[0][1]);
        north = Math.max(north, b[1][1]);
        const width = Math.min(360, Math.max(0, b[1][0] - b[0][0]));
        // Fold the start onto [0, 360) and carry the width with it.
        const start = ((((b[0][0] % 360) + 360) % 360) + 360) % 360;
        const end = start + width;
        if (end <= 360) arcs.push({ start, end });
        else {
            arcs.push({ start, end: 360 }, { start: 0, end: end - 360 });
        }
    }
    if (arcs.length === 0) return null;

    arcs.sort((a, b) => a.start - b.start);
    const merged: { start: number; end: number }[] = [];
    for (const arc of arcs) {
        const last = merged[merged.length - 1];
        if (last && arc.start <= last.end) last.end = Math.max(last.end, arc.end);
        else merged.push({ ...arc });
    }

    // Each uncovered gap yields a candidate arc: everything except that gap.
    const gaps: { start: number; length: number }[] = [
        {
            start: merged[merged.length - 1].end,
            length: merged[0].start + 360 - merged[merged.length - 1].end,
        },
    ];
    for (let i = 1; i < merged.length; i++) {
        gaps.push({
            start: merged[i - 1].end,
            length: merged[i].start - merged[i - 1].end,
        });
    }

    const candidates = gaps.map((g) => {
        let west = g.start + g.length;
        let east = west + (360 - g.length);
        // Keep the centre in [-180, 180): the camera works in that frame.
        if ((west + east) / 2 >= 180) {
            west -= 360;
            east -= 360;
        }
        return { west, east, span: east - west, centre: (west + east) / 2 };
    });

    // Smallest arc wins — but a near-tie goes to the more Greenwich-centred one.
    // Being a few percent tighter is not worth re-centring the world on the Pacific
    // and pushing a continent out to the very edge of the frame.
    const TIE = 1.15;
    const tightest = Math.min(...candidates.map((c) => c.span));
    const best = candidates
        .filter((c) => c.span <= tightest * TIE)
        .sort((a, b) => Math.abs(a.centre) - Math.abs(b.centre))[0];

    return [
        [best.west, south],
        [best.east, north],
    ];
}

/**
 * Longitude unions are accumulated in two frames at once — as-is, and with negative
 * longitudes shifted by +360 — and the narrower one wins.
 *
 * Per-feature normalization is not enough here: Russia's Chukotka and Alaska's
 * Aleutians are *separate* features from their mainland, each narrow on its own, so
 * a naive union of them spans the entire planet and `fitBounds` zooms out to the
 * whole world on a click. Meanwhile France, whose overseas territories genuinely
 * straddle the globe the other way, must keep its unshifted frame — hence picking
 * per zone rather than applying one rule everywhere.
 */
interface BoxAcc {
    w: number;
    e: number;
    sw: number;
    se: number;
    s: number;
    n: number;
}

const newBoxAcc = (): BoxAcc => ({
    w: Infinity,
    e: -Infinity,
    sw: Infinity,
    se: -Infinity,
    s: Infinity,
    n: -Infinity,
});

function addBox(a: BoxAcc, w: number, s: number, e: number, n: number): void {
    if (w < a.w) a.w = w;
    if (e > a.e) a.e = e;
    // The whole box shifts or none of it does: shifting the two edges independently
    // would invert any box straddling the prime meridian (west −2°, east 0°).
    const shift = w < 0 ? 360 : 0;
    if (w + shift < a.sw) a.sw = w + shift;
    if (e + shift > a.se) a.se = e + shift;
    if (s < a.s) a.s = s;
    if (n > a.n) a.n = n;
}

function finishBoxAcc(a: BoxAcc): MapBounds {
    // The shifted frame is only there to repair a zone that genuinely *wraps* the
    // antimeridian — one whose parts are contiguous once you cross ±180. Merely
    // being narrower is not enough: the union of every visited country spans the
    // globe either way, and picking the shifted frame there re-centres the map on
    // the Pacific and cuts Europe in half at both edges.
    const useShifted = a.e - a.w > 180 && a.se - a.sw <= 180;
    const w = useShifted ? a.sw : a.w;
    const e = useShifted ? a.se : a.e;
    return [
        [w, a.s],
        [e, a.n],
    ];
}
