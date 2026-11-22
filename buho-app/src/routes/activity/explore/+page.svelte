<script lang="ts">
    import { themeStore } from '#lib/stores/themeStore.svelte.ts';
    import ExplorerIndicators, {
        type Indicator,
    } from '#lib/components/visualizations/ExplorerIndicators.svelte';
    import ClearFiltersButton from '#lib/components/visualizations/ClearFiltersButton.svelte';
    import { peakColor } from '#lib/visualizations/themeColors.ts';
    import { onDestroy, untrack } from 'svelte';
    import ConstellationChart from '#lib/components/visualizations/ConstellationChart.svelte';
    import SunburstExplorer from '#lib/components/visualizations/SunburstExplorer.svelte';
    import DimensionPie from '#lib/components/visualizations/DimensionPie.svelte';
    import LoadingOverlay from '#lib/components/LoadingOverlay.svelte';
    import ModuleEmptyState from '#lib/components/ModuleEmptyState.svelte';
    import { moduleById } from '#lib/data/modules.ts';
    import {
        getActivityBasePoints,
        getActivityTimeDomain,
        serviceLabel,
        type ActivityBasePoint,
    } from '#lib/data/queries/activityQueries.ts';
    import {
        buildPathHierarchy,
        type PathLevel,
        type PathRow,
        type SunburstNode,
    } from '#lib/visualizations/sunburstHierarchy.ts';
    import type { FilterState } from '#lib/types/filters.ts';
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
    import {
        PointSearch,
        SEARCH_KEY,
        TERM_COLOR_KEY,
        followSearch,
        initialColoring,
        parseSearch,
        searchQuery,
        toggleColoring,
        withoutTerm,
        type TermColoring,
    } from '#lib/explorer/search.ts';
    import ExplorerSearch from '#lib/components/visualizations/ExplorerSearch.svelte';
    import SearchLegend from '#lib/components/visualizations/SearchLegend.svelte';
    import { dataStore } from '#lib/stores/dataStore.svelte.ts';
    import { activityExplorerFilters } from '#lib/stores/activityExplorerFilters.svelte.ts';
    import { stickyColor, termColor } from '#lib/utils/dimensionColors.ts';
    import { firstFilterValue } from '#lib/utils/filters.ts';
    import { hasOpenModifier, MODIFIER_LABEL } from '#lib/utils/spotify.ts';

    // Resolved at render time: the constellation paints on a canvas, which
    // cannot read the module's `--peak-*` itself. Its points are dots, too small
    // for the module's pastel fill.
    const MATCHED_COLOR = $derived.by(() => {
        void themeStore.theme;
        return peakColor('activity');
    });

    // The points are loaded ONCE (raw: no reactive proxy over the whole export).
    // The `matched` flag is recomputed in JS in place, and `matchVersion` triggers
    // a chart-side redraw without rebuilding the quadtree or hitting the DB.
    let basePoints = $state.raw<ActivityBasePoint[]>([]);
    let matchVersion = $state(0);
    let pieSlices = $state<Record<string, DimensionSlice[]>>({});
    // service → action → channel → title, built in JS from the base points like
    // the pies (cf. computeSunburstTree).
    let sunburstTree = $state.raw<SunburstNode>({ name: 'All activity' });
    let sunburstWidth = $state(0);
    let sunburstHeight = $state(0);
    /** Totals for the current selection, shown above the charts. */
    let tiles = $state({ entries: 0, services: 0, days: 0 });

    let initialLoad = $state(true);
    let containerWidth = $state(0);
    let containerHeight = $state(0);
    let viewportHeight = $state(0);
    let timeDomain = $state<[number, number] | null>(null);
    let viewTimeDomain = $state.raw<[number, number] | null>(null);
    let viewHourDomain = $state.raw<[number, number] | null>(null);

    const pieSize = $derived(Math.max(56, Math.min(120, Math.round(viewportHeight * 0.1) - 20)));

    const module = moduleById('activity');
    const activeFilters = $derived(activityExplorerFilters.activeFilters);
    const dbReady = $derived(dataStore.loaded.activity && !dataStore.isLoading);

    // The `timestamp` column is stored as LOCAL wall-clock time (cf.
    // sources/googleActivity). The "YYYY-MM-DD HH:MM:SS" format has no zone
    // suffix: new Date() already interprets it as local time.
    function formatHappenedAt(at: string): string {
        const d = new Date(at.replace(' ', 'T'));
        return Number.isNaN(d.getTime()) ? at : d.toLocaleString();
    }

    function truncate(text: string, max = 110): string {
        const clean = text.replace(/\s+/g, ' ').trim();
        return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
    }

    function constellationTooltip(m: Record<string, unknown>) {
        const label = truncate((m.label as string) ?? '');
        const secondary = (m.secondary as string) ?? '';
        const lines = [`${m.action} · ${formatHappenedAt(m.happenedAt as string)}`];
        if (secondary) lines.push(secondary);
        const href = m.url as string | null;
        return {
            title: label || serviceLabel(m.service as string),
            lines,
            hint: href ? `${MODIFIER_LABEL}+click to open` : undefined,
        };
    }

    function constellationPointClick(m: Record<string, unknown>): boolean {
        const url = m.url as string | null;
        if (!url || typeof window === 'undefined') return false;
        window.open(url, '_blank', 'noopener,noreferrer');
        return true;
    }

    // --- Dimensions (config) ---------------------------------------------
    // `key` = store key; `field` = field carried by the base points. `label` and
    // `secondary` live in the sunburst rather than a pie: they have thousands of
    // distinct values, which no pie survives.
    type DimField = keyof ActivityBasePoint;
    type MatchDim = ValueDimension<ActivityBasePoint>;

    /**
     * Sunburst hierarchy: depth (1-based) → store filter key. Levels are
     * compacted when absent — a search has no channel, so it reads
     * service → action → title — and the level's *key*, not its depth, drives
     * cross-filtering.
     */
    const SUNBURST_LEVELS: { key: string; field: DimField }[] = [
        { key: 'service', field: 'fService' },
        { key: 'action', field: 'fAction' },
        // The three grouping rings below are mutually exclusive in practice —
        // an entry is a visit, a route or a search, never several — so each one
        // is empty for the others and the ring collapses. A YouTube watch reads
        // service → action → channel → title, a followed result
        // service → action → domain → page, a route
        // service → action → origin → destination, a search
        // service → action → first word → query.
        { key: 'domain', field: 'fDomain' },
        { key: 'origin', field: 'fOrigin' },
        { key: 'first_word', field: 'fFirstWord' },
        { key: 'secondary', field: 'secondary' },
        { key: 'label', field: 'label' },
    ];

    const SUNBURST_KEY_BY_DEPTH = {
        1: 'service',
        2: 'action',
        3: 'domain',
        4: 'origin',
        5: 'first_word',
        6: 'secondary',
        7: 'label',
    };
    const SUNBURST_OTHER_LABELS = [
        'Other services',
        'Other actions',
        'Other sites',
        'Other origins',
        'Other words',
        'Other channels',
        'Other titles',
    ];
    /**
     * Keys the sunburst owns — excluded from its OWN data so it stays full, and
     * excluded from `sunburstSig` so a click never rebuilds the tree.
     *
     * That second part is load-bearing: the component assumes `data` holds still
     * while it animates. Anything that makes the tree depend on where the user
     * has zoomed to replaces `data` on click, which triggers a full re-render and
     * wipes the transition mid-flight.
     */
    const SUNBURST_KEYS = new Set(SUNBURST_LEVELS.map((l) => l.key));

    interface PieDim extends MatchDim {
        label: string;
        format?: (v: string) => string;
    }
    const PIE_DIMS: PieDim[] = [
        {
            key: 'service',
            field: 'fService',
            label: 'Service',
            format: serviceLabel,
        },
        { key: 'action', field: 'fAction', label: 'Action' },
        { key: 'is_ad', field: 'fAd', label: 'Ads' },
        { key: 'located', field: 'fLocated', label: 'Location' },
        {
            key: 'dayofweek',
            field: 'dow',
            label: 'Day of week',
            format: dowLabel,
        },
        { key: 'year', field: 'year', label: 'Year' },
    ];

    const MATCH_DIMS: MatchDim[] = [
        ...PIE_DIMS,
        { key: 'domain', field: 'fDomain' },
        { key: 'origin', field: 'fOrigin' },
        { key: 'first_word', field: 'fFirstWord' },
        { key: 'secondary', field: 'secondary' },
        { key: 'label', field: 'label' },
    ];
    /** Only the pies get a per-dimension breakdown; the sunburst builds its own. */
    const BREAKDOWN_DIMS: MatchDim[] = PIE_DIMS;

    const TOP_N = 15;

    // --- Search -----------------------------------------------------------
    // Over what an entry is called and what sits under it — a video's title and
    // its channel, a query, a page — so "when did I look that up" has an answer.
    // The query sits in the filter store with the other selections, so the
    // sunburst, the pies and the constellation all narrow to the matches.

    const searchRaw = $derived(searchQuery(activeFilters));
    const searchTerms = $derived(parseSearch(searchRaw));
    const searching = $derived(searchTerms.length > 0);
    const termColors = $derived(searchTerms.map((_, i) => termColor(i)));

    // Joined on a line break, so a phrase cannot match across the two.
    const search = new PointSearch<ActivityBasePoint>((p) => `${p.label}\n${p.secondary}`);
    /** Hits per term in the current selection, for the legend. */
    let termCounts = $state<number[]>([]);

    function setSearch(raw: string) {
        if (raw.trim()) activityExplorerFilters.setFilter(SEARCH_KEY, raw, 'search');
        else activityExplorerFilters.removeFilter(SEARCH_KEY, 'search');
    }

    const searchLegend = $derived(
        searchTerms.map((term, i) => ({
            label: term.label,
            count: termCounts[i] ?? 0,
            color: termColors[i],
        }))
    );

    // --- Coloring by dimension -------------------------------------------
    // Service is the default: stacking every service on one timeline is the
    // whole point of this view, and it is unreadable in a single hue. A search
    // of two terms or more paints by term instead — see `followSearch`.
    let coloring = $state<TermColoring>(initialColoring('service'));
    const colorBy = $derived(coloring.colorBy);

    const colorByTerm = $derived(colorBy === TERM_COLOR_KEY && searching);

    const colorByDim = $derived(colorBy ? (PIE_DIMS.find((d) => d.key === colorBy) ?? null) : null);

    /** The field the constellation paints by: a pie's dimension, or the matched term. */
    const colorField = $derived(colorByTerm ? 'searchTerm' : (colorByDim?.field ?? null));

    const colorCategories = $derived(
        colorByTerm
            ? searchTerms.map((term, i) => ({ value: term.label, color: termColors[i] }))
            : colorBy && colorByDim
              ? (pieSlices[colorBy] ?? []).map((s) => ({
                    value: s.value,
                    color: stickyColor(colorBy as string, s.value),
                }))
              : []
    );

    function toggleColorBy(key: string) {
        coloring = toggleColoring(coloring, key);
    }

    $effect(() => {
        const count = searchTerms.length;
        untrack(() => (coloring = followSearch(coloring, count)));
    });

    /** Every value filter in force, as a test per dimension, and the search. */
    function filterTests(f: FilterState): CrossfilterTest<ActivityBasePoint>[] {
        return [...valueTests(f, MATCH_DIMS), ...search.tests()];
    }

    /** Signature of the filters that affect `matched` (time/hour are view domains). */
    function matchSig(f: FilterState): string {
        return JSON.stringify([...MATCH_DIMS.map((d) => f[d.key] ?? null), f[SEARCH_KEY] ?? null]);
    }

    let prevMatchSig = '';

    /**
     * Recomputes `matched` in place on the points (mutation, not a new reference)
     * then bumps `matchVersion` to trigger a chart redraw.
     */
    function computeMatched() {
        const filters = activityExplorerFilters.activeFilters;
        search.apply(filters);
        markMatched(basePoints, filterTests(filters));
        matchVersion += 1;
    }

    /**
     * Breakdown of every dimension — the pies, the ranking and the stat tiles —
     * in a SINGLE JS pass over the in-memory points (no DB round-trip, so it
     * stays immediate during a brush).
     * Each breakdown excludes its own filter (like the classic bars): per point we
     * count the failing active dimensions — a point counts for a breakdown if it
     * passes EVERYTHING (0 failures) or if it fails ONLY on that one. The visible
     * time/hour window (brush) applies throughout.
     */
    function computeBreakdowns() {
        const pts = basePoints;
        if (pts.length === 0) {
            pieSlices = Object.fromEntries(PIE_DIMS.map((d) => [d.key, []]));
            tiles = { entries: 0, services: 0, days: 0 };
            termCounts = [];
            return;
        }

        let entries = 0;
        const seenServices = new Set<string>();
        const seenDays = new Set<number>();
        const termTally = search.tally();

        const totals = breakdowns(pts, {
            tests: filterTests(activityExplorerFilters.activeFilters),
            dimensions: BREAKDOWN_DIMS,
            window: { time: viewTimeDomain, hour: viewHourDomain },
            // The tiles describe the selection itself: only full matches count.
            onMatch: (p) => {
                entries += 1;
                seenServices.add(p.fService);
                seenDays.add(p.x);
                termTally.add(p);
            },
        });

        const nextPies: Record<string, DimensionSlice[]> = {};
        for (const d of PIE_DIMS) nextPies[d.key] = topNSlices(totals[d.key], TOP_N);
        pieSlices = nextPies;

        tiles = { entries, services: seenServices.size, days: seenDays.size };
        termCounts = termTally.counts;
    }

    /**
     * Sunburst data: aggregate the base points into a
     * service → action → channel → title tree, in JS like the pies.
     *
     * It EXCLUDES its own four dimensions from the filter (selecting a slice
     * keeps the hierarchy full, the selection shows as zoom/highlight) but
     * respects every other active dimension and the brush window.
     */
    function computeSunburstTree(): SunburstNode {
        const pts = basePoints;
        const tests = filterTests(activityExplorerFilters.activeFilters).filter(
            (t) => !SUNBURST_KEYS.has(t.key)
        );
        const window = { time: viewTimeDomain, hour: viewHourDomain };
        const agg = new Map<string, PathRow>();

        for (let i = 0; i < pts.length; i++) {
            const p = pts[i];
            if (!inWindow(p, window) || !passesAll(p, tests)) continue;

            const levels: PathLevel[] = [];
            for (const lvl of SUNBURST_LEVELS) {
                const name = p[lvl.field] as string;
                // Empty levels are skipped, not faked: an entry with no channel
                // should read service → action → title, not gain a blank ring.
                if (name) {
                    levels.push({
                        name,
                        // `name` is what gets written into the filter, so it has
                        // to stay the stored value; the pretty service name is
                        // display only.
                        label: lvl.key === 'service' ? serviceLabel(name) : undefined,
                        key: lvl.key,
                    });
                }
            }
            if (levels.length === 0) continue;

            const mapKey = levels.map((l) => l.name).join('\u0000');
            let e = agg.get(mapKey);
            if (!e) {
                e = { levels, value: 0, href: p.url };
                agg.set(mapKey, e);
            }
            e.value += 1;
        }

        return buildPathHierarchy([...agg.values()], 'All activity');
    }

    /**
     * Signature of the inputs that change the sunburst's DATA — its own four
     * dimensions excluded, since it filters on those itself.
     *
     * Without this guard the tree is reassigned on every filter click, the
     * component rebuilds, and the drill-down transition is wiped mid-flight —
     * which reads as "clicking does nothing".
     */
    function sunburstSig(): string {
        const f = activityExplorerFilters.activeFilters;
        const rest: FilterState = {};
        for (const k in f) if (!SUNBURST_KEYS.has(k)) rest[k] = f[k];
        return JSON.stringify([rest, basePoints.length, viewTimeDomain, viewHourDomain]);
    }

    let prevSunburstSig = '';

    /**
     * Rebuild the tree only when its inputs actually changed. The brush is one of
     * them, so the sunburst follows the time window live, like the pies.
     *
     * Note what is NOT in the signature: the sunburst's own dimensions. Clicking
     * an arc must leave the tree untouched, or the component re-renders and the
     * drill-down animation is destroyed as it starts.
     */
    function maybeRecomputeSunburst() {
        const sig = sunburstSig();
        if (sig === prevSunburstSig) return;
        prevSunburstSig = sig;
        sunburstTree = computeSunburstTree();
    }

    // Recompute coalesced in rAF: during the brush, several window changes per
    // frame ⇒ a single recompute.
    let breakdownRaf = 0;
    function scheduleBreakdownRecompute() {
        if (breakdownRaf) return;
        breakdownRaf = requestAnimationFrame(() => {
            breakdownRaf = 0;
            computeBreakdowns();
            maybeRecomputeSunburst();
        });
    }

    let baseSeq = 0;

    async function loadBasePoints() {
        baseSeq += 1;
        const runId = baseSeq;
        try {
            const [nextPoints, domain] = await Promise.all([
                getActivityBasePoints(),
                getActivityTimeDomain(),
            ]);
            if (runId !== baseSeq) return;

            timeDomain = domain;
            basePoints = nextPoints; // stable reference until the next dataset
            search.reset(nextPoints);
            prevMatchSig = matchSig(activityExplorerFilters.activeFilters);
            computeMatched();
        } catch (e) {
            console.error('Error loading activity base points:', e);
        } finally {
            if (runId === baseSeq && initialLoad) initialLoad = false;
        }
    }

    function resetState() {
        baseSeq += 1;
        basePoints = [];
        matchVersion = 0;
        pieSlices = {};
        sunburstTree = { name: 'All activity' };
        prevSunburstSig = '';
        tiles = { entries: 0, services: 0, days: 0 };
        termCounts = [];
        search.reset(null);
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

    // Pies and tiles: JS recompute (immediate, no DB) whenever the points, the
    // selection or the brush window change. Coalesced in an animation frame.
    $effect(() => {
        const _b = basePoints;
        const _m = matchVersion; // proxy for selection changes
        const _t = viewTimeDomain;
        const _h = viewHourDomain;
        if (!dbReady) return;
        scheduleBreakdownRecompute();
    });

    onDestroy(() => {
        if (breakdownRaf) cancelAnimationFrame(breakdownRaf);
    });

    const indicators = $derived<Indicator[]>([
        { value: tiles.entries.toLocaleString(), label: 'entries' },
        { value: tiles.services.toLocaleString(), label: 'services' },
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

            <div class="header-tools">
                {#if activityExplorerFilters.hasActiveFilters}
                    <ClearFiltersButton onclick={() => activityExplorerFilters.clearAll()} />
                {/if}
                <ExplorerSearch
                    value={searchRaw}
                    onChange={setSearch}
                    placeholder="Search titles, queries, channels"
                    onWarm={() => search.warm()}
                />
            </div>
        </div>

        <section class="explorer-grid" aria-label="Google activity explorer layout">
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
                            <LoadingOverlay message="Rendering your activity..." />
                        </div>
                    {:else if containerWidth > 0 && containerHeight > 0}
                        <ConstellationChart
                            data={basePoints}
                            {matchVersion}
                            width={containerWidth}
                            height={containerHeight}
                            {timeDomain}
                            {colorField}
                            {colorCategories}
                            matchedColor={MATCHED_COLOR}
                            formatTooltip={constellationTooltip}
                            onPointClick={constellationPointClick}
                            bind:viewTimeDomain
                            bind:viewHourDomain
                        >
                            {#snippet legend()}
                                <SearchLegend
                                    entries={searchLegend}
                                    countLabel="entries"
                                    colorByActive={colorByTerm}
                                    onToggleColorBy={() => toggleColorBy(TERM_COLOR_KEY)}
                                    onRemove={(label) => setSearch(withoutTerm(searchRaw, label))}
                                    vizId="activity-explorer"
                                />
                            {/snippet}
                        </ConstellationChart>
                    {/if}
                </div>
            </article>

            <aside class="chart-placeholder ranking" aria-label="Activity breakdown">
                <div
                    class="sunburst-host"
                    bind:clientWidth={sunburstWidth}
                    bind:clientHeight={sunburstHeight}
                >
                    {#if dbReady && !initialLoad && sunburstWidth > 0}
                        <SunburstExplorer
                            data={sunburstTree}
                            width={sunburstWidth}
                            height={sunburstHeight}
                            filters={activityExplorerFilters}
                            keyByDepth={SUNBURST_KEY_BY_DEPTH}
                            rootLabel="All activity"
                            formatValue={(v) => `${Math.round(v).toLocaleString()} entries`}
                            otherLabels={SUNBURST_OTHER_LABELS}
                            canOpen={(node) => !!node.href}
                            onLeafOpen={(node, event) => {
                                if (!hasOpenModifier(event) || !node.href) return false;
                                window.open(node.href, '_blank', 'noopener,noreferrer');
                                return true;
                            }}
                            openHint={`${MODIFIER_LABEL}+click to open`}
                            colorMode="branch"
                            testId="activity-sunburst-explorer"
                        />
                    {/if}
                </div>
            </aside>
        </section>

        {#if !initialLoad && dbReady}
            <section class="dimensions-row" aria-label="Dimension breakdowns">
                {#each PIE_DIMS as pd (pd.key)}
                    <DimensionPie
                        title={pd.label}
                        filterKey={pd.key}
                        slices={pieSlices[pd.key] ?? []}
                        size={pieSize}
                        format={pd.format}
                        sliceValue={(s) => s.plays}
                        formatValue={(v) => `${Math.round(v).toLocaleString()} entries`}
                        selectedValue={firstFilterValue(activeFilters, pd.key)}
                        onSelect={(v) =>
                            v === null
                                ? activityExplorerFilters.removeFilter(pd.key, 'pie')
                                : activityExplorerFilters.setFilter(pd.key, v, 'pie')}
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
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: 0.65rem 1.25rem;
    }

    /* Flush right, so the field holds still while the totals beside it shrink
       with every letter typed; the clear button comes and goes on its left. */
    .header-tools {
        margin-left: auto;
        display: flex;
        align-items: center;
        gap: 0.75rem;
        min-width: 0;
    }

    @media (max-width: 767px) {
        .header-tools {
            width: 100%;
        }
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

    .sunburst-host {
        width: 100%;
        flex: 1;
        min-height: 0;
        display: flex;
        align-items: center;
        justify-content: center;
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
