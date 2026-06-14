<script lang="ts">
    import * as Plot from "@observablehq/plot";
    import PlotChart from "$lib/components/PlotChart.svelte";
    import { spotifyExplorerFilters } from "$lib/stores/spotifyExplorerFilters.svelte";
    import type { DimensionAggregation } from "$lib/data/queries/dimensionQueries";
    import { formatDuration } from "$lib/utils/duration";

    type Props = {
        aggregations: DimensionAggregation[];
    };

    let { aggregations = [] }: Props = $props();

    const activeFilters = $derived(spotifyExplorerFilters.activeFilters);

    // Layout constants
    const BAR_COL_WIDTH = 27; // px per bar (regular dims)
    const COMPACT_BAR_WIDTH = 60; // px per bar (compact row — fewer bars)
    const CHART_HEIGHT = 160;
    const CHART_MARGIN_LEFT = 50;
    const CHART_MARGIN_RIGHT = 12;
    const CHART_MARGIN_TOP = 8;
    const CHART_MARGIN_BOTTOM = 8;

    const WEEKDAY_META: Record<number, { label: string; order: number }> = {
        1: { label: "Monday", order: 0 },
        2: { label: "Tuesday", order: 1 },
        3: { label: "Wednesday", order: 2 },
        4: { label: "Thursday", order: 3 },
        5: { label: "Friday", order: 4 },
        6: { label: "Saturday", order: 5 },
        0: { label: "Sunday", order: 6 },
        7: { label: "Sunday", order: 6 },
    };

    // Map dimension key → FilterState key
    const getFilterKey = (dim: string) => {
        const map: Record<string, string> = {
            artist: "artist_name",
            album: "album_name",
            track: "track_name",
            platform: "platform_clean",
            shuffle: "shuffle",
            skipped: "skipped",
            reason_start: "reason_start",
            reason_end: "reason_end",
            ip_address: "ip_addr",
            incognito_mode: "incognito_mode",
            media_type: "media_type",
            is_first_play: "is_first_play",
            country: "country",
            dayofweek: "dayofweek",
        };
        return map[dim] || dim;
    };

    // Group aggregations by dimension
    const groupedData = $derived.by(() => {
        const groups: Record<string, DimensionAggregation[]> = {};
        for (const row of aggregations) {
            if (!groups[row.dimension_name]) groups[row.dimension_name] = [];
            groups[row.dimension_name].push(row);
        }
        return groups;
    });

    // Regular dims — each gets its own scrollable chart
    const regularDims = [
        {
            key: "artist",
            title: "Top Artists",
            description:
                "Total listening time per artist. Click a bar to filter all charts (Shift+click to combine).",
        },
        {
            key: "album",
            title: "Top Albums",
            description: "Total listening time per album.",
        },
        {
            key: "track",
            title: "Top Tracks",
            description: "Total listening time per track.",
        },
        {
            key: "platform",
            title: "Platforms",
            description:
                "Device or app used for playback (iOS, Android, desktop, web…).",
        },
        {
            key: "media_type",
            title: "Music vs Podcasts",
            description: "Listening time split between music tracks and podcast episodes.",
        },
        {
            key: "reason_start",
            title: "Reason Start",
            description:
                "Why playback started: trackdone = previous track finished (autoplay), clickrow = you clicked the track, fwdbtn = next button, backbtn = previous button…",
        },
        {
            key: "reason_end",
            title: "Reason End",
            description:
                "Why playback ended: trackdone = played to the end, fwdbtn = skipped to the next track, endplay = playback stopped, logout…",
        },
        {
            key: "ip_address",
            title: "IP Address",
            description:
                "IP address recorded at playback time — changes with your network and location.",
        },
        {
            key: "country",
            title: "Country",
            description: "Country of your Spotify connection at playback time.",
        },
        {
            key: "dayofweek",
            title: "Day of Week",
            description: "Listening time per day of the week.",
        },
    ];

    // Compact dims — grouped in a 2-column grid (gauge bar style, no incognito)
    const compactDims = [
        {
            key: "is_first_play",
            title: "First Play",
            description:
                "Share of plays that were the very first time you ever played that track — your discoveries vs re-listens.",
        },
        {
            key: "skipped",
            title: "Skipped",
            description: "Share of plays you skipped before the track ended.",
        },
        {
            key: "shuffle",
            title: "Shuffle",
            description:
                "Share of plays in shuffle mode vs tracks you deliberately chose.",
        },
    ];

    // Toggle filter on click
    const toggleFilter = (
        dimension: string,
        itemValue: string,
        multi: boolean,
    ) => {
        const filterKey = getFilterKey(dimension);

        let realValue: any = itemValue;
        if (
            filterKey === "shuffle" ||
            filterKey === "skipped" ||
            filterKey === "incognito_mode" ||
            filterKey === "is_first_play"
        ) {
            realValue = itemValue === "True";
        } else if (filterKey === "dayofweek") {
            realValue = parseInt(itemValue, 10);
        }

        const current = activeFilters[filterKey];
        let selected = new Set<any>();

        if (current instanceof Set) {
            current.forEach((v) => selected.add(v));
        } else if (Array.isArray(current)) {
            current.forEach((v) => selected.add(v));
        } else if (current !== undefined && current !== null) {
            selected.add(current);
        }

        if (selected.has(realValue)) {
            selected.delete(realValue);
        } else {
            if (!multi) selected.clear();
            selected.add(realValue);
        }

        if (selected.size === 0) {
            spotifyExplorerFilters.removeFilter(filterKey);
        } else {
            spotifyExplorerFilters.setFilter(filterKey, Array.from(selected));
        }
    };

    // Click handler: read dimension value from hidden SVG <title>
    const handleChartClick = (e: MouseEvent, dimension: string) => {
        let node = e.target as Element | null;
        let itemValue: string | null = null;

        while (node && node !== e.currentTarget) {
            if (node.tagName === "rect") {
                const titleEl = node.querySelector("title");
                if (titleEl && titleEl.textContent?.startsWith("DATA:")) {
                    itemValue = titleEl.textContent.replace("DATA:", "");
                    break;
                }
            }
            node = node.parentElement;
        }

        if (itemValue !== null) {
            toggleFilter(dimension, itemValue, e.shiftKey);
        }
    };

    interface PlotDimensionRow extends DimensionAggregation {
        xLabel: string; // x-axis category label
        sortIndex: number;
    }

    // Raw media_type values are Spotify's internal names
    const MEDIA_TYPE_LABELS: Record<string, string> = {
        track: "Music",
        podcast: "Podcast",
    };

    function normalizePlotData(
        dimension: string,
        data: DimensionAggregation[],
    ): PlotDimensionRow[] {
        if (dimension === "media_type") {
            return data.map((row, index) => ({
                ...row,
                xLabel: MEDIA_TYPE_LABELS[row.item_value] ?? row.item_value,
                sortIndex: index,
            }));
        }

        if (dimension !== "dayofweek") {
            return data.map((row, index) => ({
                ...row,
                xLabel: row.item_value,
                sortIndex: index,
            }));
        }

        return data
            .map((row) => {
                const dayNumber = Number.parseInt(row.item_value, 10);
                const meta = WEEKDAY_META[dayNumber];
                return {
                    ...row,
                    xLabel: meta?.label ?? row.item_value,
                    sortIndex: meta?.order ?? 999,
                };
            })
            .sort((a, b) => a.sortIndex - b.sortIndex);
    }

    // Build the selected set for a given dimension, normalizing boolean casing
    function buildSelectedSet(dimension: string): Set<string> {
        const filterKey = getFilterKey(dimension);
        const currentSelection = activeFilters[filterKey];
        const selectedSet = new Set<string>();

        const normalize = (v: any) =>
            typeof v === "boolean" ? (v ? "True" : "False") : String(v);

        if (
            currentSelection instanceof Set ||
            Array.isArray(currentSelection)
        ) {
            currentSelection.forEach((v) => selectedSet.add(normalize(v)));
        } else if (
            currentSelection !== undefined &&
            currentSelection !== null
        ) {
            selectedSet.add(normalize(currentSelection));
        }

        return selectedSet;
    }

    // Chart spec builder for vertical bars (barY)
    // compact = true for media_type + booleans row (wider bars, labels visible at bottom)
    function mkChartFn(dimension: string, compact = false) {
        const selectedSet = buildSelectedSet(dimension);
        const hasExplicitSelection = selectedSet.size > 0;

        // Fixed width per bar — chart is wider than the container → container scrolls
        const colWidth = compact ? COMPACT_BAR_WIDTH : BAR_COL_WIDTH;

        return (plotData: DimensionAggregation[]) => {
            const normalized = normalizePlotData(dimension, plotData);
            const xDomain = normalized.map((d) => d.xLabel);
            // Fixed pixel width: never adapts to container — horizontal scroll handles overflow
            const chartWidth = Math.max(
                compact ? 200 : 300,
                normalized.length * colWidth +
                    CHART_MARGIN_LEFT +
                    CHART_MARGIN_RIGHT,
            );

            return Plot.plot({
                width: chartWidth,
                height: CHART_HEIGHT,
                marginLeft: CHART_MARGIN_LEFT,
                marginRight: CHART_MARGIN_RIGHT,
                marginTop: CHART_MARGIN_TOP,
                marginBottom: compact ? 36 : CHART_MARGIN_BOTTOM,
                x: {
                    label: null,
                    domain: xDomain,
                    // Hide x tick labels — labels are written inside bars vertically
                    tickFormat: () => "",
                },
                y: {
                    label: null,
                    grid: true,
                    tickFormat: (d: number) => formatDuration(d),
                },
                marks: [
                    Plot.barY(normalized, {
                        x: "xLabel",
                        y: "total_minutes",
                        fill: (d: PlotDimensionRow) =>
                            !hasExplicitSelection ||
                            selectedSet.has(String(d.item_value))
                                ? "var(--accent-spotify, #1db954)"
                                : "var(--muted, #444)",
                        fillOpacity: (d: PlotDimensionRow) =>
                            !hasExplicitSelection
                                ? 0.9
                                : selectedSet.has(String(d.item_value))
                                  ? 1
                                  : 0.3,
                        // Hidden title for click detection
                        title: (d: PlotDimensionRow) => `DATA:${d.item_value}`,
                    }),
                    // Vertical label inside each bar
                    Plot.text(normalized, {
                        x: "xLabel",
                        y: 0, // baseline — text rotated -90° goes upward from here
                        text: (d: PlotDimensionRow) => d.xLabel,
                        rotate: -90,
                        textAnchor: "start",
                        dx: 6, // small padding from bar bottom
                        fill: (d: PlotDimensionRow) =>
                            !hasExplicitSelection ||
                            selectedSet.has(String(d.item_value))
                                ? "rgba(0,0,0,0.8)"
                                : "rgba(255,255,255,0.4)",
                        fontSize: compact ? 12 : 11,
                        fontWeight: "600",
                    }),
                    // Interactive tooltip on hover
                    Plot.tip(
                        normalized,
                        Plot.pointerX({
                            x: "xLabel",
                            y: "total_minutes",
                            title: (d: PlotDimensionRow) =>
                                `${d.xLabel}\n${formatDuration(d.total_minutes)}`,
                        }),
                    ),
                ],
                style: {
                    background: "transparent",
                },
            });
        };
    }

    // Gauge bar builder for compact dims (shows ratio instead of absolute minutes)
    // Returns a function that produces an HTML div (no Observable Plot needed)
    function mkGaugeFn(dimension: string) {
        const selectedSet = buildSelectedSet(dimension);
        const hasSelection = selectedSet.size > 0;

        // Values sorted: positive/primary first (green), then secondary (muted)
        const primaryValues = ['True', 'track'];

        return (plotData: DimensionAggregation[]) => {
            const total = plotData.reduce((sum, d) => sum + d.total_minutes, 0);

            // Sort: primary values first
            const sorted = [...plotData].sort((a, b) => {
                const ai = primaryValues.indexOf(a.item_value);
                const bi = primaryValues.indexOf(b.item_value);
                return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
            });

            const container = document.createElement('div');
            container.className = 'gauge-container';
            container.setAttribute('role', 'group');

            const bar = document.createElement('div');
            bar.className = 'gauge-bar';

            for (const d of sorted) {
                const pct = total > 0 ? (d.total_minutes / total) * 100 : 0;
                const isSelected = !hasSelection || selectedSet.has(String(d.item_value));
                const isPrimary = primaryValues.includes(d.item_value);

                const seg = document.createElement('div');
                seg.className = [
                    'gauge-segment',
                    isPrimary ? 'gauge-primary' : 'gauge-secondary',
                    isSelected ? '' : 'gauge-dimmed',
                ].join(' ');
                seg.style.width = `${pct}%`;
                seg.setAttribute('title', `DATA:${d.item_value}`);
                seg.setAttribute('data-value', d.item_value);

                // Percentage label inside segment (hidden if too narrow)
                if (pct >= 12) {
                    const label = document.createElement('span');
                    label.className = 'gauge-seg-label';
                    label.textContent = `${Math.round(pct)}%`;
                    seg.appendChild(label);
                }

                seg.addEventListener('click', (e) => {
                    toggleFilter(dimension, d.item_value, (e as MouseEvent).shiftKey);
                });

                bar.appendChild(seg);
            }

            container.appendChild(bar);
            return container;
        };
    }
