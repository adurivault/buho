<script lang="ts">
    import { onMount, onDestroy } from "svelte";
    import type { Map as MaplibreMap, IControl } from "maplibre-gl";
    import type { MapboxOverlay } from "@deck.gl/mapbox";
    import type { LocationBasePoint } from "$lib/data/queries/googleMapsQueries";
    import {
        buildPositions,
        computeBounds,
    } from "$lib/visualizations/locationMapData";

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
        formatTooltip?: (metadata: Record<string, unknown>) => TooltipInfo;
    }

    let {
        data = [],
        matchVersion = 0,
        width = 0,
        height = 0,
        formatTooltip,
    }: Props = $props();

    const STYLE_URL = "https://tiles.openfreemap.org/styles/dark";
    // Aligned with the constellation: matched = its green (#1DB954), non-matched
    // = its grey (#6b645c) at low alpha (cf. ConstellationChart color constants).
    const MATCHED_RGBA: [number, number, number, number] = [29, 185, 84, 200];
    const DIMMED_RGBA: [number, number, number, number] = [107, 100, 92, 70];

    let container: HTMLDivElement | null = null;
    let map: MaplibreMap | null = null;
    let overlay: MapboxOverlay | null = null;
    // Constructor captured from the lazy import; typed loosely to avoid pulling
    // deck.gl generics into the component.
    let ScatterplotLayerCtor: (new (props: unknown) => unknown) | null = null;

    // Derived buffers, rebuilt once per upload (never on highlight change).
    let positions: Float32Array = new Float32Array(0);
    let mapPoints: LocationBasePoint[] = [];
    let prevData: LocationBasePoint[] | null = null;

    let destroyed = false;
    let ready = $state(false);

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
    }

    function makeLayer(): unknown {
        if (!ScatterplotLayerCtor) return null;
        return new ScatterplotLayerCtor({
            id: "location-points",
            // Non-iterable data: the position buffer is a binary attribute (must
            // live under `data.attributes`), and the color accessor resolves by
            // `index` against our arrays.
            data: {
                length: mapPoints.length,
                attributes: {
                    getPosition: { value: positions, size: 2 },
                },
            },
            getFillColor: (_: unknown, info: { index: number }) =>
                mapPoints[info.index]?.matched ? MATCHED_RGBA : DIMMED_RGBA,
            // Bumping matchVersion refreshes only the color buffer, not positions.
            updateTriggers: { getFillColor: matchVersion },
            radiusUnits: "pixels",
            getRadius: 2,
            radiusMinPixels: 1,
            // Low alpha: dense areas emerge through accumulation (points only).
            opacity: 0.35,
            pickable: true,
            onHover: (info: { index: number; x: number; y: number }) => {
                const p = info.index >= 0 ? mapPoints[info.index] : undefined;
                if (!p) {
                    if (tooltip.visible) tooltip = { ...tooltip, visible: false };
                    return;
                }
                tooltip = {
                    visible: true,
                    x: info.x,
                    y: info.y,
                    meta: p.metadata,
                };
            },
        });
    }

    function refreshLayer() {
        overlay?.setProps({ layers: [makeLayer() as never] });
    }

    function fit() {
        const b = computeBounds(data);
        if (b && map) map.fitBounds(b, { padding: 24, animate: false });
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
            rebuild();
            prevData = data;

            map = new maplibre.Map({ container, style: STYLE_URL });
            overlay = new deckMapbox.MapboxOverlay({
                interleaved: false,
                layers: [makeLayer() as never],
            });
            // deck's overlay implements maplibre's control interface.
            map.addControl(overlay as unknown as IControl);
            map.on("load", fit);
            ready = true;
        })();
    });

    onDestroy(() => {
        destroyed = true;
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

    // Highlight change (same data ref) → refresh the color buffer only.
    $effect(() => {
        void matchVersion;
        if (ready) refreshLayer();
    });

    // Slot resize → let maplibre re-read the container size.
    $effect(() => {
        void width;
        void height;
        map?.resize();
    });
</script>

<div class="location-map" bind:this={container}>
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
