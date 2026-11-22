<script lang="ts">
    // Exploratory page: no module entry, no icon, no sidebar. It exists to show
    // what three years of health readings look like, so that what they are for
    // can be decided by looking rather than guessing.
    import SignalRaster from '#lib/components/visualizations/SignalRaster.svelte';
    import ModuleEmptyState from '#lib/components/ModuleEmptyState.svelte';
    import MeasureToggle, {
        type MeasureOption,
    } from '#lib/components/visualizations/MeasureToggle.svelte';
    import {
        getHealthMetrics,
        getHealthSlots,
        SLOT_MINUTES,
        type HealthMetricSummary,
    } from '#lib/data/queries/healthQueries.ts';
    import {
        buildSignalGrid,
        type ColorStop,
        type SignalGrid,
    } from '#lib/visualizations/signalGrid.ts';
    import { RAMP, rampFor } from '#lib/visualizations/healthRamp.ts';
    import { HEALTH_METRICS } from '#lib/types/health.ts';
    import { moduleById } from '#lib/data/modules.ts';
    import { dataStore } from '#lib/stores/dataStore.svelte.ts';

    let summaries = $state.raw<HealthMetricSummary[]>([]);
    let metric = $state<string | null>(null);
    let grid = $state.raw<SignalGrid>(buildSignalGrid([], SLOT_MINUTES));
    let loading = $state(false);
    let chartWidth = $state(0);
    let chartHeight = $state(0);
    let raster = $state<ReturnType<typeof SignalRaster> | null>(null);

    const module = moduleById('health');
    const dbReady = $derived(dataStore.loaded.health && !dataStore.isLoading);
    const current = $derived(summaries.find((s) => s.metric === metric) ?? null);

    const labelOf = (id: string) => HEALTH_METRICS.find((m) => m.id === id)?.label ?? id;
    const unitOf = (id: string) => HEALTH_METRICS.find((m) => m.id === id)?.unit ?? '';

    /**
     * The metrics that are actually in the table, in HEALTH_METRICS order —
     * which is reading order, not the volume order the query would give.
     */
    const available = $derived(
        HEALTH_METRICS.map((m) => summaries.find((s) => s.metric === m.id)).filter(
            (s): s is HealthMetricSummary => s !== undefined
        )
    );

    const options = $derived<MeasureOption[]>(
        available.map((s) => ({
            key: s.metric,
            label: labelOf(s.metric),
            hint: `${s.readings.toLocaleString()} readings · ${s.firstDay} → ${s.lastDay} · p5 ${Math.round(s.low)}, median ${Math.round(s.median)}, p95 ${Math.round(s.high)} ${unitOf(s.metric)}`.trim(),
        }))
    );

    /** The current signal's own ramp — see `rampFor`. */
    const stops = $derived<ColorStop[]>(
        current
            ? rampFor(current)
            : [
                  { value: 0, color: RAMP[0] },
                  { value: 1, color: RAMP[5] },
              ]
    );

    /**
     * What each tile of the legend stands for, on hover.
     *
     * A tile is a band of the ramp: from the value its colour is reached at to
     * the next one's. They are all drawn the same width even though the last
     * covers far more ground than the others — the range says so, and a tile
     * stretched to its share of the scale made the legend look broken.
     */
    const tileRanges = $derived(
        stops.map((stop, i) => {
            const unit = unitOf(metric ?? '');
            const suffix = unit ? ` ${unit}` : '';
            const next = stops[i + 1];
            return next
                ? `${Math.round(stop.value)}–${Math.round(next.value)}${suffix}`
                : `${Math.round(stop.value)}${suffix} and up`;
        })
    );

    /** What the colours mean, in a sentence — the legend's tooltip. */
    const scaleSummary = $derived.by(() => {
        const unit = unitOf(metric ?? '');
        const suffix = unit ? ` ${unit}` : '';
        const top = stops.length > RAMP.length ? '99.5th' : '95th';
        return (
            `Colour is the reading itself: ${Math.round(stops[0].value)}${suffix} at the blue end, ` +
            `${Math.round(stops[stops.length - 1].value)}${suffix} and up at the far one. The two ends ` +
            `are this signal's own 5th and ${top} percentiles — the lowest and highest readings would ` +
            `hand the whole scale to a handful of them. Hover a tile for the range it stands for.`
        );
    });

    /** Cells holding a reading, against every cell between the two ends. */
    const coverage = $derived(
        grid.dayCount > 0 ? grid.filled / (grid.dayCount * grid.slotsPerDay) : 0
    );

    async function load(next: string) {
        metric = next;
        loading = true;
        try {
            grid = buildSignalGrid(await getHealthSlots(next), SLOT_MINUTES);
        } finally {
            loading = false;
        }
    }

    let summarised = false;
    $effect(() => {
        if (!dbReady || summarised) return;
        summarised = true;
        void (async () => {
            summaries = await getHealthMetrics();
            if (available.length) void load(available[0].metric);
        })();
    });
