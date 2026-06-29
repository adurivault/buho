# PRD — Google Maps Explorer interactive map

> Status: proposal · Source: `google_maps_segments` (lat/lon) + already-computed geo attribution
> **Scope**: render the GPS points on a zoomable/fluid basemap in `/google-maps/explore`. **Distinct feature** from the geographic attribution.
> **Relation to the other PRDs**: replaces and refines §8 "Basemap & rendering" of [prd-google-maps-geo.md](./prd-google-maps-geo.md) (which stayed skeletal). **Depends** on the geo attribution ([prd-google-maps-geo-v2.md](./prd-google-maps-geo-v2.md), done) only to enrich tooltips — the map places the points even without attribution.

## 1. Goal

The Google Maps Explorer already exists (time × hour constellation + geo sunburst + pies, with cross-filtering) but **has no map**. Yet the data is geographic: the spatial view is missing. This increment adds an **interactive map that places the GPS points**, fluid on pan/zoom, faithful to the "show everything all the time" ideal.

Non-goal: reworking the attribution, the narrative Guide (static per-section maps = separate batch), or bidirectional cross-filtering (cf. §6, door kept open but out of v1).

## 2. The data (what constrains the design)

In `google_maps_segments`, **one row = one point** (scalar lat/lon), produced by `parseGoogleMaps.ts`:

- `visit` → 1 `stationary` point (place);
- `activity` → 1 `moving` point (trip start);
- `timelinePath` → **1 `moving` point per breadcrumb** — this is the bulk of the volume.

Consequences:

1. **Volume up to ~10⁶ points** for a multi-year history (breadcrumbs dominate). That's *more* than Spotify (~10⁵) at the top of the range — performance is not a detail.
2. **Trajectories don't exist as geometry.** Each breadcrumb is an isolated point, with no `path_id`/`trip_id` linking the points of a same trip. Drawing trip lines is therefore **not free** (it would require grouping consecutive `moving` points close in time, or adding a path id at parse time). → **Out of v1**, points only.
3. The points are **already in memory**: `getGoogleMapsExplorerBasePoints()` loads `lat`/`lon` (among others) once for the constellation. The map **reuses that same array** → **zero extra query**.

## 3. Why a map is a different perf problem than the constellation

The constellation reprojects on the **CPU** (`scaledData`, d3 scales) **only when the view domain changes** (brush), then redraws with a per-point `fillRect` (`ConstellationChart.svelte`). It's O(N) per **discrete event** — costly but tolerated because it's rare.

A map breaks that assumption: **pan and zoom are continuous gestures**. During the gesture, every point must be **reprojected (mercator) and redrawn each frame (60 fps)**. Reprojecting 10⁶ points/frame on Canvas 2D = unplayable. It's not "heavier": it's an interaction of a different nature, and it's precisely the point of a map.

→ **Rendering must be GPU.** This is the structuring decision.

## 4. Technical decisions

| Topic | Decision | Reason |
| --- | --- | --- |
| Point rendering | **deck.gl `ScatterplotLayer`** as an overlay (`MapboxOverlay`, MapLibre-compatible) | Positions uploaded **once** to a GPU buffer; pan/zoom = update of a view uniform → ~1 ms regardless of N. Dynamic highlight = color-buffer update (cf. §6). |
| Basemap | **MapLibre GL JS** + **OpenFreeMap** tiles, dark style | Free, no key, no quota. WebGL (consistent with the overlay). |
| Point source | **Reuse `basePoints`** (lat/lon already loaded) + the same `matchVersion` as the constellation | No extra query; the highlight stays in sync between the two views. |
| Library loading | **Lazy**, on the Google Maps path only | deck.gl + maplibre ≈ ~150–250 KB gzip; Spotify users don't pay. Same logic as `loadSpatial()`. |
| v1 interaction | Pan/zoom + tooltip + **`matched` highlight** (the map reflects filters); **emits no filter** | Highlight almost free (shared buffer); cross-filter *from* the map = not decided (§6). |
| Trajectories | **Out of v1** (points only) | Topology not stored (cf. §2). |

### Why deck.gl rather than native MapLibre layers

