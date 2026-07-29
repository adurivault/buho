<script lang="ts">
    import { onMount, onDestroy } from "svelte";
    import type { MapBounds } from "$lib/visualizations/locationMapData";
    import {
        loadZoneGeometry,
        type ZoneGeometry,
    } from "$lib/data/geo/zoneGeometry";
    import {
        buildZoneRollup,
        depthForZoom,
        formatMetric,
        keyOfFeature,
        keyLabel,
        keyName,
        layoutLabels,
        makeColorScale,
        metricValue,
        unionBounds,
        DEPTH_LABELS,
        LAND_RGB,
        ZONE_METRICS,
        type Depth,
        type ZoneFeature,
        type ZoneMetric,
        type ZoneRollupRow,
    } from "$lib/visualizations/zoneChoropleth";
    import { trackControl } from "$lib/analytics";

    interface Props {
        rows: ZoneRollupRow[];
    }

    let { rows }: Props = $props();

    const TRACK_ID = "zone-choropleth";

    /**
     * No basemap, no tiles, no external request: the reference polygons *are* the
     * map. Land is white on a plain surface, and the only labels are the ones drawn
     * from our own zone names. Everything on screen comes out of
     * `geo_zones.topojson`, so the section is fully self-contained — which also
     * means the guide no longer talks to a tile server at all.
     */
    const LAND: [number, number, number] = LAND_RGB;
    const BORDER: [number, number, number, number] = [148, 163, 184, 170];
    const LABEL: [number, number, number] = [30, 41, 59];

    const MIN_ZOOM = 0.4;
    const MAX_ZOOM = 13;
    const LABEL_SIZE = 11;

    let container: HTMLDivElement | null = null;
    let deck: { setProps(p: unknown): void; finalize(): void } | null = null;
    let destroyed = false;
    let ready = $state(false);
    let geometry = $state.raw<ZoneGeometry | null>(null);
    let geometryFailed = $state(false);

    let width = $state(0);
    let height = $state(0);
    let depth = $state<Depth>(1);
    let metric = $state<ZoneMetric>("hours");
    let view = $state({ longitude: 5, latitude: 25, zoom: 1.2 });
    let tooltip = $state<{
        visible: boolean;
        x: number;
        y: number;
        key: string;
    }>({ visible: false, x: 0, y: 0, key: "" });

    const rollup = $derived(buildZoneRollup(rows));

    /**
     * Values for the current depth, restricted to zones that actually have a
     * polygon: a key with no geometry can neither be drawn nor stretch the scale.
     * The leftovers feed the caption, which is the only signal we would get if the
     * asset's place names ever drifted from the attributed ones.
     */
    const scale = $derived.by(() => {
        const aggs = rollup.byDepth[depth];
        const geo = geometry;
        if (!geo) return { color: makeColorScale([]), mapped: 0, unmapped: 0 };

        const drawable = geo.drawableByDepth[depth];
        const values: number[] = [];
        let unmapped = 0;
        for (const [key, agg] of aggs) {
            if (drawable.has(key)) values.push(metricValue(agg, metric));
            else unmapped++;
        }
        return { color: makeColorScale(values), mapped: values.length, unmapped };
    });

    function fillFor(feature: ZoneFeature): [number, number, number] {
        const key = keyOfFeature(feature, depth);
        if (key === "") return LAND;
        const agg = rollup.byDepth[depth].get(key);
        // A zone that exists in the reference but was never visited stays white.
        if (!agg) return LAND;
        return scale.color.fill(metricValue(agg, metric));
    }

    /**
     * Names for the zones that have data at the current depth, de-cluttered so they
     * never overlap. Only the visited ones: labelling all 4600 reference zones would
     * be unreadable, and the ones with no data have nothing to say — hovering still
     * names any zone, visited or not.
     */
    const labels = $derived.by(() => {
        const geo = geometry;
        if (!geo || !width || !height) return [];
        const anchors = geo.anchorsByDepth[depth];
        const candidates = [];
        for (const [key, agg] of rollup.byDepth[depth]) {
            const at = anchors.get(key);
            if (!at) continue;
            candidates.push({
                position: at,
                text: keyName(key),
                value: metricValue(agg, metric),
            });
        }
        return layoutLabels(
            candidates,
            { width, height, ...view },
            LABEL_SIZE,
        );
    });

    // Constructors captured from the lazy import; typed loosely to keep deck.gl's
    // types out of the bundle graph (cf. LocationMap / DayRaceMap).
    let GeoJsonLayerCtor: (new (props: unknown) => unknown) | null = null;
    let PathLayerCtor: (new (props: unknown) => unknown) | null = null;
    let TextLayerCtor: (new (props: unknown) => unknown) | null = null;
    let fitBoundsFn:
        | ((b: MapBounds) => { longitude: number; latitude: number; zoom: number } | null)
        | null = null;

    function layers(): unknown[] {
        const geo = geometry;
        if (!geo || !GeoJsonLayerCtor) return [];
        const out: unknown[] = [
            new GeoJsonLayerCtor({
                id: "zone-fill",
                data: geo.features,
                filled: true,
                stroked: false,
                pickable: true,
                getFillColor: fillFor,
                updateTriggers: { getFillColor: [depth, metric, rows] },
                onHover,
                onClick,
            }),
        ];
        if (PathLayerCtor) {
            // Only the boundaries of the level being read. Drawing every leaf edge
            // underneath turned the world view into a mesh of sub-regions, which is
            // the opposite of what this map is for.
            out.push(
                new PathLayerCtor({
                    id: "zone-borders",
                    data: geo.meshFor(depth),
                    getPath: (d: number[][]) => d,
                    getColor: BORDER,
                    widthUnits: "pixels",
                    getWidth: 1,
                    widthMinPixels: 1,
                    pickable: false,
                }),
            );
        }
        if (TextLayerCtor) {
            out.push(
                new TextLayerCtor({
                    id: "zone-labels",
                    data: labels,
                    getPosition: (d: { position: [number, number] }) => d.position,
                    getText: (d: { text: string }) => d.text,
                    getSize: LABEL_SIZE,
                    sizeUnits: "pixels",
                    getColor: LABEL,
                    // The default font atlas is ASCII only, which silently drops the
                    // accents from most French names ("Île-de-France" came out as
                    // "le-de-France"). 'auto' builds the atlas from the data.
                    characterSet: "auto",
                    getTextAnchor: "middle",
                    getAlignmentBaseline: "center",
                    pickable: false,
                }),
            );
        }
        return out;
    }

    // Layer rebuilds are coalesced into one animation frame: a depth change and a
    // pan can land together, and each rebuild re-uploads the fill buffer.
    let refreshRaf = 0;
    function scheduleRefresh() {
        if (refreshRaf || destroyed) return;
        refreshRaf = requestAnimationFrame(() => {
            refreshRaf = 0;
            deck?.setProps({ layers: layers(), viewState: viewState() });
        });
    }

    function viewState() {
        return { ...view, minZoom: MIN_ZOOM, maxZoom: MAX_ZOOM, pitch: 0, bearing: 0 };
    }

    function onHover(info: { object?: ZoneFeature; x: number; y: number }) {
        const key = info.object ? keyOfFeature(info.object, depth) : "";
        if (key === "") {
            if (tooltip.visible) tooltip = { ...tooltip, visible: false };
            return;
        }
        tooltip = { visible: true, x: info.x, y: info.y, key };
    }

    const tooltipLines = $derived.by(() => {
        if (!tooltip.visible || tooltip.key === "") return null;
        const agg = rollup.byDepth[depth].get(tooltip.key);
        if (!agg) return { title: keyName(tooltip.key), lines: ["No time recorded"] };
        const total = rollup.total;
        const share =
            total && total.hours > 0
                ? `${((agg.hours / total.hours) * 100).toFixed(1)}% of your time`
                : null;
        return {
            title: keyName(tooltip.key),
            crumb: keyLabel(tooltip.key),
            lines: [
                `${formatMetric(agg.hours, "hours")} · ${formatMetric(agg.km, "km")}`,
                `${formatMetric(agg.points, "points")} points`,
                ...(share ? [share] : []),
            ],
        };
    });

    function flyTo(bounds: MapBounds) {
        const next = fitBoundsFn?.(bounds);
        if (!next) return;
        view = next;
        syncDepth();
        scheduleRefresh();
    }

    function onClick(info: { object?: ZoneFeature }) {
        const geo = geometry;
        if (!geo || !info.object) return;
        const key = keyOfFeature(info.object, depth);
        const bounds = key === "" ? null : geo.boundsByDepth[depth].get(key);
        if (!bounds) return;
        trackControl(TRACK_ID, "zone-click", keyName(key));
        // Zooming in crosses a break, so the drill-down happens by itself.
        flyTo(bounds);
    }

    /** Frames every zone the user has actually been to at the current depth. */
    function visitedBounds(): MapBounds | null {
        const geo = geometry;
        if (!geo) return null;
        const boxes: MapBounds[] = [];
        for (const key of rollup.byDepth[depth].keys()) {
            const b = geo.boundsByDepth[depth].get(key);
            if (b) boxes.push(b);
        }
        return unionBounds(boxes);
    }

    function resetView() {
        const b = visitedBounds();
        if (!b) return;
        trackControl(TRACK_ID, "reset-view", "");
        flyTo(b);
    }

    function zoomBy(delta: number) {
        view = {
            ...view,
            zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, view.zoom + delta)),
        };
        syncDepth();
        scheduleRefresh();
    }

    function syncDepth() {
        const next = depthForZoom(view.zoom, depth);
        if (next === depth) return;
        depth = next;
        trackControl(TRACK_ID, "depth", next);
    }

    onMount(() => {
        void (async () => {
            const [deckCore, deckLayers, geo] = await Promise.all([
                import("@deck.gl/core"),
                import("@deck.gl/layers"),
                loadZoneGeometry(),
            ]);
            if (destroyed || !container) return;

            if (!geo) {
                geometryFailed = true;
                return;
            }
            GeoJsonLayerCtor = deckLayers.GeoJsonLayer as unknown as new (
                p: unknown,
            ) => unknown;
            PathLayerCtor = deckLayers.PathLayer as unknown as new (
                p: unknown,
            ) => unknown;
            TextLayerCtor = deckLayers.TextLayer as unknown as new (
                p: unknown,
            ) => unknown;

            const Viewport = deckCore.WebMercatorViewport as unknown as new (o: {
                width: number;
                height: number;
            }) => {
                fitBounds(
                    b: [[number, number], [number, number]],
                    o: { padding: number },
                ): { longitude: number; latitude: number; zoom: number };
            };
            fitBoundsFn = (b) => {
                if (!width || !height) return null;
                try {
                    const vp = new Viewport({ width, height });
                    const { longitude, latitude, zoom } = vp.fitBounds(b, { padding: 32 });
                    return {
                        longitude,
                        latitude,
                        zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom)),
                    };
                } catch {
                    return null;
                }
            };

            geometry = geo;

            const Deck = deckCore.Deck as unknown as new (p: unknown) => {
                setProps(p: unknown): void;
                finalize(): void;
            };
            deck = new Deck({
                parent: container,
                // Transparent: the page background is the sea.
                style: { position: "absolute", inset: "0" },
                useDevicePixels: true,
                controller: { dragRotate: false, touchRotate: false },
                viewState: viewState(),
                onViewStateChange: ({
                    viewState: vs,
                }: {
                    viewState: { longitude: number; latitude: number; zoom: number };
                }) => {
                    view = {
                        longitude: vs.longitude,
                        latitude: vs.latitude,
                        zoom: vs.zoom,
                    };
                    syncDepth();
                    scheduleRefresh();
                },
                layers: layers(),
            });

            const b = visitedBounds();
            if (b) flyTo(b);
            ready = true;
            scheduleRefresh();
        })();
    });

    onDestroy(() => {
        destroyed = true;
        if (refreshRaf) cancelAnimationFrame(refreshRaf);
        deck?.finalize();
        deck = null;
    });

    // Metric / data change → recolour, keeping the camera. Labels follow the same
    // rebuild, and the zoom-driven depth is handled in onViewStateChange.
    $effect(() => {
        void metric;
        void rows;
        void depth;
        if (!ready) return;
        scheduleRefresh();
    });

    // The canvas has no intrinsic size, so a resize has to be pushed to deck.
    $effect(() => {
        void width;
        void height;
        if (ready) scheduleRefresh();
    });

    const LEGEND_TICKS = 5;

    // A continuous bar rather than swatches: the scale itself is continuous, so
    // discrete blocks would imply thresholds the data does not have. Ticks are
    // log-spaced, matching the scale, so each is the same multiple of the last.
    const legendGradient = $derived(
        `linear-gradient(to right, ${scale.color.samples(12).join(", ")})`,
    );
    const legendTicks = $derived(
        scale.color.ticks(LEGEND_TICKS).map((v) => formatMetric(v, metric)),
    );