</script>

<div class="page">
    {#if !dbReady}
        <ModuleEmptyState {module} />
    {:else if summaries.length === 0}
        <!-- The gap between the table filling and the summary query landing.
             It used to read "re-drop the export", which was addressed to
             somebody whose import had just worked: `dbReady` answered for the
             whole Garmin archive, so a steps-only import opened this page. It
             now answers for `health_readings` alone, and rows in that table
             always group into at least one metric. -->
        <p class="empty">Reading your health data…</p>
    {:else}
        <MeasureToggle
            {options}
            value={metric ?? ''}
            label="Signal"
            onChange={(key) => load(key)}
        />

        {#if current}
            <div class="bar">
                <span class="scale" title={scaleSummary}>
                    {#each stops as stop, i (stop.value)}
                        <b>{Math.round(stop.value)}</b>
                        <i style:background={stop.color} title={tileRanges[i]}></i>
                    {/each}
                    {unitOf(current.metric)}
                </span>
                <span>
                    {grid.dayCount.toLocaleString()} days × {grid.slotsPerDay} slots of
                    {SLOT_MINUTES} min · {Math.round(coverage * 100)}% recorded
                </span>
                <button type="button" onclick={() => raster?.reset()}>Reset zoom</button>
            </div>
        {/if}

        <div class="chart" bind:clientWidth={chartWidth} bind:clientHeight={chartHeight}>
            {#if loading}
                <p class="empty">Loading {labelOf(metric ?? '')}…</p>
            {:else if chartWidth > 0 && chartHeight > 0 && grid.dayCount > 0}
                <SignalRaster
                    bind:this={raster}
                    {grid}
                    {stops}
                    width={chartWidth}
                    height={chartHeight}
                    label="{labelOf(metric ?? '')} {unitOf(metric ?? '')}"
                    formatValue={(v) => `${Math.round(v * 10) / 10} ${unitOf(metric ?? '')}`.trim()}
                />
            {/if}
        </div>

        <p class="note">
            Drag under the grid to zoom into a span of days, or to the right of it for a range of
            hours. The strips are the averages of what is in view: below, one bar per day; on the
            right, the shape of an average day. Colour is the reading itself, on the scale above.
            Hovering a cell reads the value off it; hovering a tile of the scale gives the range
            that tile stands for.
        </p>
    {/if}
</div>

<style>
    .page {
        padding: 1rem;
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
        color: hsl(var(--foreground));
        background: var(--bg-primary, hsl(var(--background)));
        min-height: 100%;
    }

    .bar {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 1rem;
        font-size: var(--text-label);
        color: hsl(var(--muted-foreground));
    }

    .scale {
        display: flex;
        align-items: center;
        gap: 0.25rem;
    }

    /* A tick before each tile: the value its colour is reached at, which is
       also where the tile's own range starts. */
    .scale b {
        font-weight: 400;
        font-variant-numeric: tabular-nums;
    }

    /* Every tile the same width, the last one included: it covers more of the
       scale than the others, and its tooltip is where that is said. Sizing it
       to its share drew a legend that read as broken. */
    .scale i {
        width: 1.4rem;
        height: 0.55rem;
    }

    .bar button {
        border: 1px solid hsl(var(--border));
        border-radius: var(--radius-sm);
        padding: 0.15rem 0.45rem;
        font: inherit;
        font-size: var(--text-label);
        color: inherit;
        background: transparent;
        cursor: pointer;
    }

    .chart {
        height: 62vh;
        min-height: 22rem;
        border: 1px solid hsl(var(--border));
        border-radius: var(--radius-md);
        overflow: hidden;
    }

    .empty,
    .note {
        font-size: var(--text-label);
        line-height: 1.4;
        margin: 0;
        color: hsl(var(--muted-foreground));
    }
</style>
