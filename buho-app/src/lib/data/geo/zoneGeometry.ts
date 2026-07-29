import { base } from '$app/paths';
import { feature, mesh } from 'topojson-client';
import type { FeatureCollection } from 'geojson';
import type { GeometryCollection, Topology } from 'topojson-specification';
import type { MapBounds } from '$lib/visualizations/locationMapData';
import {
    DEPTHS,
    boundsByKey,
    anchorsByKey,
    buildFeatureAnchors,
    buildFeatureBoxes,
    buildFeatureKeys,
    stashFeatureKeys,
    sanitizeFeatures,
    sanitizeLines,
    zoneKey,
    pathOfFeature,
    type Depth,
    type ZoneFeature,
} from '$lib/visualizations/zoneChoropleth';

/**
 * Loads the zone polygons for the guide's choropleth, keeping the GeoJSON that
 * `loadGeoAssets` deliberately throws away (it only needs geometry inside DuckDB).
 *
 * Fetched lazily, on the choropleth section coming into view — never at import
 * time. The parse retains a lot of JS objects, and doing it during the upload would
 * stack it on top of the zone attribution that already pushes DuckDB toward the
 * ~3 GB wasm ceiling (see the RTREE comment in loadGeoAssets). By the time this
 * runs, attribution has finished and released its working tables, so the two memory
 * peaks never overlap. The assets are plain `static/` files already in the HTTP
 * cache from that earlier load, so the second fetch costs a revalidation.
 */

const ZONE_FILE = 'geo_zones.topojson';

export interface ZoneGeometry {
    /**
     * Every admin leaf polygon. Each carries its four zone keys in its properties
     * (see `stashFeatureKeys`), so the fill accessor reads them off the feature.
     */
    features: ZoneFeature[];
    /** Per depth, zone key → bounds (unioned over multi-part zones). */
    boundsByDepth: Record<Depth, Map<string, MapBounds>>;
    /**
     * Per depth, zone key → label anchor. With no basemap there are no borrowed
     * place labels, so the map draws names at these points.
     */
    anchorsByDepth: Record<Depth, Map<string, [number, number]>>;
    /**
     * Per depth, the keys that actually have drawable geometry — a key with no
     * polygon can neither be filled nor colour the scale, and the shortfall is what
     * the map's "not on the map" caption reports.
     */
    drawableByDepth: Record<Depth, Set<string>>;
    /**
     * Border lines for a depth: only the arcs separating two *different* zones at
     * that depth, plus the outer coastline. This is what makes the undissolved leaf
     * polygons read as one solid zone per ancestor.
     *
     * Cut on demand rather than up front: the source `Topology` (delta-encoded
     * integer arcs) is far more compact than the expanded meshes, which run from
     * 223k coordinate pairs at depth 1 to 367k at depth 4. Cutting one takes ~40 ms,
     * so the last two depths are cached — enough that zooming back and forth across
     * a single break never recuts, without holding all four resident.
     */
    meshFor(depth: Depth): number[][][];
}

let pending: Promise<ZoneGeometry | null> | null = null;

/** Idempotent: concurrent callers and remounts share one fetch/parse. */
export function loadZoneGeometry(): Promise<ZoneGeometry | null> {
    pending ??= build();
    return pending;
}

/** Test seam — drops the memoised geometry. */
export function resetZoneGeometry(): void {
    pending = null;
}

async function build(): Promise<ZoneGeometry | null> {
    const zoneTopo = await fetchJson<Topology>(`${base}/geo/${ZONE_FILE}`);
    if (!zoneTopo) return null;

    const zoneObject = Object.keys(zoneTopo.objects)[0];

    // Seas are deliberately not loaded: `ocean.topojson` still feeds the attribution
    // fallback in loadGeoAssets, but a sea has no place in a map of time spent per
    // administrative zone — and its area dwarfs any country's, so a few hours of
    // flying would dominate the frame. ZONE_ROLLUP_SQL drops the matching rows.
    //
    // sanitizeFeatures must come before anything else touches the coordinates: an
    // unclamped pole vertex makes deck.gl's polygon layer throw on init and render
    // nothing at all.
    const features = sanitizeFeatures(featuresOf(zoneTopo, zoneObject));
    const featureKeys = buildFeatureKeys(features);
    const boxes = buildFeatureBoxes(features);
    // Each feature carries its own keys, so the fill accessor never has to trust
    // deck.gl's per-sub-layer index to line up with `featureKeys`.
    stashFeatureKeys(features, featureKeys);

    const boundsByDepth = Object.fromEntries(
        DEPTHS.map((d) => [d, boundsByKey(featureKeys, boxes, d)]),
    ) as Record<Depth, Map<string, MapBounds>>;

    const { anchors, areas } = buildFeatureAnchors(features);
    const anchorsByDepth = Object.fromEntries(
        DEPTHS.map((d) => [d, anchorsByKey(featureKeys, anchors, areas, d)]),
    ) as Record<Depth, Map<string, [number, number]>>;

    // A key has drawable geometry exactly when it produced a bounding box, which
    // boundsByKey only does for features with finite coordinates.
    const drawableByDepth = Object.fromEntries(
        DEPTHS.map((d) => [d, new Set(boundsByDepth[d].keys())]),
    ) as Record<Depth, Set<string>>;

    const MESH_CACHE_SIZE = 2;
    const meshCache = new Map<Depth, number[][][]>();

    return {
        features,
        boundsByDepth,
        anchorsByDepth,
        drawableByDepth,
        meshFor(depth: Depth) {
            const cached = meshCache.get(depth);
            if (cached) return cached;
            const lines = buildMesh(zoneTopo, zoneObject, depth);
            if (meshCache.size >= MESH_CACHE_SIZE) {
                meshCache.delete(meshCache.keys().next().value as Depth);
            }
            meshCache.set(depth, lines);
            return lines;
        },
    };
}

function featuresOf(topo: Topology, objectName: string): ZoneFeature[] {
    const fc = feature(topo, topo.objects[objectName] as GeometryCollection) as FeatureCollection;
    return fc.features as ZoneFeature[];
}

/**
 * `mesh` works in arc space — it never touches coordinates — so filtering it is
 * cheap compared with any geometric dissolve. The filter receives the two geometry
 * objects sharing an arc; for an exterior arc they are the same object, which we
 * keep so the choropleth's outer edge stays defined.
 */
function buildMesh(topo: Topology, objectName: string, depth: Depth): number[][][] {
    const keyOf = (g: unknown): string =>
        zoneKey(pathOfFeature({ properties: (g as { properties?: unknown }).properties ?? {} } as ZoneFeature), depth);

    const lines = mesh(topo, topo.objects[objectName] as GeometryCollection, (a, b) =>
        a === b ? true : keyOf(a) !== keyOf(b),
    );
    return sanitizeLines((lines.coordinates ?? []) as number[][][]);
}

async function fetchJson<T>(url: string): Promise<T | null> {
    try {
        const res = await fetch(url);
        if (!res.ok) return null;
        return (await res.json()) as T;
    } catch {
        // Assets may be absent in early dev; the section then shows its empty state.
        return null;
    }
}