</script>

<div class="satellite-container">
    <!-- Compact dims: gauge bars in a 2-column grid -->
    {#if compactDims.some((c: { key: string }) => (groupedData[c.key] || []).length > 0)}
        <div class="boolean-row">
            {#each compactDims as conf}
                {#if (groupedData[conf.key] || []).length > 0}
                    {@const data = groupedData[conf.key]}
                    <div class="dimension-section boolean-chart">
                        <h3>
                            {conf.title}<span
                                class="info-hint"
                                title={conf.description}>ⓘ</span
                            >
                        </h3>
                        <PlotChart plotFn={mkGaugeFn(conf.key)} {data} />
                    </div>
                {/if}
            {/each}
        </div>
    {/if}

    <!-- Regular dims: each scrollable horizontally -->
    {#each regularDims as conf}
        {@const data = groupedData[conf.key] || []}
        {#if data.length > 0}
            <div class="dimension-section">
                <h3>
                    {conf.title}<span class="info-hint" title={conf.description}
                        >ⓘ</span
                    >
                </h3>
                <div class="chart-scroll-container">
                    <div
                        class="plot-interactive-wrapper"
                        onclick={(e) => handleChartClick(e, conf.key)}
                        role="button"
                        tabindex="0"
                        onkeypress={(e) => {
                            if (e.key === "Enter")
                                handleChartClick(e as any, conf.key);
                        }}
                    >
                        <PlotChart plotFn={mkChartFn(conf.key)} {data} />
                    </div>
                </div>
            </div>
        {/if}
    {/each}
</div>

<style>
    .satellite-container {
        display: flex;
        flex-direction: column;
        gap: 0.55rem;
        flex: 1;
        min-height: 0;
        overflow-y: auto;
        overflow-x: hidden; /* explicit: prevent section-level horizontal scroll */
        padding-right: 0.25rem;
    }

    /* Compact/boolean row: 2-column grid so items never superimpose */
    .boolean-row {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 0.4rem;
    }

    .boolean-chart {
        min-width: 0;
        overflow: hidden; /* clip SVG content — no scroll needed for 2-3 bars */
    }

    .dimension-section {
        background: color-mix(
            in srgb,
            var(--bg-primary, hsl(var(--background))) 40%,
            transparent
        );
        border: 1px solid
            color-mix(in srgb, var(--border, #2f3b4a) 40%, transparent);
        border-radius: 0.5rem;
        padding: 0.48rem;
        min-width: 0;
    }

    .dimension-section h3 {
        margin: 0 0 0.22rem 0;
        font-size: 0.85rem;
        color: hsl(var(--muted-foreground));
        text-transform: uppercase;
        letter-spacing: 0.05em;
    }

    .info-hint {
        margin-left: 0.35rem;
        font-size: 0.78rem;
        opacity: 0.45;
        cursor: help;
    }

    .dimension-section h3:hover .info-hint {
        opacity: 0.9;
    }

    /* Horizontal scroll for bar charts */
    .chart-scroll-container {
        overflow-x: auto;
        overflow-y: hidden;
        /* Custom scrollbar */
        scrollbar-width: thin;
        scrollbar-color: var(--border, #2f3b4a) transparent;
    }

    .chart-scroll-container::-webkit-scrollbar {
        height: 4px;
    }

    .chart-scroll-container::-webkit-scrollbar-thumb {
        background: var(--border, #2f3b4a);
        border-radius: 2px;
    }

    .plot-interactive-wrapper {
        outline: none;
        display: inline-block; /* shrink-wrap to plot width for scroll */
    }

    .plot-interactive-wrapper :global(.plot-container) {
        justify-content: flex-start;
    }

    .plot-interactive-wrapper :global(svg) {
        display: block;
        overflow: visible; /* for tooltip to not clip */
        /* Plot injects max-width: 100% as inline style — override it so the chart
           can be wider than the container and trigger horizontal scroll */
        max-width: none !important;
    }

    /* Same override needed inside scroll containers */
    .chart-scroll-container :global(svg) {
        max-width: none !important;
    }

    .plot-interactive-wrapper :global(rect) {
        transition:
            fill-opacity 0.15s ease,
            fill 0.15s ease;
        cursor: pointer;
    }

    .plot-interactive-wrapper :global(rect:hover) {
        fill-opacity: 1 !important;
        stroke: var(--foreground, #fff);
        stroke-width: 1px;
    }

    /* Observable Plot tooltip styling */
    .plot-interactive-wrapper :global([data-name="tip"]) {
        font-size: 0.8rem;
    }
</style>