</script>

<div class="choropleth">
    <div class="controls">
        <div class="metrics" role="group" aria-label="Measure">
            {#each ZONE_METRICS as m (m.key)}
                <button
                    type="button"
                    class="zone-btn"
                    class:active={metric === m.key}
                    onclick={() => {
                        trackControl(TRACK_ID, "metric", m.key);
                        metric = m.key;
                    }}
                >
                    {m.label}
                </button>
            {/each}
        </div>
        <span class="level">{DEPTH_LABELS[depth]}</span>
        <div class="spacer"></div>
        <button type="button" class="zone-btn" onclick={resetView}>
            Reset view
        </button>
    </div>

    <div
        class="map-shell"
        bind:clientWidth={width}
        bind:clientHeight={height}
        role="application"
        aria-label="Map of time spent per zone"
    >
        <div class="map" bind:this={container}></div>

        <div class="zoom">
            <button type="button" onclick={() => zoomBy(1)} aria-label="Zoom in">
                +
            </button>
            <button type="button" onclick={() => zoomBy(-1)} aria-label="Zoom out">
                −
            </button>
        </div>

        {#if !ready && !geometryFailed}
            <p class="overlay-note" role="status">Loading map geometry…</p>
        {:else if geometryFailed}
            <p class="overlay-note" role="status">Map geometry unavailable.</p>
        {/if}

        {#if tooltipLines}
            <div
                class="tooltip"
                style={`left:${tooltip.x}px; top:${tooltip.y}px;`}
            >
                <strong>{tooltipLines.title}</strong>
                {#if tooltipLines.crumb && tooltipLines.crumb !== tooltipLines.title}
                    <span class="crumb">{tooltipLines.crumb}</span>
                {/if}
                {#each tooltipLines.lines as line (line)}
                    <span>{line}</span>
                {/each}
            </div>
        {/if}
    </div>

    <div class="legend">
        <span class="legend-lbl">{DEPTH_LABELS[depth]} by {metric}</span>
        <span class="swatch none" title="Never been here"></span>
        <div class="ramp">
            <span class="ramp-bar" style={`background:${legendGradient};`}></span>
            <span class="ticks">
                {#each legendTicks as tick, i (i)}
                    <span class="tick">{tick}</span>
                {/each}
            </span>
        </div>
        <span class="legend-lbl">
            {scale.mapped.toLocaleString()} zones
            {#if scale.unmapped > 0}
                · {scale.unmapped.toLocaleString()} not on the map
            {/if}
        </span>
    </div>
</div>

<style>
    .choropleth {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
    }

    .controls {
        display: flex;
        align-items: center;
        gap: 0.6rem;
        flex-wrap: wrap;
    }

    .metrics {
        display: flex;
        gap: 0.3rem;
    }

    .spacer {
        flex: 1;
    }

    .level {
        font-size: 0.9rem;
        color: hsl(var(--foreground));
    }

    .zone-btn {
        border: 1px solid rgb(71 85 105 / 0.8);
        background: rgb(15 23 42 / 0.7);
        color: rgb(226 232 240 / 1);
        border-radius: 999px;
        padding: 0.3rem 0.7rem;
        font-size: 0.8rem;
        cursor: pointer;
    }

    .zone-btn.active {
        border-color: #ea4335;
        color: #ea4335;
    }

    .map-shell {
        position: relative;
        height: 660px;
        border-radius: 8px;
        overflow: hidden;
        border: 1px solid hsl(var(--border));
        /*
         * The sea. Deliberately the same light neutral in both themes: the land is
         * white either way, and with no halo behind the labels (they were harder to
         * read with one) dark ink needs a light surface to sit on. So the map reads
         * as a sheet of paper rather than following the page.
         */
        background: #e9eaec;
    }

    .map {
        position: absolute;
        inset: 0;
    }

    .zoom {
        position: absolute;
        top: 8px;
        right: 8px;
        z-index: 3;
        display: flex;
        flex-direction: column;
        gap: 2px;
    }

    .zoom button {
        width: 26px;
        height: 26px;
        border: 1px solid hsl(var(--border));
        background: color-mix(in srgb, hsl(var(--card)) 88%, transparent);
        color: hsl(var(--foreground));
        font-size: 0.95rem;
        line-height: 1;
        cursor: pointer;
    }

    .zoom button:first-child {
        border-radius: 5px 5px 0 0;
    }

    .zoom button:last-child {
        border-radius: 0 0 5px 5px;
    }

    .overlay-note {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        margin: 0;
        font-size: 0.85rem;
        color: hsl(var(--muted-foreground));
        pointer-events: none;
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

    .tooltip .crumb {
        font-size: 0.66rem;
        color: hsl(var(--muted-foreground));
    }

    .legend {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        flex-wrap: wrap;
    }

    .legend-lbl {
        font-size: 0.72rem;
        color: hsl(var(--muted-foreground));
    }

    .ramp {
        display: flex;
        flex-direction: column;
        gap: 3px;
        min-width: 14rem;
        flex: 1;
        max-width: 26rem;
    }

    .ramp-bar {
        display: block;
        height: 9px;
        border-radius: 2px;
        border: 1px solid hsl(var(--border));
    }

    .ticks {
        display: flex;
        justify-content: space-between;
    }

    /* "Never been here" is the plain white land, not the bottom of the ramp. */
    .swatch.none {
        display: block;
        width: 1.2rem;
        height: 9px;
        border-radius: 2px;
        border: 1px solid hsl(var(--border));
        background: #fff;
    }

    .tick {
        font-size: 0.62rem;
        color: hsl(var(--muted-foreground));
        font-variant-numeric: tabular-nums;
    }
</style>
