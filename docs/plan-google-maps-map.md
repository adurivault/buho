# Implementation plan — Google Maps Explorer interactive map (Phase 1)

> Reference PRD: [prd-google-maps-map.md](./prd-google-maps-map.md).
> Scope settled: **Phase 1 only** (display + `matched` highlight, points only, no coloring) ·
> **placement = constellation stays fixed, the right `aside` slot toggles map ↔ sunburst** (PRD §7 alternative).

## Context

`/google-maps/explore` already coordinates a temporal constellation + geo sunburst + dimension pies with all-JS
cross-filtering, but the data is geographic and there was **no spatial view**. This increment adds an interactive,
GPU-rendered point map that places the GPS points, stays fluid on pan/zoom, and **reflects** the active filters
(it does not emit them in v1).

The structuring constraint (PRD §3): pan/zoom are continuous gestures, so reprojecting up to ~10⁶ points per
frame must happen on the GPU. Hence deck.gl over a MapLibre basemap — positions uploaded once to a GPU buffer,
the highlight applied as a color-buffer update, a direct mapping onto the existing `matched`/`matchVersion`
pattern the page already drives.

**The one invariant honored** (PRD §6): the map reuses the *same* reactive `basePoints` array (`$state.raw`) and
the *same* `matchVersion` counter as the constellation, so display-only ↔ bidirectional cross-filtering stays a
local change later. No new query — `getGoogleMapsExplorerBasePoints()` already loads `lat`/`lon` inside each
point's `metadata`, and `matched` is a top-level boolean mutated in place by `computeMatched()`.

## Dependencies (runtime, `buho-app/package.json`)

- `maplibre-gl` — WebGL dark basemap
- `@deck.gl/core`, `@deck.gl/layers`, `@deck.gl/mapbox` — `ScatterplotLayer` via `MapboxOverlay` (MapLibre-compatible)

All four are imported **only dynamically, inside `LocationMap.svelte`'s `onMount`**, so Rollup code-splits them
into their own lazy chunk — never pulled into the Spotify path nor even the GM explore page until the user toggles
to the map. Types use **type-only** static imports (erased at build), so `npm run check` stays typed at no bundle
cost; no `@types` packages are needed (both ship their own).

## File map

| File | Nature | Role |
| --- | --- | --- |
| `src/lib/visualizations/locationMapData.ts` | new | Pure helpers `buildPositions` / `computeBounds`, no DOM/WebGL |
| `src/lib/visualizations/locationMapData.test.ts` | new | Colocated unit tests for the two helpers |
| `src/lib/components/visualizations/LocationMap.svelte` | new | MapLibre + deck.gl overlay; heavy libs lazy-imported in `onMount` |
| `src/routes/google-maps/explore/+page.svelte` | modified | Spatial-slot toggle (map ↔ sunburst); constellation untouched |
| `buho-app/package.json` | modified | the 4 runtime deps |

`getGoogleMapsExplorerBasePoints()` and `LocationBasePoint` are **unchanged**.

## Step 1 — Pure data helpers (`locationMapData.ts`)

- **`buildPositions(points)`** → `{ positions: Float32Array, mapPoints: LocationBasePoint[] }`. Keeps only points
  whose `metadata.lat`/`metadata.lon` are finite, emits `[lon, lat]` pairs (deck.gl order) into a `Float32Array`
  sized exactly once, and returns a **parallel `mapPoints`** array so the deck.gl `index` maps back to a point for
  both the highlight color and the tooltip even when some rows lack coordinates. Built once per upload.
- **`computeBounds(points)`** → `[[minLon, minLat], [maxLon, maxLat]]` over the finite-coord points, or `null`
  when none (caller then skips `fitBounds`).

Unit-tested in jsdom: `[lon, lat]` order; invalid coords (`NaN`/`null`/`undefined`/string/`Infinity`) dropped and
`mapPoints` realigned; bounds correct on a Paris/London/NYC fixture; `null` bounds on empty / all-invalid input.

## Step 2 — `LocationMap.svelte`

Props mirror what `ConstellationChart` receives (`data`, `matchVersion`, `width`, `height`, `formatTooltip`), so
the page passes the same things. On `onMount` (client-only) it dynamic-imports `maplibre-gl`, `@deck.gl/mapbox`,
`@deck.gl/layers` + the maplibre CSS, builds the positions buffer, creates the map (OpenFreeMap dark style,
default attribution control, `fitBounds` on load) and adds a `MapboxOverlay` holding one `ScatterplotLayer`:

- binary `getPosition: { value: positions, size: 2 }` (no per-point JS in the hot path);
- `getFillColor: (_, {index}) => mapPoints[index].matched ? MATCHED_RGBA : DIMMED_RGBA` with
  `updateTriggers: { getFillColor: matchVersion }` — a `matchVersion` bump refreshes **only** the color buffer,
  never the positions (a discrete event, exactly like the constellation redraw). Colors align with the
  constellation (matched = `#1DB954`, dimmed = `#6b645c` at low alpha);
- small `getRadius` + low `opacity` so dense areas emerge through **alpha accumulation** (points only, no heatmap);
- `pickable: true`, `onHover` → `mapPoints[index].metadata` → `formatTooltip` → a Svelte tooltip `<div>`.

`$effect`s: new upload (`data` identity change) → rebuild buffers + refit; `matchVersion` change → refresh the
color buffer; `width`/`height` change → `map.resize()`. All guarded on the map existing (libs load async);
`onDestroy` calls `map.remove()`.

## Step 3 — Wire into the Explorer (`explore/+page.svelte`)

The constellation `<article>` stays fixed. The right `<aside>` gains a `.measure-toggle` segmented control
("Sunburst" / "Map") driving `spatialView` state; inside the sized host it conditionally renders `LocationMap`
(mounts only when `spatialView === 'map'`, so the heavy chunk loads on first toggle) or the unchanged
`SunburstExplorer`. The map gets `formatTooltip={constellationTooltip}`, **reusing** the page's existing
`constellationTooltip`/`geoLine`. Sunburst-owned geo cross-filtering is unaffected: filters it set persist in
`googleMapsExplorerFilters` while the map is shown, and the map reflects them via `matched`/`matchVersion`.

## Invariants (PRD §9)

- **No egress of user data:** coordinates never leave the browser. The only new network flow is basemap **tiles**
  (which reveal the *viewport*, not the data) + the libraries' code — a documented nuance, removable later via
  self-hosted Protomaps `.pmtiles`. `stores.test.ts` (no-persistence) is untouched — the map adds no storage.
- **No persistence.**

## Out of scope (later phases, PRD §11)

Coloring by dimension (Phase 2); cross-filter *from* the map via picking; trajectories (need a `path_id` at parse
time); dedicated heatmap layer; self-hosted tiles (Phase 3). The deck.gl choice keeps all of these local — no rework.

## State: implemented

- `npm run check` clean; `locationMapData.test.ts` green (6 tests); `npm run build` succeeds.
- Build confirms the lazy split: `maplibre`/`deck` land in dedicated chunks referenced **only** via a dynamic
  `import()` from the google-maps explore page node — absent from the main and Spotify bundles.
- **Visual pass = manual** (WebGL is unavailable in jsdom, so no automated component test): `npm run dev` →
  `/google-maps/explore` → upload a Timeline export → toggle the slot to **Map**; verify points appear and
  `fitBounds` frames them, pan/zoom is fluid, hover shows the tooltip, selecting a pie value / brushing the
  constellation dims non-matching points, and toggling back to **Sunburst** restores it unchanged.
