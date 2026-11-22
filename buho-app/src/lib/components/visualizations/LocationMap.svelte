<script lang="ts">
    import { onMount, onDestroy } from 'svelte';
    import type { Map as MaplibreMap, IControl } from 'maplibre-gl';
    import type { MapboxOverlay } from '@deck.gl/mapbox';
    import { loadMaplibre } from '#lib/visualizations/maplibre.ts';
    import type { LocationBasePoint } from '#lib/data/queries/positionsQueries.ts';
    import {
        LOD_LEVELS,
        LOD_MIN_POINTS,
        buildPositions,
        cellIndex,
        computeBounds,
        lodLevel,
        representatives,
        type CellIndex,
        type MapBounds,
        type Representatives,
    } from '#lib/visualizations/locationMapData.ts';
    import { toMinimalStyle } from '#lib/visualizations/minimalMapStyle.ts';
    import { otherColor } from '#lib/utils/dimensionColors.ts';
    import { themeStore, type Theme } from '#lib/stores/themeStore.svelte.ts';
    import { hexToRgb, peakColor } from '#lib/visualizations/themeColors.ts';
    import { trackControl } from '#lib/analytics.ts';

    /** Tooltip content for a hovered point, built by the caller from metadata. */
    interface TooltipInfo {
        title?: string;
        lines?: string[];
        hint?: string;
    }

    interface ColorCategory {
        value: string;
        color: string;
    }

    interface Props {
        // Same reactive array + counter as the constellation (shared highlight):
        // `data` reference changes only on a new upload; `matchVersion` is bumped
        // in place when the caller mutates `matched` (cf. explore/+page.svelte).
        data: LocationBasePoint[];
        matchVersion?: number;
        width: number;
        height: number;
        // Brush windows from the constellation (point.x = day epoch, y = hour).
        // Points outside them are dimmed, so the map reflects the time/hour brush.
        timeWindow?: [number, number] | null;
        hourWindow?: [number, number] | null;
        // Emits the committed viewport box on pan/zoom end (map → constellation).
        onViewportChange?: (bounds: MapBounds) => void;
        // Opt in to the minimalised basemap (no labels/buildings, simplified
        // streets). Off by default: the theme's basemap in full. Either way it
        // follows the light/dark theme.
        minimalStyle?: boolean;
        formatTooltip?: (metadata: Record<string, unknown>) => TooltipInfo;
        // Coloring by dimension, aligned with the constellation: `colorField` is a
        // raw field carried by each point (e.g. "fSegmentType"), `colorCategories`
        // maps its values to colors. When both are set, active points are painted
        // by their dimension value instead of the uniform matched red.
        colorField?: string | null;
        colorCategories?: ColorCategory[];
    }

    let {
        data = [],
        matchVersion = 0,
        width = 0,
        height = 0,
        timeWindow = null,
        hourWindow = null,
        onViewportChange,
        minimalStyle = false,
        formatTooltip,
        colorField = null,
        colorCategories = [],
    }: Props = $props();

    // Base tiles per theme. With `minimalStyle`, the fetched style is stripped
    // to a minimal variant (no labels, no buildings, simplified high-contrast
    // streets).
    const BASE: Record<Theme, { url: string; road: string }> = {
        dark: {
            url: 'https://tiles.openfreemap.org/styles/dark',
            road: '#8b95a9',
        },
        light: {
            url: 'https://tiles.openfreemap.org/styles/positron',
            road: '#4d5666',
        },
    };

    async function loadStyle(theme: Theme): Promise<string | object> {
        const b = BASE[theme];
        if (!minimalStyle) return b.url;
        try {
            const raw = await (await fetch(b.url)).json();
            return toMinimalStyle(raw, { roadColor: b.road });
        } catch {
            return b.url;
        }
    }

    // Aligned with the constellation: matched = the positions peak, read off
    // the theme at each rebuild (deck.gl takes numbers, not var()); non-matched =
    // a warm grey (#6b645c) at low alpha (cf. ConstellationChart).
    const accentRgba = (alpha: number): [number, number, number, number] => [
        ...hexToRgb(peakColor('positions')),
        alpha,
    ];
    const DIMMED_RGBA: [number, number, number, number] = [107, 100, 92, 70];

    // Trail, drawn in the accent at lower alpha: segments between consecutive active points in chronological
    // order. It follows the dimension filters + time/hour brush; a segment is drawn
    // only when at least one of its endpoints is inside the current viewport, so an
    // out-and-back excursion is shown truthfully while segments that would merely
    // cut straight across the view (both ends off-screen) are dropped.

    // Chronological instant (ms) of a point: midnight epoch + fractional hour.
    const instant = (p: LocationBasePoint) => p.x + p.y * 3_600_000;

    // --- Coloring by dimension -------------------------------------------
    const colorActive = $derived(!!colorField && colorCategories.length > 0);
    // value → rgba tuple (matched-point alpha), built once per category change.
    const colorRgbaMap = $derived.by(() => {
        const m = new Map<string, [number, number, number, number]>();
        for (const c of colorCategories) m.set(c.value, hexToRgba(c.color));
        return m;
    });

    /** "#RRGGBB" → deck.gl rgba tuple at the matched-point alpha (200). */
    function hexToRgba(hex: string): [number, number, number, number] {
        const h = hex.replace('#', '');
        return [
            parseInt(h.slice(0, 2), 16),
            parseInt(h.slice(2, 4), 16),
            parseInt(h.slice(4, 6), 16),
            200,
        ];
    }

    /** Fill for an active point: its dimension color when coloring, else red. */
    function activeColor(p: LocationBasePoint): [number, number, number, number] {
        if (!colorActive || !colorField) return accentRgba(200);
        const v = (p as unknown as Record<string, unknown>)[colorField] as string | undefined;
        return colorRgbaMap.get(v ?? '') ?? hexToRgba(otherColor());
    }

    let container: HTMLDivElement | null = null;
    let map: MaplibreMap | null = null;
    let overlay: MapboxOverlay | null = null;
    // Theme currently applied to the basemap + guard against stale async reloads.
    let appliedTheme: Theme | null = null;
    let styleSeq = 0;
    // Constructors captured from the lazy import; typed loosely to avoid pulling
    // deck.gl generics into the component.
    let ScatterplotLayerCtor: (new (props: unknown) => unknown) | null = null;
    let LineLayerCtor: (new (props: unknown) => unknown) | null = null;

    // Derived buffers, rebuilt once per upload (never on highlight change).
    let positions: Float32Array = new Float32Array(0);
    let mapPoints: LocationBasePoint[] = [];
    // Indices into mapPoints sorted by chronological instant (for the trail).
    let orderByTime: number[] = [];
    let prevData: LocationBasePoint[] | null = null;
    // Level of detail: cell ids per level (built on first use, per upload), the
    // level currently drawn (null = every point), and the points standing in
    // for the rest at that level.
    let lodCells = new Map<number, CellIndex>();
    let drawnLevel: number | null = null;
    let drawn: Representatives = { dimmed: new Uint32Array(0), active: new Uint32Array(0) };

    let destroyed = false;
    let ready = $state(false);
    // Connect the active points into a chronological trail (toggle on the map).
    let showPaths = $state(false);

    let tooltip = $state({
        visible: false,
        x: 0,
        y: 0,
        meta: null as Record<string, unknown> | null,
    });
    const tooltipInfo = $derived(
        tooltip.visible && tooltip.meta && formatTooltip ? formatTooltip(tooltip.meta) : null
    );

    function rebuild() {
        const built = buildPositions(data);
        positions = built.positions;
        mapPoints = built.mapPoints;
        // mapPoints keeps the source (day-ASC) order; sort an index by full
        // instant so the trail connects points chronologically without a per-frame sort.
        orderByTime = mapPoints.map((_, i) => i);
        orderByTime.sort((a, b) => instant(mapPoints[a]) - instant(mapPoints[b]));
        lodCells = new Map();
        warmLevels();
    }

    // Build every level's cells in idle time after an upload, one per slice, so
    // a zoom gesture never pays for one the first time it crosses into it.
    let warmHandle = 0;
    function warmLevels() {
        cancelWarm();
        if (mapPoints.length < LOD_MIN_POINTS) return;
        const cells = lodCells;
        const pending = [...LOD_LEVELS];
        const step = () => {
            warmHandle = 0;
            if (destroyed || cells !== lodCells) return;
            const level = pending.shift();
            if (level === undefined) return;
            if (!cells.has(level)) cells.set(level, cellIndex(positions, level));
            warmHandle = idle(step);
        };
        warmHandle = idle(step);
    }

    // requestIdleCallback where it exists (not Safari), a timeout otherwise.
    const idle = (fn: () => void): number =>
        typeof requestIdleCallback === 'function'
            ? requestIdleCallback(fn, { timeout: 2000 })
            : window.setTimeout(fn, 50);
    function cancelWarm() {
        if (!warmHandle) return;
        if (typeof cancelIdleCallback === 'function') cancelIdleCallback(warmHandle);
        else clearTimeout(warmHandle);
        warmHandle = 0;
    }

    /** The detail level for the current zoom, or null to draw every point. */
    function currentLevel(): number | null {
        if (!map || mapPoints.length < LOD_MIN_POINTS) return null;
        return lodLevel(map.getZoom());
    }

    // Pick the points to draw at the current level, and pack them into the two
    // layers' buffers. O(N) over the points, run on a highlight, brush or color
    // change and when the zoom crosses into another level — never per frame.
    function selectDrawn() {
        drawnLevel = currentLevel();
        let cells: CellIndex | null = null;
        if (drawnLevel !== null) {
            cells = lodCells.get(drawnLevel) ?? cellIndex(positions, drawnLevel);
            lodCells.set(drawnLevel, cells);
        }
        drawn = representatives(mapPoints.length, (i) => isActive(mapPoints[i]), cells);
    }

    /** [lon, lat] of the given points, from the shared position buffer. */
    function gatherPositions(indices: Uint32Array): Float32Array {
        const out = new Float32Array(indices.length * 2);
        for (let k = 0; k < indices.length; k++) {
            out[k * 2] = positions[indices[k] * 2];
            out[k * 2 + 1] = positions[indices[k] * 2 + 1];
        }
        return out;
    }

    /** RGBA of the given active points, by dimension value or the uniform red. */
    function gatherActiveColors(indices: Uint32Array): Uint8Array {
        const out = new Uint8Array(indices.length * 4);
        for (let k = 0; k < indices.length; k++) out.set(activeColor(mapPoints[indices[k]]), k * 4);
        return out;
    }

    /** True when `p` is inside the brush windows (time + hour). */
    function inBrush(p: LocationBasePoint): boolean {
        if (timeWindow && (p.x < timeWindow[0] || p.x > timeWindow[1])) return false;
        if (hourWindow && (p.y < hourWindow[0] || p.y > hourWindow[1])) return false;
        return true;
    }

    /** A point is "active" (red) when matched and inside the brush windows. */
    function isActive(p: LocationBasePoint | undefined): boolean {
        return !!p && p.matched && inBrush(p);
    }

    // Trail membership: dimension filters + brush, but NOT the map's own geographic
    // viewport (`matched` folds the viewport box in; `matchedDims` does not), so the
    // trail spans excursions out of the current view and deck.gl clips them.
    function isTrailActive(p: LocationBasePoint | undefined): boolean {
        return !!p && p.matchedDims !== false && inBrush(p);
    }

    // Segments between consecutive trail-active points (time order), keeping only
    // those with at least one endpoint inside the current viewport.
    function buildTrailSegments(): {
        s: [number, number];
        t: [number, number];
    }[] {
        const b = map?.getBounds();
        if (!b) return [];
        const west = b.getWest();
        const south = b.getSouth();
        const east = b.getEast();
        const north = b.getNorth();
        const inView = (lon: number, lat: number) =>
            lon >= west && lon <= east && lat >= south && lat <= north;

        const segs: { s: [number, number]; t: [number, number] }[] = [];
        let prev: [number, number] | null = null;
        for (const idx of orderByTime) {
            const p = mapPoints[idx];
            if (!isTrailActive(p)) continue;
            const cur: [number, number] = [p.metadata.lon as number, p.metadata.lat as number];
            if (prev && (inView(prev[0], prev[1]) || inView(cur[0], cur[1]))) {
                segs.push({ s: prev, t: cur });
            }
            prev = cur;
        }
        return segs;
    }

    function makePathLayer(): unknown {
        if (!LineLayerCtor) return null;
        return new LineLayerCtor({
            id: 'location-paths',
            data: buildTrailSegments(),
            getSourcePosition: (d: { s: [number, number] }) => d.s,
            getTargetPosition: (d: { t: [number, number] }) => d.t,
            getColor: accentRgba(140),
            getWidth: 1.4,
            widthUnits: 'pixels',
            widthMinPixels: 1,
        });
    }

    function onHover(info: { index: number; x: number; y: number }) {
        // The picked index is into the active layer's drawn subset.
        const p = info.index >= 0 ? mapPoints[drawn.active[info.index]] : undefined;
        if (!p) {
            if (tooltip.visible) tooltip = { ...tooltip, visible: false };
            return;
        }
        tooltip = { visible: true, x: info.x, y: info.y, meta: p.metadata };
    }

    // Two stacked layers so active points always paint over the grey ones
    // (deck.gl draws later layers on top). Each layer carries only its own
    // subset, packed into binary buffers by `selectDrawn`: a transparent
    // instance still costs the GPU as much as a visible one.
    function makeLayer(pass: 'dimmed' | 'active'): unknown {
        if (!ScatterplotLayerCtor) return null;
        const active = pass === 'active';
        const indices = active ? drawn.active : drawn.dimmed;
        const attributes: Record<string, { value: ArrayBufferView; size: number }> = {
            getPosition: { value: gatherPositions(indices), size: 2 },
        };
        if (active && colorActive) {
            attributes.getFillColor = { value: gatherActiveColors(indices), size: 4 };
        }
        return new ScatterplotLayerCtor({
            id: `location-points-${pass}`,
            // Non-iterable data: binary attributes must live under `data.attributes`.
            data: { length: indices.length, attributes },
            getFillColor: active ? accentRgba(200) : DIMMED_RGBA,
            radiusUnits: 'pixels',
            getRadius: 2,
            radiusMinPixels: 1,
            // Low alpha: dense areas emerge through accumulation (points only).
            opacity: 0.35,
            // Only the active points carry a tooltip.
            pickable: active,
            onHover: active ? onHover : undefined,
        });
    }

    function layers(): unknown[] {
        const arr: unknown[] = [];
        // Trail first so the points paint over it (deck draws later layers on top).
        if (showPaths) {
            const pl = makePathLayer();
            if (pl) arr.push(pl);
        }
        arr.push(makeLayer('dimmed'), makeLayer('active'));
        return arr;
    }

    function refreshLayer() {
        selectDrawn();
        overlay?.setProps({ layers: layers() as never });
    }

    // Coalesce color-buffer refreshes to one per frame: brushing pushes new
    // windows continuously, but the recolor is O(N) so we cap it at 60 fps.
    let refreshRaf = 0;
    function scheduleRefresh() {
        if (refreshRaf) return;
        refreshRaf = requestAnimationFrame(() => {
            refreshRaf = 0;
            refreshLayer();
        });
    }

    function fit() {
        const b = computeBounds(data);
        if (b && map) map.fitBounds(b, { padding: 24, animate: false });
    }

    function emitViewport() {
        if (!map || !onViewportChange) return;
        const b = map.getBounds();
        onViewportChange([
            [b.getWest(), b.getSouth()],
            [b.getEast(), b.getNorth()],
        ]);
    }

    onMount(() => {
        void (async () => {
            const [maplibre, deckMapbox, deckLayers] = await Promise.all([
                loadMaplibre(),
                import('@deck.gl/mapbox'),
                import('@deck.gl/layers'),
            ]);
            if (destroyed || !container) return;

            ScatterplotLayerCtor = deckLayers.ScatterplotLayer as unknown as new (
                props: unknown
            ) => unknown;
            LineLayerCtor = deckLayers.LineLayer as unknown as new (props: unknown) => unknown;
            rebuild();
            prevData = data;

            const theme = themeStore.theme;
            const style = await loadStyle(theme);
            appliedTheme = theme;
            if (destroyed || !container) return;

            map = new maplibre.Map({ container, style: style as never });
            overlay = new deckMapbox.MapboxOverlay({
                interleaved: false,
                layers: layers() as never,
            });
            // deck's overlay implements maplibre's control interface.
            map.addControl(overlay as unknown as IControl);
            map.on('load', fit);
            // Committed viewport only (on gesture end) → discrete geo filter.
            map.on('moveend', () => {
                emitViewport();
                // The trail keeps only segments touching the viewport, so it must
                // be rebuilt when the view moves (cheap; skipped when off).
                if (showPaths) scheduleRefresh();
            });
            // Crossing into another detail level swaps the drawn subset — once
            // per level, mid-gesture, so zooming out never draws the full set.
            map.on('zoom', () => {
                if (currentLevel() !== drawnLevel) scheduleRefresh();
            });
            ready = true;
        })();
    });

    onDestroy(() => {
        destroyed = true;
        if (refreshRaf) cancelAnimationFrame(refreshRaf);
        cancelWarm();
        map?.remove();
        map = null;
        overlay = null;
    });

    // New upload → rebuild the buffers, re-render, refit the view.
    $effect(() => {
        const d = data;
        if (!ready || !map) return;
        if (d === prevData) return;
        prevData = d;
        rebuild();
        refreshLayer();
        fit();
    });

    // Highlight, brush-window, trail-toggle or theme change (same data ref) →
    // rebuild the layers (color buffer + optional trail).
    $effect(() => {
        void themeStore.theme;
        void matchVersion;
        void timeWindow;
        void hourWindow;
        void showPaths;
        void colorField;
        void colorCategories;
        if (ready) scheduleRefresh();
    });

    // Slot resize → let maplibre re-read the container size.
    $effect(() => {
        void width;
        void height;
        map?.resize();
    });

    // Follow the app's light/dark theme: reload the base style, keeping the
    // current camera and the deck overlay (a persistent control).
    $effect(() => {
        const theme = themeStore.theme;
        if (!ready || theme === appliedTheme) return;
        appliedTheme = theme;
        const seq = ++styleSeq;
        void (async () => {
            const style = await loadStyle(theme);
            if (destroyed || seq !== styleSeq || !map) return;
            map.setStyle(style as never);
        })();
    });
