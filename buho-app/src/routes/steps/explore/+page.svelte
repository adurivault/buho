<script lang="ts">
    import { themeStore } from '#lib/stores/themeStore.svelte.ts';
    import ExplorerIndicators, {
        type Indicator,
    } from '#lib/components/visualizations/ExplorerIndicators.svelte';
    import ClearFiltersButton from '#lib/components/visualizations/ClearFiltersButton.svelte';
    import { peakColor } from '#lib/visualizations/themeColors.ts';
    import { onDestroy, untrack } from 'svelte';
    import ConstellationChart from '#lib/components/visualizations/ConstellationChart.svelte';
    import CadenceDistribution from '#lib/components/visualizations/CadenceDistribution.svelte';
    import DimensionPie from '#lib/components/visualizations/DimensionPie.svelte';
    import MeasureToggle, {
        type MeasureOption,
    } from '#lib/components/visualizations/MeasureToggle.svelte';
    import LoadingOverlay from '#lib/components/LoadingOverlay.svelte';
    import ModuleEmptyState from '#lib/components/ModuleEmptyState.svelte';
    import { moduleById } from '#lib/data/modules.ts';
    import {
        getStepBasePoints,
        getStepsTimeDomain,
        NOT_MEASURED,
        type StepBasePoint,
    } from '#lib/data/queries/stepsQueries.ts';
    import {
        inCadenceSelection,
        type CadenceSeries,
    } from '#lib/visualizations/cadenceDistribution.ts';
    import type { FilterState, NumericRangeFilterValue } from '#lib/types/filters.ts';
    import {
        breakdowns,
        dowLabel,
        inWindow,
        markMatched,
        passesAll,
        topNSlices,
        valueTests,
        type CrossfilterTest,
        type ValueDimension,
        type DimensionSlice,
    } from '#lib/explorer/crossfilter.ts';
    import type { ConnectablePoint } from '#lib/data/queries/behaviorQueries.ts';
    import { dataStore } from '#lib/stores/dataStore.svelte.ts';
    import { stepsExplorerFilters } from '#lib/stores/stepsExplorerFilters.svelte.ts';
    import { categoricalColor, stickyColor } from '#lib/utils/dimensionColors.ts';
    import { firstFilterValue } from '#lib/utils/filters.ts';
    import { formatDuration } from '#lib/utils/duration.ts';
    import { trackControl } from '#lib/analytics.ts';

    // Resolved at render time: the constellation paints on a canvas, which
    // cannot read the module's `--peak-*` itself. Its points are dots, too small
    // for the module's pastel fill.
    const MATCHED_COLOR = $derived.by(() => {
        void themeStore.theme;
        return peakColor('steps');
    });
    /**
     * Running gets its own hue, the categorical yellow stepped per theme: the
     * two curves overlap around fast walking.
     */
    const CADENCE_SERIES_COLORS = $derived({
        walking: 'var(--module-fill)',
        running: categoricalColor(3),
    });

    // The points are loaded ONCE (raw: no reactive proxy over the whole export).
    // The `matched` flag is recomputed in JS in place, and `matchVersion` triggers
    // a chart-side redraw without rebuilding the quadtree or hitting the DB.
    let basePoints = $state.raw<StepBasePoint[]>([]);
    let matchVersion = $state(0);
    let pieSlices = $state<Record<string, DimensionSlice[]>>({});
    /** One series per step counter — the distribution's raw input. */
    let cadenceSeries = $state.raw<CadenceSeries[]>([]);
    /** Totals for the current selection, shown above the charts. */
    let tiles = $state({ steps: 0, activeMinutes: 0, days: 0 });

    let initialLoad = $state(true);
    let containerWidth = $state(0);
    let containerHeight = $state(0);
    let viewportHeight = $state(0);
    let timeDomain = $state<[number, number] | null>(null);
    let viewTimeDomain = $state.raw<[number, number] | null>(null);
    let viewHourDomain = $state.raw<[number, number] | null>(null);

    const pieSize = $derived(Math.max(56, Math.min(120, Math.round(viewportHeight * 0.1) - 20)));

    const activeFilters = $derived(stepsExplorerFilters.activeFilters);
    const module = moduleById('steps');
    const dbReady = $derived(dataStore.loaded.steps && !dataStore.isLoading);

    // --- Measure ----------------------------------------------------------
    // A packet says two things worth weighting by: how many steps, and how long
    // the watch counted as moving. Distance is deliberately not offered — the
    // watch fills that counter in on 5–13% of packets depending on the year, so
    // weighting by it would silently describe a tenth of the data as if it were
    // all of it.
    type Measure = 'steps' | 'active';
    let measure = $state<Measure>('steps');
    const MEASURES: MeasureOption[] = [
        { key: 'steps', label: 'Steps', hint: 'Weighted by steps taken' },
        { key: 'active', label: 'Active time', hint: 'Weighted by minutes actually moving' },
    ];

    function measureOf(m: Measure, p: StepBasePoint): number {
        return m === 'active' ? p.activeMins : p.steps;
    }

    function measureValue(p: StepBasePoint): number {
        return measureOf(measure, p);
    }

    function formatMeasure(v: number): string {
        if (measure === 'active') return formatDuration(v);
        return `${Math.round(v).toLocaleString()} steps`;
    }

    // A fresh closure on each measure change, so the satellite bars recompute.
    const barValue = $derived.by(() => {
        const m = measure;
        return (p: ConnectablePoint) => measureOf(m, p as StepBasePoint);
    });

    // --- Tooltip ----------------------------------------------------------
    // `timestamp` is stored as LOCAL wall-clock (cf. lib/data/sources/garmin/stepPackets).
    // The "YYYY-MM-DD HH:MM:SS" format has no zone suffix, so new Date() already
    // reads it as local time.
    function formatAt(at: string): string {
        const d = new Date(at.replace(' ', 'T'));
        return Number.isNaN(d.getTime()) ? at : d.toLocaleString();
    }

    /** "18:12" — the start of a packet's window, next to its end. */
    function formatClock(at: string): string {
        const d = new Date(at.replace(' ', 'T'));
        return Number.isNaN(d.getTime())
            ? at
            : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    function constellationTooltip(m: Record<string, unknown>) {
        const steps = Number(m.steps) || 0;
        const activeMins = Number(m.activeMins) || 0;
        const spanMins = Number(m.spanMins) || 0;
        const cadence = m.cadenceSpm as number | null;
        const km = (Number(m.distanceMeters) || 0) / 1000;

        const lines = [
            formatAt(m.recordedAt as string),
            // The window and the movement inside it are different numbers, and
            // the gap between them is what a packet actually records.
            `${formatDuration(activeMins)} moving, in a ${formatDuration(spanMins)} window from ${formatClock(m.startedAt as string)}`,
        ];
        if (cadence != null) lines.push(`${Math.round(cadence)} steps/min`);
        // Distance is too sparse to weight the view by, but showing it on the
        // one packet that carries it hides nothing: a line that only appears
        // when there is a reading can't misrepresent the packets without one.
        if (km >= 0.01) lines.push(`${km.toFixed(2)} km`);
        // Only where the phone took a reading during the window.
        const speed = m.walkingSpeed as number | null;
        const stride = m.stepLength as number | null;
        const gait = [
            speed != null ? `${speed.toFixed(1)} km/h` : null,
            stride != null ? `${Math.round(stride)} cm steps` : null,
        ].filter(Boolean);
        if (gait.length) lines.push(gait.join(' · '));

        return { title: `${steps.toLocaleString()} steps`, lines };
    }

    // --- Dimensions (config) ---------------------------------------------
    type MatchDim = ValueDimension<StepBasePoint>;

    interface PieDim extends MatchDim {
        label: string;
        format?: (v: string) => string;
    }
    const PIE_DIMS: PieDim[] = [
        { key: 'intensity', field: 'fIntensity', label: 'Intensity' },
        { key: 'span', field: 'fSpan', label: 'Window' },
        { key: 'dayofweek', field: 'dow', label: 'Day of week', format: dowLabel },
        { key: 'year', field: 'year', label: 'Year' },
        // How the steps were walked, where a phone measured it: a property of
        // the packets like any other, so it filters like any other.
        { key: 'speed', field: 'fSpeed', label: 'Walking speed', format: withUnit('km/h') },
        { key: 'stride', field: 'fStride', label: 'Step length', format: withUnit('cm') },
    ];

    function withUnit(unit: string) {
        return (v: string) => (v === NOT_MEASURED ? v : `${v} ${unit}`);
    }

    /**
     * The gait pies need a phone that measured gait. Without one every packet
     * is "Not measured", and a pie of a single slice says nothing.
     */
    const GAIT_KEYS = new Set(['speed', 'stride']);
    const hasGait = $derived(
        basePoints.some((p) => p.walkingSpeed != null || p.stepLength != null)
    );
    const visiblePies = $derived(PIE_DIMS.filter((d) => hasGait || !GAIT_KEYS.has(d.key)));

    /**
     * Cadence has no pie: its own panel draws the whole distribution and owns
     * the filtering. The bands still exist as a breakdown, because the
     * constellation colours by them.
     *
     * No walking/running split either: the watch keeps them on separate
     * counters, but a step is a step, and cadence already says which was which
     * without cutting every day in two.
     */
    const CADENCE_DIM: PieDim = {
        key: 'cadence',
        field: 'fCadence',
        label: 'Cadence',
    };

    /** Dimensions filtered by value; cadence is filtered by range instead. */
    const MATCH_DIMS: MatchDim[] = PIE_DIMS;
    const BREAKDOWN_DIMS: MatchDim[] = [CADENCE_DIM, ...PIE_DIMS];
    /** Every dimension the constellation can take its colours from. */
    const COLOR_DIMS: PieDim[] = BREAKDOWN_DIMS as PieDim[];

    /**
     * The single cadence filter. It is a numeric range rather than a band, since
     * the panel reads cadence at the resolution it draws — a band is just the
     * range a user picks by clicking instead of dragging.
     */
    const CADENCE_RANGE_KEY = 'cadenceRange';

    const TOP_N = 15;

    // --- Coloring by dimension -------------------------------------------
    // Cadence by default: with walking and running summed, it is the dimension
    // that still tells a stroll from a run.
    let colorBy = $state<string | null>('cadence');

    const colorByDim = $derived(
        colorBy ? (COLOR_DIMS.find((d) => d.key === colorBy) ?? null) : null
    );

    const colorCategories = $derived(
        colorBy
            ? (pieSlices[colorBy] ?? []).map((s) => ({
                  value: s.value,
                  color: stickyColor(colorBy as string, s.value),
              }))
            : []
    );

    function toggleColorBy(key: string) {
        colorBy = colorBy === key ? null : key;
    }

    /**
     * Every filter in force as a test. The cadence range is one more, keyed as
     * the cadence dimension, so the cadence breakdown ignores it like any other
     * dimension ignores its own filter.
     */
    function filterTests(f: FilterState): CrossfilterTest<StepBasePoint>[] {
        const tests = valueTests(f, MATCH_DIMS);
        const range = cadenceRangeOf(f);
        if (range) tests.push({ key: CADENCE_DIM.key, pass: (p) => inCadenceRange(p, range) });
        return tests;
    }

    /** The cadence selection in force, or null if cadence is unfiltered. */
    function cadenceRangeOf(f: FilterState): NumericRangeFilterValue | null {
        const v = f[CADENCE_RANGE_KEY];
        if (!v || typeof v !== 'object' || v instanceof Set || Array.isArray(v)) return null;
        const r = v as NumericRangeFilterValue;
        if (typeof r.min !== 'number' && typeof r.max !== 'number') return null;
        return r;
    }

    /**
     * Matched through the same whole-spm readings the panel draws, so a bar and
     * the points it lights up in the constellation always agree.
     *
     * A window is kept when EITHER counter ran at that pace: the panel counts a
     * mixed window's run in the running curve, and lighting up only windows
     * whose blended cadence lands in the range would leave that mass unclaimed.
     */
    function inCadenceRange(p: StepBasePoint, r: NumericRangeFilterValue | null): boolean {
        if (!r) return true;
        const min = r.min ?? null;
        const max = r.max ?? null;
        return (
            inCadenceSelection(p.walkCadenceSpm, min, max) ||
            inCadenceSelection(p.runCadenceSpm, min, max)
        );
    }

    const cadenceRange = $derived(cadenceRangeOf(activeFilters));

    function selectCadenceRange(next: NumericRangeFilterValue | null) {
        if (!next) {
            stepsExplorerFilters.removeFilter(CADENCE_RANGE_KEY, 'bar');
            return;
        }
        stepsExplorerFilters.setFilter(CADENCE_RANGE_KEY, next, 'bar');
    }

    /** Signature of the filters that affect `matched` (time/hour are view domains). */
    function matchSig(f: FilterState): string {
        return JSON.stringify([
            MATCH_DIMS.map((d) => f[d.key] ?? null),
            f[CADENCE_RANGE_KEY] ?? null,
        ]);
    }

    let prevMatchSig = '';

    /**
     * Recomputes `matched` in place on the points (mutation, not a new reference)
     * then bumps `matchVersion` to trigger a chart redraw.
     */
    function computeMatched() {
        markMatched(basePoints, filterTests(stepsExplorerFilters.activeFilters));
        matchVersion += 1;
    }

    /**
     * Breakdown of every dimension — the pies and the stat tiles — in a SINGLE
     * JS pass over the in-memory points (no DB round-trip, so it stays immediate
     * during a brush).
     * Each breakdown excludes its own filter: per point we count the failing
     * active dimensions — a point counts for a breakdown if it passes EVERYTHING
     * (0 failures) or if it fails ONLY on that one. The visible time/hour window
     * (brush) applies throughout.
     */
    function computeBreakdowns() {
        const pts = basePoints;
        if (pts.length === 0) {
            pieSlices = Object.fromEntries(PIE_DIMS.map((d) => [d.key, []]));
            tiles = { steps: 0, activeMinutes: 0, days: 0 };
            return;
        }

        let steps = 0;
        let activeMinutes = 0;
        const seenDays = new Set<number>();

        const totals = breakdowns(pts, {
            tests: filterTests(stepsExplorerFilters.activeFilters),
            dimensions: BREAKDOWN_DIMS,
            window: { time: viewTimeDomain, hour: viewHourDomain },
            weight: measureValue,
            // The tiles describe the selection itself: only full matches count.
            onMatch: (p) => {
                steps += p.steps;
                activeMinutes += p.activeMins;
                seenDays.add(p.x);
            },
        });

        const nextPies: Record<string, DimensionSlice[]> = {};
        for (const d of PIE_DIMS) nextPies[d.key] = topNSlices(totals[d.key], TOP_N);
        pieSlices = nextPies;

        tiles = { steps, activeMinutes, days: seenDays.size };
    }

    /**
     * The distribution's input: one (cadence, weight) pair per packet, in JS
     * like the pies. Nothing is bucketed here — the panel lays the weight down
     * at its own drawing resolution, so it needs the raw ratios.
     *
     * It EXCLUDES its own dimension (a cadence selection keeps the shape whole
     * and shows as a highlight, rather than a chart that empties itself) but
     * respects every other active dimension and the brush window.
     */
    function computeCadenceSamples() {
        const pts = basePoints;
        // Value filters only: the cadence range is this panel's own.
        const tests = valueTests(stepsExplorerFilters.activeFilters, MATCH_DIMS);
        const window = { time: viewTimeDomain, hour: viewHourDomain };
        const byActive = measure === 'active';

        const walkCadence = new Float64Array(pts.length);
        const walkWeight = new Float64Array(pts.length);
        const runCadence = new Float64Array(pts.length);
        const runWeight = new Float64Array(pts.length);
        let n = 0;

        for (let i = 0; i < pts.length; i++) {
            const p = pts[i];
            if (!inWindow(p, window) || !passesAll(p, tests)) continue;

            // NaN, not 0: a counter with no active time has no pace to report,
            // and zeroing it would pile a fake mode against the left edge.
            walkCadence[n] = p.walkCadenceSpm ?? NaN;
            walkWeight[n] = byActive ? p.walkActiveMins : p.walkSteps;
            runCadence[n] = p.runCadenceSpm ?? NaN;
            runWeight[n] = byActive ? p.runActiveMins : p.runSteps;
            n++;
        }

        cadenceSeries = [
            {
                key: 'walking',
                label: 'Walking',
                cadences: walkCadence.subarray(0, n),
                weights: walkWeight.subarray(0, n),
            },
            {
                key: 'running',
                label: 'Running',
                cadences: runCadence.subarray(0, n),
                weights: runWeight.subarray(0, n),
            },
        ];
    }

    /**
     * Signature of the inputs that change the distribution's DATA — its own
     * dimension excluded, since it filters on that itself. Without the guard the
     * arrays are rebuilt on every cadence click, for an identical shape.
     */
    function cadenceSig(): string {
        const f = stepsExplorerFilters.activeFilters;
        const rest: FilterState = {};
        for (const k in f) if (k !== CADENCE_RANGE_KEY) rest[k] = f[k];
        return JSON.stringify([rest, basePoints.length, viewTimeDomain, viewHourDomain, measure]);
    }

    let prevCadenceSig = '';

    function maybeRecomputeCadence() {
        const sig = cadenceSig();
        if (sig === prevCadenceSig) return;
        prevCadenceSig = sig;
        computeCadenceSamples();
    }

    // Recompute coalesced in rAF: during the brush, several window changes per
    // frame ⇒ a single recompute.
    let breakdownRaf = 0;
    function scheduleBreakdownRecompute() {
        if (breakdownRaf) return;
        breakdownRaf = requestAnimationFrame(() => {
            breakdownRaf = 0;
            computeBreakdowns();
            maybeRecomputeCadence();
        });
    }

    let baseSeq = 0;

    async function loadBasePoints() {
        baseSeq += 1;
        const runId = baseSeq;
        try {
            const [nextPoints, domain] = await Promise.all([
                getStepBasePoints(),
                getStepsTimeDomain(),
            ]);
            if (runId !== baseSeq) return;

            timeDomain = domain;
            basePoints = nextPoints; // stable reference until the next dataset
            prevMatchSig = matchSig(stepsExplorerFilters.activeFilters);
            computeMatched();
        } catch (e) {
            console.error('Error loading step base points:', e);
        } finally {
            if (runId === baseSeq && initialLoad) initialLoad = false;
        }
    }

    function resetState() {
        baseSeq += 1;
        basePoints = [];
        matchVersion = 0;
        pieSlices = {};
        cadenceSeries = [];
        prevCadenceSig = '';
        tiles = { steps: 0, activeMinutes: 0, days: 0 };
        initialLoad = true;
        prevMatchSig = '';
    }

    // Loading the points: ONCE when the source is ready. The point set does not
    // depend on the filters.
    let basePointsLoaded = false;
    $effect(() => {
        const ready = dbReady;
        if (!ready) {
            basePointsLoaded = false;
            resetState();
            return;
        }
        if (basePointsLoaded) return;
        basePointsLoaded = true;
        void loadBasePoints();
    });

    // Constellation highlight: JS recompute of `matched` when the selection
    // changes. The signature avoids useless recomputes (e.g. a time/hour brush)
    // and `untrack` guarantees the in-place mutation of `basePoints` cannot
    // re-trigger this effect (anti-loop).
    $effect(() => {
        if (!dbReady) return;
        const sig = matchSig(activeFilters);
        untrack(() => {
            if (sig === prevMatchSig) return;
            prevMatchSig = sig;
            if (basePoints.length === 0) return;
            computeMatched();
        });
    });

    // Pies, cadence and tiles: JS recompute (immediate, no DB) whenever the
    // points, the selection, the brush window or the measure change.
    $effect(() => {
        const _b = basePoints;
        const _m = matchVersion; // proxy for selection changes
        const _t = viewTimeDomain;
        const _h = viewHourDomain;
        const _measure = measure;
        if (!dbReady) return;
        scheduleBreakdownRecompute();
    });

    onDestroy(() => {
        if (breakdownRaf) cancelAnimationFrame(breakdownRaf);
    });

    const indicators = $derived<Indicator[]>([
        { value: tiles.steps.toLocaleString(), label: 'steps' },
        { value: formatDuration(tiles.activeMinutes), label: 'moving' },
        { value: tiles.days.toLocaleString(), label: 'active days' },
    ]);
</script>

<svelte:window bind:innerHeight={viewportHeight} />

<div class="explorer-page">
    {#if !dbReady}
        <ModuleEmptyState {module} />
    {:else}
        <div class="header-bar">
            <ExplorerIndicators items={indicators} />

            <div class="header-actions">
                <MeasureToggle
                    options={MEASURES}
                    value={measure}
                    onChange={(key) => {
                        trackControl('garmin-explorer', 'measure', key);
                        measure = key as Measure;
                    }}
                />
                {#if stepsExplorerFilters.hasActiveFilters}
                    <ClearFiltersButton onclick={() => stepsExplorerFilters.clearAll()} />
                {/if}
            </div>
        </div>

        <section class="explorer-grid" aria-label="Garmin steps explorer layout">
            <article class="chart-placeholder constellation" aria-label="Constellation chart area">
                <div
                    class="constellation-host"
                    bind:clientWidth={containerWidth}
                    bind:clientHeight={containerHeight}
                >
                    {#if initialLoad}
                        <div
                            class="loading-wrapper relative w-full h-full flex items-center justify-center"
                        >
                            <LoadingOverlay message="Rendering your steps..." />
                        </div>
                    {:else if containerWidth > 0 && containerHeight > 0}
                        <ConstellationChart
                            data={basePoints}
                            {matchVersion}
                            width={containerWidth}
                            height={containerHeight}
                            {timeDomain}
                            colorField={colorByDim?.field ?? null}
                            {colorCategories}
                            matchedColor={MATCHED_COLOR}
                            {barValue}
                            formatTooltip={constellationTooltip}
                            bind:viewTimeDomain
                            bind:viewHourDomain
                        />
                    {/if}
                </div>
            </article>

            <aside class="chart-placeholder ranking" aria-label="Cadence distribution">
                {#if dbReady && !initialLoad}
                    <CadenceDistribution
                        series={cadenceSeries}
                        colors={CADENCE_SERIES_COLORS}
                        range={cadenceRange}
                        onSelect={selectCadenceRange}
                        formatValue={formatMeasure}
                        colorByActive={colorBy === CADENCE_DIM.key}
                        onToggleColorBy={() => toggleColorBy(CADENCE_DIM.key)}
                        testId="garmin-cadence-distribution"
                    />
                {/if}
            </aside>
        </section>

        {#if !initialLoad && dbReady}
            <section class="dimensions-row" aria-label="Dimension breakdowns">
                {#each visiblePies as pd (pd.key)}
                    <DimensionPie
                        title={pd.label}
                        filterKey={pd.key}
                        slices={pieSlices[pd.key] ?? []}
                        size={pieSize}
                        format={pd.format}
                        sliceValue={(s) => s.plays}
                        formatValue={formatMeasure}
                        selectedValue={firstFilterValue(activeFilters, pd.key)}
                        onSelect={(v) =>
                            v === null
                                ? stepsExplorerFilters.removeFilter(pd.key, 'pie')
                                : stepsExplorerFilters.setFilter(pd.key, v, 'pie')}
                        colorByEnabled
                        colorByActive={colorBy === pd.key}
                        onToggleColorBy={() => toggleColorBy(pd.key)}
                    />
                {/each}
            </section>
        {/if}
    {/if}
</div>

<style>
    .explorer-page {
        height: 100%;
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
        padding: 1rem;
        background: var(--bg-primary, hsl(var(--background)));
        color: hsl(var(--foreground));
    }

    .header-bar {
        flex: none;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.65rem;
    }

    .header-actions {
        display: flex;
        align-items: center;
        gap: 0.65rem;
    }

    .dimensions-row {
        flex: none;
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: 0.75rem 1.25rem;
        padding: 0.75rem 1rem;
        border: 1px solid var(--border, hsl(var(--border)));
        border-radius: var(--radius-lg);
        background: var(--bg-secondary, hsl(var(--card)));
    }

    .explorer-grid {
        flex: 1;
        min-height: 0;
        display: grid;
        gap: 1rem;
        grid-template-columns: 2.2fr 1fr;
        grid-template-rows: minmax(0, 1fr);
        grid-template-areas: 'constellation ranking';
    }

    .chart-placeholder {
        min-height: 0;
        border: 1px solid var(--border, hsl(var(--border)));
        border-radius: var(--radius-lg);
        background: var(--bg-secondary, hsl(var(--card)));
        padding: 1rem;
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
    }

    .constellation {
        grid-area: constellation;
        min-width: 0;
    }

    .constellation-host {
        width: 100%;
        flex: 1;
        min-height: 0;
    }

    .ranking {
        grid-area: ranking;
        min-width: 0;
        overflow: hidden;
    }

    /* Below a certain width, stack constellation + ranking and let the page
       scroll: impossible to keep everything legible in a single screen. */
    @media (max-width: 1023px) {
        .explorer-page {
            height: auto;
            min-height: 100%;
        }

        .explorer-grid {
            grid-template-columns: 1fr;
            grid-template-rows: auto auto;
            grid-template-areas:
                'constellation'
                'ranking';
        }

        .constellation-host {
            min-height: 26rem;
        }

        .ranking {
            min-height: 22rem;
        }
    }
</style>
