<script lang="ts">
    import { onMount, onDestroy } from "svelte";
    import type { Map as MaplibreMap, IControl } from "maplibre-gl";
    import type { MapboxOverlay } from "@deck.gl/mapbox";
    import type { LocationBasePoint } from "$lib/data/queries/googleMapsQueries";
    import {
        buildPositions,
        computeBounds,
        type MapBounds,
    } from "$lib/visualizations/locationMapData";
    import { toMinimalStyle } from "$lib/visualizations/minimalMapStyle";
    import { themeStore, type Theme } from "$lib/stores/themeStore.svelte";

    /** Tooltip content for a hovered point, built by the caller from metadata. */
    interface TooltipInfo {
        title?: string;
        lines?: string[];
        hint?: string;
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
        // Opt in to the theme-aware minimalised basemap (no labels/buildings,
        // simplified streets). Off by default: the map keeps the original fixed
        // dark style.
        minimalStyle?: boolean;
        formatTooltip?: (metadata: Record<string, unknown>) => TooltipInfo;
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
    }: Props = $props();

    // Original basemap, used unless `minimalStyle` is enabled.
    const STYLE_URL = "https://tiles.openfreemap.org/styles/dark";

    // Base tiles per theme; the fetched style is stripped to a minimal variant
    // (no labels, no buildings, simplified high-contrast streets).
    const BASE: Record<Theme, { url: string; road: string }> = {
        dark: {
            url: "https://tiles.openfreemap.org/styles/dark",
            road: "#8b95a9",
        },
        light: {
            url: "https://tiles.openfreemap.org/styles/positron",
            road: "#4d5666",
        },
    };

    async function loadStyle(theme: Theme): Promise<string | object> {
        if (!minimalStyle) return STYLE_URL;
        const b = BASE[theme];
        try {
            const raw = await (await fetch(b.url)).json();
            return toMinimalStyle(raw, { roadColor: b.road });
        } catch {
            return b.url;
        }
    }

    // Aligned with the constellation: matched = the Google Maps red (#EA4335),
    // non-matched = its grey (#6b645c) at low alpha (cf. ConstellationChart).
    const MATCHED_RGBA: [number, number, number, number] = [234, 67, 53, 200];
    const DIMMED_RGBA: [number, number, number, number] = [107, 100, 92, 70];
    const TRANSPARENT: [number, number, number, number] = [0, 0, 0, 0];

    // Trail: red segments between consecutive active points in chronological
    // order. It follows the dimension filters + time/hour brush; a segment is drawn
    // only when at least one of its endpoints is inside the current viewport, so an
    // out-and-back excursion is shown truthfully while segments that would merely
    // cut straight across the view (both ends off-screen) are dropped.
    const PATH_RGBA: [number, number, number, number] = [234, 67, 53, 140];

    // Chronological instant (ms) of a point: midnight epoch + fractional hour.
    const instant = (p: LocationBasePoint) => p.x + p.y * 3_600_000;

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
        tooltip.visible && tooltip.meta && formatTooltip
            ? formatTooltip(tooltip.meta)
            : null,
    );

    function rebuild() {
        const built = buildPositions(data);
        positions = built.positions;
        mapPoints = built.mapPoints;
        // mapPoints keeps the source (day-ASC) order; sort an index by full
        // instant so the trail connects points chronologically without a per-frame sort.
        orderByTime = mapPoints.map((_, i) => i);
        orderByTime.sort((a, b) => instant(mapPoints[a]) - instant(mapPoints[b]));
    }

    /** True when `p` is inside the brush windows (time + hour). */
    function inBrush(p: LocationBasePoint): boolean {
        if (timeWindow && (p.x < timeWindow[0] || p.x > timeWindow[1]))
            return false;
        if (hourWindow && (p.y < hourWindow[0] || p.y > hourWindow[1]))
            return false;
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
            const cur: [number, number] = [
                p.metadata.lon as number,
                p.metadata.lat as number,
            ];
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
            id: "location-paths",
            data: buildTrailSegments(),
            getSourcePosition: (d: { s: [number, number] }) => d.s,
            getTargetPosition: (d: { t: [number, number] }) => d.t,
            getColor: PATH_RGBA,
            getWidth: 1.4,
            widthUnits: "pixels",
            widthMinPixels: 1,
        });
    }

    function onHover(info: { index: number; x: number; y: number }) {
        const p = info.index >= 0 ? mapPoints[info.index] : undefined;
        if (!p) {
            if (tooltip.visible) tooltip = { ...tooltip, visible: false };
            return;
        }
        tooltip = { visible: true, x: info.x, y: info.y, meta: p.metadata };
    }

    // Two stacked layers over the SAME position buffer so active points always
    // paint over the grey ones (deck.gl draws later layers on top; a single layer
    // draws in index order and would let grey cover green). Each layer renders
    // only its subset — the other subset is fully transparent.
    function makeLayer(pass: "dimmed" | "active"): unknown {
        if (!ScatterplotLayerCtor) return null;
        const active = pass === "active";
        return new ScatterplotLayerCtor({
            id: `location-points-${pass}`,
            // Non-iterable data: the position buffer is a binary attribute (must
            // live under `data.attributes`), and the color accessor resolves by
            // `index` against our arrays.
            data: {
                length: mapPoints.length,
                attributes: {
                    getPosition: { value: positions, size: 2 },
                },
            },
            getFillColor: (_: unknown, info: { index: number }) => {
                const on = isActive(mapPoints[info.index]);
                if (active) return on ? MATCHED_RGBA : TRANSPARENT;
                return on ? TRANSPARENT : DIMMED_RGBA;
            },
            // Refresh the color buffer (positions untouched) on highlight or
            // brush-window change.
            updateTriggers: {
                getFillColor: [
                    matchVersion,
                    timeWindow?.[0],
                    timeWindow?.[1],
                    hourWindow?.[0],
                    hourWindow?.[1],
                ],
            },
            radiusUnits: "pixels",
            getRadius: 2,
            radiusMinPixels: 1,
            // Low alpha: dense areas emerge through accumulation (points only).
            opacity: 0.35,
            // One pickable layer is enough (both share positions); picking works
            // on geometry regardless of a point's alpha.
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
        arr.push(makeLayer("dimmed"), makeLayer("active"));
        return arr;
    }

    function refreshLayer() {
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
                import("maplibre-gl"),
                import("@deck.gl/mapbox"),
                import("@deck.gl/layers"),
            ]);
            await import("maplibre-gl/dist/maplibre-gl.css");
            if (destroyed || !container) return;

            ScatterplotLayerCtor =
                deckLayers.ScatterplotLayer as unknown as new (
                    props: unknown,
                ) => unknown;
            LineLayerCtor = deckLayers.LineLayer as unknown as new (
                props: unknown,
            ) => unknown;
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
            map.on("load", fit);
            // Committed viewport only (on gesture end) → discrete geo filter.
            map.on("moveend", () => {
                emitViewport();
                // The trail keeps only segments touching the viewport, so it must
                // be rebuilt when the view moves (cheap; skipped when off).
                if (showPaths) scheduleRefresh();
            });
            ready = true;
        })();
    });

    onDestroy(() => {
        destroyed = true;
        if (refreshRaf) cancelAnimationFrame(refreshRaf);
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

    // Highlight, brush-window, or trail-toggle change (same data ref) → rebuild
    // the layers (color buffer + optional trail).
    $effect(() => {
        void matchVersion;
        void timeWindow;
        void hourWindow;
        void showPaths;
        if (ready) scheduleRefresh();
    });

    // Slot resize → let maplibre re-read the container size.
    $effect(() => {
        void width;
        void height;
        map?.resize();
    });

    // Follow the app's light/dark theme: reload the minimalised base style,
    // keeping the current camera and the deck overlay (a persistent control).
    $effect(() => {
        const theme = themeStore.theme;
        if (!minimalStyle || !ready || theme === appliedTheme) return;
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
        onclick={() => (showPaths = !showPaths)}
    >
        Connect points
    </button>
    {#if tooltipInfo}
        <div class="tooltip" style={`left:${tooltip.x}px; top:${tooltip.y}px;`}>
            {#if tooltipInfo.title}
                <strong>{tooltipInfo.title}</strong>
            {/if}
            {#each tooltipInfo.lines ?? [] as line}
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
        border-radius: 8px;
        overflow: hidden;
    }

    .trail-toggle {
        position: absolute;
        top: 8px;
        right: 8px;
        z-index: 3;
        padding: 0.28rem 0.6rem;
        border-radius: 999px;
        border: 1px solid hsl(var(--border));
        font-size: 0.72rem;
        color: hsl(var(--muted-foreground));
        background: color-mix(in srgb, hsl(var(--card)) 88%, transparent);
        cursor: pointer;
        backdrop-filter: blur(2px);
    }

    .trail-toggle:hover {
        color: hsl(var(--foreground));
    }

    .trail-toggle.active {
        border-color: #ea4335;
        color: #ea4335;
    }

    .tooltip {
        position: absolute;
        pointer-events: none;
        z-index: 3;
        display: flex;
        flex-direction: column;
        gap: 2px;
        max-width: 16rem;
        border-radius: 7px;
        border: 1px solid hsl(var(--border));
        padding: 0.42rem 0.52rem;
        font-size: 0.72rem;
        color: hsl(var(--foreground));
        background: color-mix(in srgb, hsl(var(--card)) 92%, black 8%);
    }

    .tooltip .hint {
        margin-top: 2px;
        font-size: 0.66rem;
        color: var(--accent-spotify, #1db954);
    }
</style>