</script>

<div class="location-map" bind:this={container}>
    <button
        type="button"
        class="trail-toggle"
        class:active={showPaths}
        aria-pressed={showPaths}
        title="Connect points into a chronological trail"
        onclick={() => {
            trackControl('location-map', 'connect-points', !showPaths);
            showPaths = !showPaths;
        }}
    >
        Connect points
    </button>
    {#if tooltipInfo}
        <div class="chart-tooltip" style={`left:${tooltip.x}px; top:${tooltip.y}px;`}>
            {#if tooltipInfo.title}
                <strong>{tooltipInfo.title}</strong>
            {/if}
            {#each tooltipInfo.lines ?? [] as line, index (index)}
                <span>{line}</span>
            {/each}
            {#if tooltipInfo.hint}
                <span class="hint">{tooltipInfo.hint}</span>
            {/if}
        </div>
    {/if}
</div>

<style>
    .location-map {
        position: relative;
        width: 100%;
        height: 100%;
        border-radius: var(--radius-md);
        overflow: hidden;
    }

    .trail-toggle {
        position: absolute;
        top: 8px;
        right: 8px;
        z-index: 3;
        padding: 0.28rem 0.6rem;
        border-radius: var(--radius-pill);
        border: 1px solid hsl(var(--border));
        font-size: var(--text-label);
        color: hsl(var(--muted-foreground));
        background: color-mix(in srgb, hsl(var(--card)) 88%, transparent);
        cursor: pointer;
        backdrop-filter: blur(2px);
    }

    .trail-toggle:hover {
        color: hsl(var(--foreground));
    }

    .trail-toggle.active {
        border-color: var(--module-accent);
        color: var(--module-accent);
    }
</style>
