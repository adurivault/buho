<script lang="ts">
    import { themeStore } from '#lib/stores/themeStore.svelte.ts';
    import ExplorerIndicators, {
        type Indicator,
    } from '#lib/components/visualizations/ExplorerIndicators.svelte';
    import ClearFiltersButton from '#lib/components/visualizations/ClearFiltersButton.svelte';
    import { peakColor } from '#lib/visualizations/themeColors.ts';
    import { onDestroy, untrack } from 'svelte';
    import ConstellationChart from '#lib/components/visualizations/ConstellationChart.svelte';
    import ArtistSunburstExplorer from '#lib/components/visualizations/ArtistSunburstExplorer.svelte';
    import DimensionPie from '#lib/components/visualizations/DimensionPie.svelte';
    import MeasureToggle from '#lib/components/visualizations/MeasureToggle.svelte';
    import {
        getConstellationTimeDomain,
        getExplorerBasePoints,
        getExplorerMacroStats,
        playSearchText,
        type ConnectablePoint,
        type ExplorerBasePoint,
        type ExplorerMacroStats,
    } from '#lib/data/queries/behaviorQueries.ts';
    import {
        getArtistSunburstFiltered,
        type ArtistSunburstRow,
    } from '#lib/data/queries/artistQueries.ts';
    import type { FilterState } from '#lib/types/filters.ts';
    import {
        dowLabel,
        inWindow,
        markMatched,
        soleFailure,
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
    import LoadingOverlay from '#lib/components/LoadingOverlay.svelte';
    import ModuleEmptyState from '#lib/components/ModuleEmptyState.svelte';
    import { moduleById } from '#lib/data/modules.ts';
    import { dataStore } from '#lib/stores/dataStore.svelte.ts';
    import { listeningExplorerFilters } from '#lib/stores/listeningExplorerFilters.svelte.ts';
    import { listeningMeasure } from '#lib/stores/listeningMeasure.svelte.ts';
    import type { Measure } from '#lib/data/sql/measure.ts';
    import { MEASURE_OPTIONS, formatMeasure } from '#lib/utils/measure.ts';
    import { formatDurationLong } from '#lib/utils/duration.ts';
    import { stickyColor, termColor } from '#lib/utils/dimensionColors.ts';
    import { firstFilterValue } from '#lib/utils/filters.ts';
    import { MODIFIER_LABEL, openSpotify } from '#lib/utils/spotify.ts';
    import { trackControl } from '#lib/analytics.ts';

    // Resolved at render time: the constellation paints on a canvas, which
    // cannot read the module's `--peak-*` itself. Its points are dots, too small
    // for the module's pastel fill.
    const MATCHED_COLOR = $derived.by(() => {
        void themeStore.theme;
        return peakColor('listening');
    });

    /**
     * What every breakdown counts. Minutes rank what filled your time, plays
     * what you reached for — a three-hour DJ set and forty singles are the same
     * afternoon, but only one of them is forty listens.
     *
     * Held in a store rather than here so the guide counts the same thing, and
     * so a history with no durations anywhere — Last.fm scrobbles carry none —
     * opens on plays instead of on a page of zeroes.
     *
     * The constellation itself never changes: one point is one play either way.
     */
    const measure = $derived(listeningMeasure.measure);

    function measureOf(m: Measure, p: ExplorerBasePoint): number {
        return m === 'plays' ? 1 : p.mins;
    }

    // A fresh closure per measure change, so the satellite bars recompute.
    const barValue = $derived.by(() => {
        const m = measure;
        return (p: ConnectablePoint) => measureOf(m, p as ExplorerBasePoint);
    });

    const sliceValue = $derived((s: DimensionSlice) => (measure === 'plays' ? s.plays : s.minutes));

    const formatValue = $derived((v: number) => formatMeasure(measure, v));

    // The constellation points are loaded ONCE (raw: no reactive proxy over 167k
    // objects). The `matched` flag is recomputed in JS in place, and
    // `matchVersion` triggers a simple chart-side redraw — without rebuilding the
    // quadtree (~1.3 s) or a DB round-trip on every filter.
    let basePoints = $state.raw<ExplorerBasePoint[]>([]);
    let matchVersion = $state(0);
    let sunburstRows = $state<ArtistSunburstRow[]>([]);
    let pieSlices = $state<Record<string, DimensionSlice[]>>({});
    let macroStats = $state<ExplorerMacroStats>({
        totalMinutes: 0,
        totalPlays: 0,
        uniqueArtists: 0,
        uniqueAlbums: 0,
        uniqueTracks: 0,
    });

    let initialLoad = $state(true);
    let isProcessing = $state(false);
    let containerWidth = $state(0);
    let containerHeight = $state(0);
    let sunburstWidth = $state(0);
    let sunburstHeight = $state(0);
    let viewportHeight = $state(0);
    let timeDomain = $state<[number, number] | null>(null);

    // The pies take ~10% of the screen height (square + label). Clamped to stay
    // legible on small screens and reasonable on large ones.
    const pieSize = $derived(Math.max(56, Math.min(120, Math.round(viewportHeight * 0.1) - 20)));

    let baseSeq = 0;
    let sunburstSeq = 0;
    let macroSeq = 0;

    let sunburstTimer: ReturnType<typeof setTimeout> | null = null;
    let macroTimer: ReturnType<typeof setTimeout> | null = null;

    let prevSunburstSig = '';
    let prevMacroSig = '';
    let prevMatchSig = '';
    const REQUEST_DEBOUNCE_MS = 30;
    // The brush emits continuously during the drag; we throttle applying the
    // filter to refresh the sunburst ~9 times/s without saturating the thread.
    const FILTER_SYNC_THROTTLE_MS = 110;

    let viewTimeDomain = $state.raw<[number, number] | null>(null);
    let viewHourDomain = $state.raw<[number, number] | null>(null);

    const module = moduleById('listening');
    const activeFilters = $derived(listeningExplorerFilters.activeFilters);
    const dbReady = $derived(dataStore.loaded.listening && !dataStore.isLoading);

    // The `timestamp` column is stored as LOCAL wall-clock time (cf.
    // insertSpotifyPlays → formatLocalTimestamp). The "YYYY-MM-DD HH:MM:SS" format
    // has no zone suffix: new Date() already interprets it as local time.
    function formatPlayedAt(playedAt: string): string {
        const d = new Date(playedAt.replace(' ', 'T'));
        return Number.isNaN(d.getTime()) ? playedAt : d.toLocaleString();
    }

    function constellationTooltip(m: Record<string, unknown>) {
        return {
            title: m.track as string,
            lines: [m.artist as string, formatPlayedAt(m.playedAt as string)],
            hint: m.trackUri ? `${MODIFIER_LABEL}+click to play on Spotify` : undefined,
        };
    }

    function constellationPointClick(m: Record<string, unknown>): boolean {
        return openSpotify(m.trackUri as string | null);
    }

    // --- Dimensions (config) ---------------------------------------------
    // `key` = store key / SQL column; `field` = field carried by the base points.
    // All these dimensions affect the constellation's `matched`.
    type MatchDim = ValueDimension<ExplorerBasePoint>;
    const MATCH_DIMS: MatchDim[] = [
        { key: 'source', field: 'source' },
        { key: 'artist_name', field: 'fArtist' },
        { key: 'album_name', field: 'fAlbum' },
        { key: 'track_name', field: 'fTrack' },
        { key: 'ip_addr', field: 'ip' },
        { key: 'platform_clean', field: 'platform' },
        { key: 'country', field: 'country' },
        { key: 'dayofweek', field: 'dow' },
        { key: 'media_type', field: 'mediaType' },
        { key: 'reason_start', field: 'reasonStart' },
        { key: 'shuffle', field: 'shuffle' },
        { key: 'skipped', field: 'skipped' },
        { key: 'offline', field: 'offline' },
    ];

    // Boolean fields are encoded 'True'/'False' (cf. getExplorerBasePoints).
    const boolLabel =
        (yes: string, no: string) =>
        (v: string): string =>
            v === 'True' ? yes : no;

    // Subset shown as pie charts (artist/album/track are the sunburst).
    interface PieDim extends MatchDim {
        label: string;
        format?: (v: string) => string;
    }
    const PIE_DIMS: PieDim[] = [
        // First, and the reason the others read straight: colouring by service
        // is what makes a Deezer play visible at all — merged into the same
        // arcs and artists as Spotify's, it is otherwise indistinguishable.
        { key: 'source', field: 'source', label: 'Service' },
        { key: 'ip_addr', field: 'ip', label: 'IP address' },
        { key: 'country', field: 'country', label: 'Country' },
        { key: 'platform_clean', field: 'platform', label: 'Platform' },
        {
            key: 'dayofweek',
            field: 'dow',
            label: 'Day of week',
            format: dowLabel,
        },
        { key: 'reason_start', field: 'reasonStart', label: 'Reason start' },
        { key: 'media_type', field: 'mediaType', label: 'Media type' },
        {
            key: 'shuffle',
            field: 'shuffle',
            label: 'Shuffle',
            format: boolLabel('Shuffle', 'In order'),
        },
        {
            key: 'skipped',
            field: 'skipped',
            label: 'Skipped',
            format: boolLabel('Skipped', 'Completed'),
        },
        {
            key: 'offline',
            field: 'offline',
            label: 'Offline',
            format: boolLabel('Offline', 'Online'),
        },
    ];

    const TOP_N = 15;

    // --- Search -----------------------------------------------------------
    // Over each play's title, artist and album: "remix, live, acoustic" is a
    // question the sunburst cannot ask. The query sits in the filter store with
    // the other selections, so the constellation, the pies, the sunburst and the
    // totals all narrow to the matches — the last two in SQL, which is why
    // `playSearchText` has a twin there.

    const searchRaw = $derived(searchQuery(activeFilters));
    const searchTerms = $derived(parseSearch(searchRaw));
    const searching = $derived(searchTerms.length > 0);
    const termColors = $derived(searchTerms.map((_, i) => termColor(i)));

    const search = new PointSearch<ExplorerBasePoint>(playSearchText);
    /** Hits per term in the current selection, for the legend. */
    let termCounts = $state<number[]>([]);

    function setSearch(raw: string) {
        if (raw.trim()) listeningExplorerFilters.setFilter(SEARCH_KEY, raw, 'search');
        else listeningExplorerFilters.removeFilter(SEARCH_KEY, 'search');
    }

    const searchLegend = $derived(
        searchTerms.map((term, i) => ({
            label: term.label,
            count: termCounts[i] ?? 0,
            color: termColors[i],
        }))
    );

    // --- Coloring by dimension -------------------------------------------
    // `colorBy` = store key of the dimension that colors the constellation and
    // stacks the satellite barcharts (null = green by default). Any pie can be the
    // source; the toggle is exclusive. The categories/colors are derived from the
    // dimension to stay pixel-aligned with the pie. A search can paint by term
    // instead — see `followSearch` for when.
    let coloring = $state<TermColoring>(initialColoring(null));
    const colorBy = $derived(coloring.colorBy);

    const colorByTerm = $derived(colorBy === TERM_COLOR_KEY && searching);

    const colorByDim = $derived(colorBy ? (PIE_DIMS.find((d) => d.key === colorBy) ?? null) : null);

    /** The field the constellation paints by: a pie's dimension, or the matched term. */
    const colorField = $derived(colorByTerm ? 'searchTerm' : (colorByDim?.field ?? null));

    // Category order/colors: aligned EXACTLY on the pie's slices (so brush window
    // + all filters included). The colors shown in the constellation/barcharts
    // thus reference what the pie shows.
    // The trade-off is that the stacking order can flip when brushing — but the
    // barcharts only color the brushed portion (cf. ConstellationChart), so the
    // flip stays readable.
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
    function filterTests(f: FilterState): CrossfilterTest<ExplorerBasePoint>[] {
        return [...valueTests(f, MATCH_DIMS), ...search.tests()];
    }

    /**
     * Signature of the filters that affect `matched` (= all dimensions except
     * timestamp/hour, handled as view domains by the chart).
     */
    function matchSig(f: FilterState): string {
        return JSON.stringify([...MATCH_DIMS.map((d) => f[d.key] ?? null), f[SEARCH_KEY] ?? null]);
    }

    /**
     * Recomputes `matched` in place on the points (mutation, not a new reference)
     * then bumps `matchVersion` to trigger a chart redraw.
     */
    function computeMatched() {
        const filters = listeningExplorerFilters.activeFilters;
        search.apply(filters);
        markMatched(basePoints, filterTests(filters));
        matchVersion += 1;
    }

    /**
     * Top slices by the *active* measure, with the rest folded into "Other".
     *
     * Ranking has to use the same measure the pie draws with: sorting by minutes
     * and rendering by plays would cut the top N on one basis and size it on
     * another, so a big slice could be missing from its own chart.
     */
    function topNSlices(
        acc: Map<string, { minutes: number; plays: number }>,
        by: Measure
    ): DimensionSlice[] {
        const weight = (v: { minutes: number; plays: number }) =>
            by === 'plays' ? v.plays : v.minutes;
        const sorted = [...acc.entries()]
            .map(([value, v]) => ({
                value,
                minutes: v.minutes,
                plays: v.plays,
            }))
            .sort((a, b) => weight(b) - weight(a));
        const slices = sorted.slice(0, TOP_N);
        const rest = sorted.slice(TOP_N);
        if (rest.length) {
            const om = rest.reduce((s, x) => s + x.minutes, 0);
            const op = rest.reduce((s, x) => s + x.plays, 0);
            if (weight({ minutes: om, plays: op }) > 0.5)
                slices.push({ value: 'Other', minutes: om, plays: op });
        }
        return slices;
    }

    /**
     * Breakdown of ALL pie dimensions in a SINGLE JS pass over the in-memory
     * points (no DB round-trip → immediate during the brush).
     * Each pie excludes its own filter (like the classic bars): per point, we
     * count the number of failing active dimensions — a point counts for a pie if
     * it passes EVERYTHING (0 failures) or if it fails ONLY on that pie.
     * The visible time/hour window (brush) applies to all of them.
     */
    function computeAllPieSlices() {
        const pts = basePoints;
        const next: Record<string, DimensionSlice[]> = {};
        if (pts.length === 0) {
            for (const pd of PIE_DIMS) next[pd.key] = [];
            pieSlices = next;
            termCounts = [];
            return;
        }
        const tests = filterTests(listeningExplorerFilters.activeFilters);
        const window = { time: viewTimeDomain, hour: viewHourDomain };
        const maps: Record<string, Map<string, { minutes: number; plays: number }>> = {};
        for (const pd of PIE_DIMS) maps[pd.key] = new Map();
        // Plays per term, for the legend: the ones the whole selection holds.
        const termTally = search.tally();

        for (let i = 0; i < pts.length; i++) {
            const p = pts[i];
            if (!inWindow(p, window)) continue;
            // Each pie ignores its own filter (see `soleFailure`).
            const failed = soleFailure(p, tests);
            if (failed === false) continue;
            if (failed === null) termTally.add(p);

            for (const pd of PIE_DIMS) {
                if (failed !== null && failed !== pd.key) continue;
                const m = maps[pd.key];
                const key = p[pd.field] as string;
                let e = m.get(key);
                if (!e) {
                    e = { minutes: 0, plays: 0 };
                    m.set(key, e);
                }
                e.minutes += p.mins;
                e.plays += 1;
            }
        }

        for (const pd of PIE_DIMS) next[pd.key] = topNSlices(maps[pd.key], measure);
        pieSlices = next;
        termCounts = termTally.counts;
    }

    // Recompute coalesced in rAF: during the brush, several window changes per
    // frame ⇒ a single recompute (and graceful degradation if heavy).
    let pieRaf = 0;
    function schedulePieRecompute() {
        if (pieRaf) return;
        pieRaf = requestAnimationFrame(() => {
            pieRaf = 0;
            computeAllPieSlices();
        });
    }

    async function loadBasePoints() {
        baseSeq += 1;
        const runId = baseSeq;
        try {
            const [nextPoints, domain] = await Promise.all([
                getExplorerBasePoints(),
                getConstellationTimeDomain({}),
            ]);
            if (runId !== baseSeq) return;

            if (domain) timeDomain = [domain.minX, domain.maxX];
            basePoints = nextPoints; // stable reference until the next dataset
            search.reset(nextPoints);
            prevMatchSig = matchSig(listeningExplorerFilters.activeFilters);
            computeMatched();
        } catch (e) {
            console.error('Error loading constellation base points:', e);
        } finally {
            if (runId === baseSeq && initialLoad) initialLoad = false;
        }
    }

    async function loadSunburst(filters = activeFilters) {
        sunburstSeq += 1;
        const runId = sunburstSeq;
        try {
            const nextRows = await getArtistSunburstFiltered(filters);
            if (runId !== sunburstSeq) return;
            sunburstRows = nextRows;
        } catch (e) {
            console.error('Error loading sunburst data:', e);
        }
    }

    async function loadMacro(filters = activeFilters) {
        macroSeq += 1;
        const runId = macroSeq;
        try {
            const next = await getExplorerMacroStats(filters);
            if (runId !== macroSeq) return;
            macroStats = next;
        } catch (e) {
            console.error('Error loading macro stats:', e);
        }
    }

    function resetState() {
        baseSeq += 1;
        sunburstSeq += 1;
        macroSeq += 1;
        basePoints = [];
        matchVersion = 0;
        sunburstRows = [];
        pieSlices = {};
        macroStats = {
            totalMinutes: 0,
            totalPlays: 0,
            uniqueArtists: 0,
            uniqueAlbums: 0,
            uniqueTracks: 0,
        };
        isProcessing = false;
        initialLoad = true;
        prevSunburstSig = '';
        prevMacroSig = '';
        termCounts = [];
        search.reset(null);
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

    // Constellation highlight: JS recompute of `matched` when the artist/album/
    // track selection changes. The signature avoids any useless recompute (e.g.
    // time/hour brush) and `untrack` guarantees that the in-place mutation of
    // `basePoints` cannot re-trigger this effect (anti-loop).
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

    // Sunburst: re-query when a filter OTHER than artist/album/track changes
    // (it excludes its own dimensions to keep the full hierarchy).
    $effect(() => {
        const ready = dbReady;
        const f = activeFilters;
        if (!ready) return;

        const { artist_name, album_name, track_name, ...rest } = f;
        const sig = JSON.stringify(rest);
        if (sig === prevSunburstSig) return;
        prevSunburstSig = sig;

        if (sunburstTimer) clearTimeout(sunburstTimer);
        sunburstTimer = setTimeout(() => void loadSunburst(f), REQUEST_DEBOUNCE_MS);
    });

    // Global indicators: recomputed on every filter change.
    $effect(() => {
        const ready = dbReady;
        const f = activeFilters;
        if (!ready) return;

        const sig = JSON.stringify(f);
        if (sig === prevMacroSig) return;
        prevMacroSig = sig;

        if (macroTimer) clearTimeout(macroTimer);
        macroTimer = setTimeout(() => void loadMacro(f), REQUEST_DEBOUNCE_MS);
    });

    // Pies: JS recompute (immediate, no DB) whenever the points, the selection,
    // or the brush's time/hour window change. Coalesced in rAF.
    $effect(() => {
        const _b = basePoints;
        const _m = matchVersion; // proxy for selection changes
        const _t = viewTimeDomain;
        const _h = viewHourDomain;
        const _measure = measure; // the slices are ranked and sized by it
        if (!dbReady) return;
        schedulePieRecompute();
    });

    // Sync interactions from ConstellationChart to global filters.
    // The brush emits continuously: we apply the filter throttled (leading +
    // trailing) to refresh during the drag, not only on release.
    let timeRangeSyncTimer: ReturnType<typeof setTimeout> | null = null;
    let hourRangeSyncTimer: ReturnType<typeof setTimeout> | null = null;
    let lastTimeSync = 0;
    let lastHourSync = 0;

    function applyRangeFilter(key: 'timestamp' | 'hour_of_day', view: [number, number] | null) {
        if (view) {
            listeningExplorerFilters.setFilter(
                key,
                { min: view[0], max: view[1] },
                'constellation'
            );
        } else {
            listeningExplorerFilters.removeFilter(key, 'constellation');
        }
    }

    $effect(() => {
        if (!dbReady || initialLoad) return;
        const currentView = viewTimeDomain;
        if (timeRangeSyncTimer) clearTimeout(timeRangeSyncTimer);
        const elapsed = performance.now() - lastTimeSync;
        if (elapsed >= FILTER_SYNC_THROTTLE_MS) {
            lastTimeSync = performance.now();
            applyRangeFilter('timestamp', currentView);
        } else {
            timeRangeSyncTimer = setTimeout(() => {
                lastTimeSync = performance.now();
                applyRangeFilter('timestamp', currentView);
            }, FILTER_SYNC_THROTTLE_MS - elapsed);
        }
    });

    $effect(() => {
        if (!dbReady || initialLoad) return;
        const currentView = viewHourDomain;
        if (hourRangeSyncTimer) clearTimeout(hourRangeSyncTimer);
        const elapsed = performance.now() - lastHourSync;
        if (elapsed >= FILTER_SYNC_THROTTLE_MS) {
            lastHourSync = performance.now();
            applyRangeFilter('hour_of_day', currentView);
        } else {
            hourRangeSyncTimer = setTimeout(() => {
                lastHourSync = performance.now();
                applyRangeFilter('hour_of_day', currentView);
            }, FILTER_SYNC_THROTTLE_MS - elapsed);
        }
    });

    onDestroy(() => {
        if (sunburstTimer) clearTimeout(sunburstTimer);
        if (macroTimer) clearTimeout(macroTimer);
        if (pieRaf) cancelAnimationFrame(pieRaf);
        if (timeRangeSyncTimer) clearTimeout(timeRangeSyncTimer);
        if (hourRangeSyncTimer) clearTimeout(hourRangeSyncTimer);
    });

    const indicators = $derived<Indicator[]>([
        // Dropped rather than shown as "0 seconds" when no play carries a
        // duration: the count beside it is the whole answer there.
        ...(listeningMeasure.selectable
            ? [{ value: formatDurationLong(macroStats.totalMinutes), label: 'listened' }]
            : []),
        { value: macroStats.uniqueArtists.toLocaleString(), label: 'unique artists' },
        { value: macroStats.uniqueAlbums.toLocaleString(), label: 'unique albums' },
        { value: macroStats.uniqueTracks.toLocaleString(), label: 'unique tracks' },
        { value: macroStats.totalPlays.toLocaleString(), label: 'listens' },
    ]);
</script>

<svelte:window bind:innerHeight={viewportHeight} />

<div class="explorer-page">
    {#if !dbReady}
        <!--
            This branch did not exist, and its absence is what made the page
            look hung: `initialLoad` only clears inside the query effect, which
            is gated on `dbReady`, so an empty database left "Rendering
            universe…" spinning over four zeroed counters with nothing on the
            way. A page with no data has one job — say so, and offer a way out.
        -->
        <ModuleEmptyState {module} />
    {:else}
        <div class="header-bar">
            <ExplorerIndicators items={indicators} />

            <div class="header-tools">
                {#if listeningExplorerFilters.hasActiveFilters}
                    <ClearFiltersButton onclick={() => listeningExplorerFilters.clearAll()} />
                {/if}
                <ExplorerSearch
                    value={searchRaw}
                    onChange={setSearch}
                    placeholder="Search tracks, artists, albums"
                    onWarm={() => search.warm()}
                />
            </div>
        </div>

        <section class="explorer-grid" aria-label="Spotify explorer layout">
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
                            <LoadingOverlay message="Rendering universe..." />
                        </div>
                    {:else if dbReady && containerWidth > 0 && containerHeight > 0}
                        <ConstellationChart
                            data={basePoints}
                            {matchVersion}
                            matchedColor={MATCHED_COLOR}
                            width={containerWidth}
                            height={containerHeight}
                            {timeDomain}
                            {colorField}
                            {colorCategories}
                            {barValue}
                            formatTooltip={constellationTooltip}
                            onPointClick={constellationPointClick}
                            bind:viewTimeDomain
                            bind:viewHourDomain
                        >
                            {#snippet legend()}
                                <SearchLegend
                                    entries={searchLegend}
                                    countLabel="plays"
                                    colorByActive={colorByTerm}
                                    onToggleColorBy={() => toggleColorBy(TERM_COLOR_KEY)}
                                    onRemove={(label) => setSearch(withoutTerm(searchRaw, label))}
                                    vizId="listening-explorer"
                                />
                            {/snippet}
                        </ConstellationChart>
                    {/if}
                </div>
            </article>

            <aside
                class="chart-placeholder sunburst"
                aria-label="Artist sunburst"
                style="opacity: {isProcessing ? 0.6 : 1}; transition: opacity 0.2s;"
            >
                <div
                    class="sunburst-host"
                    bind:clientWidth={sunburstWidth}
                    bind:clientHeight={sunburstHeight}
                >
                    {#if initialLoad}
                        <div
                            class="loading-wrapper relative w-full h-full flex items-center justify-center"
                        >
                            <LoadingOverlay message="Computing artists..." />
                        </div>
                    {:else if dbReady && sunburstWidth > 0 && sunburstHeight > 0}
                        <ArtistSunburstExplorer
                            rows={sunburstRows}
                            width={sunburstWidth}
                            height={sunburstHeight}
                            {measure}
                        />
                    {/if}
                </div>
            </aside>
        </section>

        {#if !initialLoad && dbReady}
            <section class="dimensions-row" aria-label="Dimension breakdowns">
                {#if listeningMeasure.selectable}
                    <MeasureToggle
                        options={MEASURE_OPTIONS}
                        value={measure}
                        onChange={(key) => {
                            trackControl('spotify-explorer', 'measure', key);
                            listeningMeasure.set(key as Measure);
                        }}
                    />
                    <div class="dimensions-divider" aria-hidden="true"></div>
                {/if}

                {#each PIE_DIMS as pd (pd.key)}
                    <DimensionPie
                        title={pd.label}
                        filterKey={pd.key}
                        slices={pieSlices[pd.key] ?? []}
                        size={pieSize}
                        format={pd.format}
                        {sliceValue}
                        {formatValue}
                        selectedValue={firstFilterValue(activeFilters, pd.key)}
                        onSelect={(v) =>
                            v === null
                                ? listeningExplorerFilters.removeFilter(pd.key, 'pie')
                                : listeningExplorerFilters.setFilter(pd.key, v, 'pie')}
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

    .dimensions-divider {
        align-self: stretch;
        width: 1px;
        background: hsl(var(--border));
        flex: none;
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
        grid-template-columns: 1.5fr 1fr;
        grid-template-rows: minmax(0, 1fr);
        grid-template-areas: 'constellation sunburst';
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

    .sunburst {
        grid-area: sunburst;
        min-width: 0;
        position: relative;
    }

    .sunburst-host {
        width: 100%;
        flex: 1;
        min-height: 0;
        display: flex;
        align-items: center;
        justify-content: center;
    }

    /* Below a certain width, stack constellation + sunburst and let the page
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
                'sunburst';
        }

        .constellation-host {
            min-height: 26rem;
        }

        .sunburst-host {
            min-height: 26rem;
        }
    }
</style>