MapLibre's `circle`/`heatmap` are also GPU (so fluid on pan/zoom), but you feed them a **GeoJSON source**: parsing + tiling of 10⁶ features upfront, and above all **dynamic restyling** (our `matched` highlight) via per-feature `setFeatureState` = slow at this scale. deck.gl keeps the data in **our** typed arrays and updates a color buffer via `updateTriggers` — a direct mapping onto the existing `matched`/`matchVersion` pattern. deck.gl's cost is the **bundle**; everything else favors it for our case (large point cloud restyled dynamically).

## 5. Memory budget

Marginal cost is near zero, because the heavy JS objects (`basePoints`) are **already** in memory (paid for by the constellation). The map only adds derived typed arrays:

- positions `Float32Array(2N)` → **8 MB** at N = 10⁶;
- colors `Uint8Array(4N)` → **4 MB**.

Built once from `basePoints`, never rebuilt (the highlight only touches the color buffer).

## 6. Cross-filtering: the map reflects filters in v1, doesn't emit them

V1 = the map **reflects** filters but doesn't **emit** them. The deck.gl choice closes no door for the missing direction.

- **Reflecting filters** (sunburst/pies/brush → map): **included in v1** via the `matched` highlight, almost free because the map and the constellation **share `basePoints` + `matchVersion`** (a non-`matched` point is dimmed, as in the constellation).
- **Filtering from the map** (box/lasso → all views): **out of v1**. deck.gl has native **picking** (GPU hit-test) → feasible later without a rework.

⚠️ **The only commitment to honor** so we don't paint ourselves into a corner: the map and the constellation read **the same reactive array** and the same `matchVersion`. As long as that holds, display-only ↔ bidirectional stays a local change.

## 7. Placement in the Explorer

V1: **toggle map ↔ constellation** in the large left panel (a "where" / "when" switch); sunburst + pies unchanged. Minimal layout churn, maximal reuse.

> Alternative kept in mind (not decided, **orthogonal** to the deck.gl choice): the **temporal** constellation always visible + a **spatial** slot that toggles map ↔ sunburst. Since the map reads the same reactive array, this variant becomes nearly free if we want it.

## 8. Legibility when zoomed out (overplotting)

At world scale, 10⁶ overlapping dots: deck.gl **draws** them without trouble (perf OK) — it's a **legibility** issue, not a perf one. Handled with **small radius + low alpha**: dense areas emerge naturally through alpha accumulation, without hiding anything. **Points only, no dedicated heatmap layer** (alpha accumulation is enough; a heatmap would remain a phase-3 lead if the need is ever confirmed).

## 9. Invariants (unchanged)

1. **No network egress of user data**: coordinates never leave the browser; the map renders locally. The only network flow = the **tiles** (which reveal the *viewport*, not the data) + the libraries' code.
2. **No persistence** of user data.
3. Tile nuance to document (already acknowledged in v1 §9); removable later via self-hosted **Protomaps `.pmtiles`** (config change, not architecture).

## 10. Dependencies & files

| Item | Nature | Role |
| --- | --- | --- |
| `maplibre-gl` | new (lazy) | WebGL basemap |
| `deck.gl` (core + layers) + `@deck.gl/mapbox` | new (lazy) | `ScatterplotLayer` overlay (`MapboxOverlay`) |
| `lib/components/visualizations/LocationMap.svelte` | new | Map component (props: `data: LocationBasePoint[]`, `matchVersion`, tooltip, color) |
| `routes/google-maps/explore/+page.svelte` | modified | Map↔constellation toggle in the main panel |
| `getGoogleMapsExplorerBasePoints()` | **unchanged** | `lat`/`lon` already provided |

## 11. Phasing

**Phase 1 — map display + highlight**: MapLibre + dark OpenFreeMap, deck.gl `ScatterplotLayer` over `basePoints`, lazy-load, toggle with the constellation, hover/click tooltip (reuse `constellationTooltip` / `geoLine`), points only, **dimming of non-`matched`** (highlight shared with the constellation via `matchVersion`).

**Phase 2 — coloring**: coloring by dimension (`colorBy`, like the constellation).

**Phase 3 — optional / if value is confirmed**: cross-filter from the map (box/lasso via picking); trajectories (requires a `path_id` at parse time); heatmap layer when zoomed out; self-hosted Protomaps tiles.

## 12. Open product decisions

1. **Placement**: map↔constellation toggle (retained) vs fixed constellation + togglable spatial slot (§7).
2. **Map style** dark OpenFreeMap by default — to validate visually.

> Decided: **points only** (no heatmap, §8) · **`matched` highlight included in v1** (§6).
