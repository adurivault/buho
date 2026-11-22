<script lang="ts">
    import { themeStore } from '#lib/stores/themeStore.svelte.ts';
    import ExplorerIndicators, {
        type Indicator,
    } from '#lib/components/visualizations/ExplorerIndicators.svelte';
    import ClearFiltersButton from '#lib/components/visualizations/ClearFiltersButton.svelte';
    import { peakColor } from '#lib/visualizations/themeColors.ts';
    import { onDestroy, untrack } from 'svelte';
    import ConstellationChart from '#lib/components/visualizations/ConstellationChart.svelte';
    import DimensionPie from '#lib/components/visualizations/DimensionPie.svelte';
    import MeasureToggle, {
        type MeasureOption,
    } from '#lib/components/visualizations/MeasureToggle.svelte';
    import SunburstExplorer from '#lib/components/visualizations/SunburstExplorer.svelte';
    import LocationMap from '#lib/components/visualizations/LocationMap.svelte';
    import type { MapBounds } from '#lib/visualizations/locationMapData.ts';
    import {
        getPositionsConstellationTimeDomain,
        getPositionsExplorerBasePoints,
        patchGeoAttributes,
        sourceLabel,
        type LocationBasePoint,
    } from '#lib/data/queries/positionsQueries.ts';
    import type { ConnectablePoint } from '#lib/data/queries/behaviorQueries.ts';
    import {
        buildPathHierarchy,
        type PathLevel,
        type SunburstNode,
    } from '#lib/visualizations/sunburstHierarchy.ts';
    import type { FilterState } from '#lib/types/filters.ts';
    import {
        dowLabel,
        inWindow,
        passesAll,
        soleFailure,
        valueTests,
        type CrossfilterTest,
        type ValueDimension,
        type DimensionSlice,
    } from '#lib/explorer/crossfilter.ts';
    import LoadingOverlay from '#lib/components/LoadingOverlay.svelte';
    import ModuleEmptyState from '#lib/components/ModuleEmptyState.svelte';
    import { moduleById } from '#lib/data/modules.ts';
    import { dataStore } from '#lib/stores/dataStore.svelte.ts';
    import { positionsExplorerFilters } from '#lib/stores/positionsExplorerFilters.svelte.ts';
    import { formatDuration, formatDurationLong } from '#lib/utils/duration.ts';
    import { firstFilterValue } from '#lib/utils/filters.ts';
    import { stickyColor } from '#lib/utils/dimensionColors.ts';
    import { trackControl, trackThrottled } from '#lib/analytics.ts';

    // Resolved at render time: the constellation paints on a canvas, which
    // cannot read the module's `--peak-*` itself. Its points are dots, too small
    // for the module's pastel fill.
    const MATCHED_COLOR = $derived.by(() => {
        void themeStore.theme;
        return peakColor('positions');
    });

    // Points loaded ONCE (raw). `matched` recomputed in JS in place, `matchVersion`
    // triggers a redraw without rebuilding the quadtree (cf. /listening/explore).
    let basePoints = $state.raw<LocationBasePoint[]>([]);
    let matchVersion = $state(0);
    let pieSlices = $state<Record<string, DimensionSlice[]>>({});
    let macroStats = $state({
        totalSegments: 0,
        totalMinutes: 0,
        totalKm: 0,
        uniquePlaces: 0,
    });

    // Measure encoded by the sunburst + pies. The constellation and color-by are
    // unaffected; the indicator bar always shows the full picture regardless.
    type Measure = 'time' | 'km' | 'points';
    let measure = $state<Measure>('time');
    const MEASURES: MeasureOption[] = [
        { key: 'time', label: 'Time', hint: 'Weighted by hours spent' },
        { key: 'km', label: 'Distance', hint: 'Weighted by kilometres covered' },
        { key: 'points', label: 'Points', hint: 'One unit per recorded point' },
    ];

    function measureOf(m: Measure, p: LocationBasePoint): number {
        switch (m) {
            case 'km':
                return p.distanceMeters / 1000;
            case 'points':
                return 1;
            default:
                return p.presenceMins;
        }
    }

    function measureValue(p: LocationBasePoint): number {
        return measureOf(measure, p);
    }

    // Per-point weight for the constellation's temporal satellite bars. A fresh
    // closure on each measure change so the bars recompute/redraw.
    const barValue = $derived.by(() => {
        const m = measure;
        return (p: ConnectablePoint) => measureOf(m, p as LocationBasePoint);
    });

    function formatMeasure(v: number): string {
        if (measure === 'km') return `${Math.round(v).toLocaleString()} km`;
        if (measure === 'points') return Math.round(v).toLocaleString();
        return formatDuration(v);
    }

    let initialLoad = $state(true);
    let containerWidth = $state(0);
    let containerHeight = $state(0);
    let sunburstWidth = $state(0);
    let sunburstHeight = $state(0);
    let viewportHeight = $state(0);
    let timeDomain = $state<[number, number] | null>(null);

    // Geo hierarchy of the sunburst (country → region → department → city), built
    // in JS from the base points like the pies (cf. computeSunburstTree).
    let sunburstTree = $state.raw<SunburstNode>({ name: 'All locations' });
    let prevSunburstSig = '';

    const pieSize = $derived(Math.max(56, Math.min(120, Math.round(viewportHeight * 0.1) - 20)));

    let baseSeq = 0;
    let prevMatchSig = '';
    const FILTER_SYNC_THROTTLE_MS = 110;

    let viewTimeDomain = $state.raw<[number, number] | null>(null);
    let viewHourDomain = $state.raw<[number, number] | null>(null);

    const module = moduleById('positions');
    const activeFilters = $derived(positionsExplorerFilters.activeFilters);
    const dbReady = $derived(dataStore.loaded.positions && !dataStore.isLoading);
    // Zone attribution runs in the background after the import unblocks, so the
    // sunburst (the only geo-dependent view here) waits on it while everything
    // else is already live.
    const geoReady = $derived(dataStore.geoReady);
    const geoFailed = $derived(dataStore.geo?.status === 'failed');

    // --- Dimensions ------------------------------------------------------
    type DimField = keyof LocationBasePoint;
    type MatchDim = ValueDimension<LocationBasePoint>;
    const MATCH_DIMS: MatchDim[] = [
        { key: 'source', field: 'fSource' },
        { key: 'segment_type', field: 'fSegmentType' },
        { key: 'activity_type', field: 'fActivityType' },
        { key: 'semantic_type', field: 'fSemanticType' },
        { key: 'speed', field: 'fSpeed' },
        { key: 'azimuth', field: 'fAzimuth' },
        { key: 'novelty', field: 'fNovelty' },
        { key: 'dayofweek', field: 'dow' },
        { key: 'year', field: 'year' },
        // Geo dims drive the sunburst's cross-filtering (constellation + pies).
        { key: 'country', field: 'country' },
        { key: 'region', field: 'region' },
        { key: 'department', field: 'department' },
        { key: 'nearest_city', field: 'nearestCity' },
        { key: 'arrondissement', field: 'arrondissement' },
    ];

    // Sunburst hierarchy config: depth (1-based) → store filter key, and the keys
    // the sunburst owns (excluded from its OWN data so it stays full under them).
    const GEO_KEY_BY_DEPTH = {
        1: 'country',
        2: 'region',
        3: 'department',
        4: 'nearest_city',
        5: 'arrondissement',
    };
    const GEO_OTHER_LABELS = [
        'Other countries',
        'Other regions',
        'Other departments',
        'Other cities',
        'Other arrondissements',
    ];
    const GEO_KEYS = new Set(['country', 'region', 'department', 'nearest_city', 'arrondissement']);

    interface PieDim extends MatchDim {
        label: string;
        format?: (v: string) => string;
    }
    const PIE_DIMS: PieDim[] = [
        // First, because it is the one dimension that says which of two very
        // differently-shaped recordings a point came from: a phone logs one a
        // minute, a watch one a second while an activity runs.
        {
            key: 'source',
            field: 'fSource',
            label: 'Source',
            format: sourceLabel,
        },
        { key: 'segment_type', field: 'fSegmentType', label: 'Segment type' },
        { key: 'activity_type', field: 'fActivityType', label: 'Activity' },
        { key: 'semantic_type', field: 'fSemanticType', label: 'Place type' },
        { key: 'speed', field: 'fSpeed', label: 'Speed (km/h)' },
        { key: 'azimuth', field: 'fAzimuth', label: 'Direction' },
        { key: 'novelty', field: 'fNovelty', label: 'Novelty' },
        { key: 'year', field: 'year', label: 'Year' },
        {
            key: 'dayofweek',
            field: 'dow',
            label: 'Day of week',
            format: dowLabel,
        },
    ];

    const TOP_N = 15;

    // Spatial slot: the constellation stays fixed; this slot toggles between the
    // geo sunburst and the interactive map (both read the same basePoints/matchVersion).
    let spatialView = $state<'sunburst' | 'map'>('map');

    // The map's committed viewport (lon/lat box), emitted on pan/zoom end. Folded
    // into `matched` so the constellation + pies + indicators reflect the map's
    // geographic zoom, like a range window. Null when the map isn't shown.
    let viewGeoBounds = $state.raw<MapBounds | null>(null);

    // --- Coloring by dimension -------------------------------------------
    let colorBy = $state<string | null>(null);
    const colorByDim = $derived(colorBy ? (PIE_DIMS.find((d) => d.key === colorBy) ?? null) : null);
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

    // --- Tooltip ---------------------------------------------------------
    // The `timestamp` column is the LOCAL wall-clock time (cf. sources/googleTimeline/parse);
    // "YYYY-MM-DD HH:MM:SS" with no zone suffix is read by new Date() as local.
    function formatPlayedAt(playedAt: string): string {
        const d = new Date(playedAt.replace(' ', 'T'));
        return Number.isNaN(d.getTime()) ? playedAt : d.toLocaleString();
    }
    /** Geo breakdown line, most specific → least, deduped (city == department). */
    function geoLine(m: Record<string, unknown>): string {
        const parts = [m.arrondissement, m.nearestCity, m.department, m.region, m.country]
            .map((v) => (v == null ? '' : String(v)))
            .filter((v) => v && v !== 'Unknown');
        return parts.filter((v, i) => v !== parts[i - 1]).join(' · ');
    }

    function constellationTooltip(m: Record<string, unknown>) {
        const seg = m.segmentType as string;
        const detail =
            seg === 'stationary' ? (m.semanticType as string) : (m.activityType as string);
        const title =
            detail && detail !== 'Unknown' ? detail : seg === 'stationary' ? 'Visit' : 'Move';
        const lines = [
            formatPlayedAt(m.playedAt as string),
            formatDuration(Number(m.durationMinutes) || 0),
        ];
        const location = geoLine(m);
        if (location) lines.push(location);
        return { title, lines };
    }

    /** Every value filter in force, as a test per dimension. */
    function filterTests(f: FilterState): CrossfilterTest<LocationBasePoint>[] {
        return valueTests(f, MATCH_DIMS);
    }

    /** The brush window, plus the map's viewport box when the map is shown. */
    function inView(p: LocationBasePoint, gb: MapBounds | null): boolean {
        return (
            inWindow(p, { time: viewTimeDomain, hour: viewHourDomain }) &&
            !(gb && outOfGeoBox(p, gb))
        );
    }

    function matchSig(f: FilterState, gb: MapBounds | null): string {
        return JSON.stringify([MATCH_DIMS.map((d) => f[d.key] ?? null), gb]);
    }

    /** True when a point falls outside the map's viewport box (or has no coords). */
    function outOfGeoBox(p: LocationBasePoint, gb: MapBounds): boolean {
        const lon = p.metadata.lon as number;
        const lat = p.metadata.lat as number;
        if (typeof lon !== 'number' || typeof lat !== 'number') return true;
        if (Number.isNaN(lon) || Number.isNaN(lat)) return true;
        return lon < gb[0][0] || lon > gb[1][0] || lat < gb[0][1] || lat > gb[1][1];
    }

    function computeMatched() {
        const tests = filterTests(positionsExplorerFilters.activeFilters);
        const pts = basePoints;
        const gb = viewGeoBounds;
        for (let i = 0; i < pts.length; i++) {
            const p = pts[i];
            const dims = passesAll(p, tests);
            // Dimension-only match (trail basis); `matched` also folds in the
            // map's viewport box, as before.
            p.matchedDims = dims;
            p.matched = dims && !(gb && outOfGeoBox(p, gb));
        }
        matchVersion += 1;
    }

    function topNSlices(
        acc: Map<string, { minutes: number; plays: number; amount: number }>
    ): DimensionSlice[] {
        const sorted = [...acc.entries()]
            .map(([value, v]) => ({ value, minutes: v.minutes, plays: v.plays, amount: v.amount }))
            .sort((a, b) => b.amount - a.amount);
        const slices = sorted.slice(0, TOP_N);
        const rest = sorted.slice(TOP_N);
        if (rest.length) {
            const om = rest.reduce((s, x) => s + x.minutes, 0);
            const op = rest.reduce((s, x) => s + x.plays, 0);
            const oa = rest.reduce((s, x) => s + x.amount, 0);
            if (oa > 0) slices.push({ value: 'Other', minutes: om, plays: op, amount: oa });
        }
        return slices;
    }

    // Breakdown of all pies in a single JS pass (each pie excludes its own
    // filter; the brush's time/hour window applies everywhere).
    function computeAllPieSlices() {
        const pts = basePoints;
        const next: Record<string, DimensionSlice[]> = {};
        if (pts.length === 0) {
            for (const pd of PIE_DIMS) next[pd.key] = [];
            pieSlices = next;
            return;
        }
        const tests = filterTests(positionsExplorerFilters.activeFilters);
        const gb = viewGeoBounds;
        const maps: Record<
            string,
            Map<string, { minutes: number; plays: number; amount: number }>
        > = {};
        for (const pd of PIE_DIMS) maps[pd.key] = new Map();

        for (let i = 0; i < pts.length; i++) {
            const p = pts[i];
            if (!inView(p, gb)) continue;
            // Each pie ignores its own filter (see `soleFailure`).
            const failed = soleFailure(p, tests);
            if (failed === false) continue;

            for (const pd of PIE_DIMS) {
                if (failed !== null && failed !== pd.key) continue;
                const m = maps[pd.key];
                const key = p[pd.field] as string;
                let e = m.get(key);
                if (!e) {
                    e = { minutes: 0, plays: 0, amount: 0 };
                    m.set(key, e);
                }
                e.minutes += p.mins;
                e.plays += 1;
                e.amount += measureValue(p);
            }
        }

        for (const pd of PIE_DIMS) next[pd.key] = topNSlices(maps[pd.key]);
        pieSlices = next;
    }

    // Indicators: a strict JS pass (all active dimensions must pass) + the brush
    // window. Distances/durations summed over the retained segments.
    function computeMacro() {
        const pts = basePoints;
        const tests = filterTests(positionsExplorerFilters.activeFilters);
        const gb = viewGeoBounds;
        let segs = 0;
        let mins = 0;
        let meters = 0;
        const places = new Set<string>();
        for (let i = 0; i < pts.length; i++) {
            const p = pts[i];
            if (!inView(p, gb) || !passesAll(p, tests)) continue;
            segs++;
            mins += p.presenceMins;
            meters += p.distanceMeters;
            if (p.placeId) places.add(p.placeId);
        }
        macroStats = {
            totalSegments: segs,
            totalMinutes: mins,
            totalKm: meters / 1000,
            uniquePlaces: places.size,
        };
    }

    // Sunburst data: aggregate base points into a country→region→department→city
    // tree, in JS like the pies. It EXCLUDES the geo dims from its own filter (so
    // selecting a zone keeps the hierarchy full, the selection is shown via zoom/
    // highlight) but respects every other active dim + the brush window.
    function computeSunburstTree(): SunburstNode {
        const pts = basePoints;
        const tests = filterTests(positionsExplorerFilters.activeFilters).filter(
            (t) => !GEO_KEYS.has(t.key)
        );
        const window = { time: viewTimeDomain, hour: viewHourDomain };
        const agg = new Map<string, { levels: PathLevel[]; value: number }>();

        // depth → (filter key, point field). Levels are compacted (absent ones
        // skipped), so a foreign point becomes country → region → city even
        // without a department; the level's key drives cross-filtering.
        const LEVELS: { key: string; field: DimField }[] = [
            { key: 'country', field: 'country' },
            { key: 'region', field: 'region' },
            { key: 'department', field: 'department' },
            { key: 'nearest_city', field: 'nearestCity' },
            { key: 'arrondissement', field: 'arrondissement' },
        ];

        for (let i = 0; i < pts.length; i++) {
            const p = pts[i];
            // The sunburst ignores the map box: it is the other half of the spatial slot.
            if (!inWindow(p, window) || !passesAll(p, tests)) continue;

            if (p.country === 'Unknown') continue; // no country → outside the geo hierarchy
            const levels: PathLevel[] = [];
            for (const lvl of LEVELS) {
                const name = p[lvl.field] as string;
                if (name && name !== 'Unknown') levels.push({ name, key: lvl.key });
            }
            const mapKey = levels.map((l) => l.name).join('\u0000');
            let e = agg.get(mapKey);
            if (!e) {
                e = { levels, value: 0 };
                agg.set(mapKey, e);
            }
            e.value += measureValue(p);
        }

        const rows = [...agg.values()].map((e) => ({ levels: e.levels, value: e.value }));
        return buildPathHierarchy(rows, 'All locations');
    }

    /** Signature of inputs affecting the sunburst DATA (geo dims excluded). */
    function sunburstSig(): string {
        const f = positionsExplorerFilters.activeFilters;
        const rest: FilterState = {};
        for (const k in f) if (!GEO_KEYS.has(k)) rest[k] = f[k];
        // geoVersion: the points are patched in place, so nothing else in this
        // signature changes when the attribution lands.
        return JSON.stringify([rest, basePoints.length, measure, dataStore.geoVersion]);
    }

    function maybeRecomputeSunburst() {
        const sig = sunburstSig();
        if (sig === prevSunburstSig) return;
        prevSunburstSig = sig;
        sunburstTree = computeSunburstTree();
    }

    let recomputeRaf = 0;
    function scheduleRecompute() {
        if (recomputeRaf) return;
        recomputeRaf = requestAnimationFrame(() => {
            recomputeRaf = 0;
            computeAllPieSlices();
            computeMacro();
            maybeRecomputeSunburst();
        });
    }

    async function loadBasePoints() {
        baseSeq += 1;
        const runId = baseSeq;
        try {
            const [nextPoints, domain] = await Promise.all([
                getPositionsExplorerBasePoints(),
                getPositionsConstellationTimeDomain(),
            ]);
            if (runId !== baseSeq) return;
            if (domain) timeDomain = [domain.minX, domain.maxX];
            basePoints = nextPoints;
            prevMatchSig = matchSig(positionsExplorerFilters.activeFilters, viewGeoBounds);
            computeMatched();
        } catch (e) {
            console.error('Error loading constellation base points:', e);
        } finally {
            if (runId === baseSeq && initialLoad) initialLoad = false;
        }
    }

    function resetState() {
        baseSeq += 1;
        basePoints = [];
        matchVersion = 0;
        pieSlices = {};
        macroStats = {
            totalSegments: 0,
            totalMinutes: 0,
            totalKm: 0,
            uniquePlaces: 0,
        };
        initialLoad = true;
        prevMatchSig = '';
        sunburstTree = { name: 'All locations' };
        prevSunburstSig = '';
        patchedGeoVersion = 0;
    }

    // Loading the points: ONCE when the source is ready.
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

    // Background attribution landed: fold the geo columns into the points already
    // loaded, then let the sunburst and the tooltips pick them up.
    let patchedGeoVersion = 0;
    $effect(() => {
        const version = dataStore.geoVersion;
        const pts = basePoints;
        // Both are tracked: attribution can land before the points are loaded,
        // and the patch must then wait for them (the base query may itself have
        // read the columns mid-attribution).
        if (!dbReady || version === 0 || pts.length === 0) return;
        if (version === patchedGeoVersion) return;
        patchedGeoVersion = version;
        void (async () => {
            await patchGeoAttributes(pts);
            computeMatched();
            scheduleRecompute();
        })();
    });

    // Highlight: JS recompute of `matched` when the selection or the map's
    // geographic viewport changes.
    $effect(() => {
        if (!dbReady) return;
        const sig = matchSig(activeFilters, viewGeoBounds);
        untrack(() => {
            if (sig === prevMatchSig) return;
            prevMatchSig = sig;
            if (basePoints.length === 0) return;
            computeMatched();
        });
    });

    // Pies + macro: immediate JS recompute whenever points/selection/window change.
    $effect(() => {
        const _b = basePoints;
        const _m = matchVersion;
        const _t = viewTimeDomain;
        const _h = viewHourDomain;
        const _g = viewGeoBounds;
        const _ms = measure;
        if (!dbReady) return;
        scheduleRecompute();
    });

    // Leaving the map drops its geographic filter so the other views go full again.
    $effect(() => {
        if (spatialView !== 'map') {
            viewGeoBounds = null;
            mapFitted = false;
        }
    });

    // The map fits to the data on load, which emits a viewport before anyone has
    // touched it — only the moves after that one are a real geographic filter.
    let mapFitted = false;

    function onMapViewport(bounds: MapBounds) {
        viewGeoBounds = bounds;
        if (!mapFitted) {
            mapFitted = true;
            return;
        }
        trackThrottled('filter-set', 'map_viewport', {
            dimension: 'map_viewport',
            origin: 'map',
        });
    }

    // Sync brush → filtres globaux (throttle leading + trailing).
    let timeRangeSyncTimer: ReturnType<typeof setTimeout> | null = null;
    let hourRangeSyncTimer: ReturnType<typeof setTimeout> | null = null;
    let lastTimeSync = 0;
    let lastHourSync = 0;

    function applyRangeFilter(key: 'timestamp' | 'hour_of_day', view: [number, number] | null) {
        if (view) {
            positionsExplorerFilters.setFilter(
                key,
                { min: view[0], max: view[1] },
                'constellation'
            );
        } else {
            positionsExplorerFilters.removeFilter(key, 'constellation');
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
        if (recomputeRaf) cancelAnimationFrame(recomputeRaf);
        if (timeRangeSyncTimer) clearTimeout(timeRangeSyncTimer);
        if (hourRangeSyncTimer) clearTimeout(hourRangeSyncTimer);
    });

    const indicators = $derived<Indicator[]>([
        { value: formatDurationLong(macroStats.totalMinutes), label: 'time' },
        { value: `${Math.round(macroStats.totalKm).toLocaleString()} km`, label: 'distance' },
        { value: macroStats.uniquePlaces.toLocaleString(), label: 'unique places' },
        { value: macroStats.totalSegments.toLocaleString(), label: 'segments' },
    ]);
</script>

<svelte:window bind:innerHeight={viewportHeight} />

<div class="explorer-page">
    {#if !dbReady}
        <ModuleEmptyState {module} />
    {:else}
        <div class="header-bar">
            <ExplorerIndicators items={indicators} />

            <div class="header-right">
                {#if positionsExplorerFilters.hasActiveFilters}
                    <ClearFiltersButton onclick={() => positionsExplorerFilters.clearAll()} />
                {/if}
            </div>
        </div>

        <section class="explorer-grid" aria-label="Google Maps explorer layout">
            <article class="chart-placeholder constellation">
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

            <aside class="chart-placeholder sunburst" aria-label="Spatial view">
                <div class="spatial-header">
                    <div class="measure-toggle" role="group" aria-label="Spatial view">
                        <button
                            type="button"
                            class="measure-btn"
                            class:active={spatialView === 'sunburst'}
                            aria-pressed={spatialView === 'sunburst'}
                            title={geoReady
                                ? undefined
                                : geoFailed
                                  ? 'Location details unavailable'
                                  : 'Still locating your points…'}
                            onclick={() => {
                                trackControl('maps-explorer', 'spatial-view', 'sunburst');
                                spatialView = 'sunburst';
                            }}
                        >
                            Sunburst
                        </button>
                        <button
                            type="button"
                            class="measure-btn"
                            class:active={spatialView === 'map'}
                            aria-pressed={spatialView === 'map'}
                            onclick={() => {
                                trackControl('maps-explorer', 'spatial-view', 'map');
                                spatialView = 'map';
                            }}
                        >
                            Map
                        </button>
                    </div>
                </div>
                <div
                    class="sunburst-host"
                    bind:clientWidth={sunburstWidth}
                    bind:clientHeight={sunburstHeight}
                >
                    {#if initialLoad}
                        <div
                            class="loading-wrapper relative w-full h-full flex items-center justify-center"
                        >
                            <LoadingOverlay message="Locating places..." />
                        </div>
                    {:else if sunburstWidth > 0 && sunburstHeight > 0}
                        {#if spatialView === 'map'}
                            <LocationMap
                                data={basePoints}
                                {matchVersion}
                                width={sunburstWidth}
                                height={sunburstHeight}
                                timeWindow={viewTimeDomain}
                                hourWindow={viewHourDomain}
                                onViewportChange={onMapViewport}
                                formatTooltip={constellationTooltip}
                                colorField={colorByDim?.field ?? null}
                                {colorCategories}
                            />
                        {:else if !geoReady}
                            <div class="geo-pending" role="status">
                                {#if geoFailed}
                                    <p>Location details unavailable.</p>
                                    <p class="geo-pending-hint">
                                        The map and the timeline above still work.
                                    </p>
                                {:else}
                                    <p>Locating your points…</p>
                                    <p class="geo-pending-hint">
                                        {dataStore.geo?.message ?? 'Preparing map data…'}
                                    </p>
                                    <div class="geo-pending-track">
                                        <div
                                            class="geo-pending-fill"
                                            style:width={`${Math.round((dataStore.geo?.progress ?? 0) * 100)}%`}
                                        ></div>
                                    </div>
                                {/if}
                            </div>
                        {:else}
                            <SunburstExplorer
                                data={sunburstTree}
                                width={sunburstWidth}
                                height={sunburstHeight}
                                filters={positionsExplorerFilters}
                                keyByDepth={GEO_KEY_BY_DEPTH}
                                rootLabel="All locations"
                                formatValue={formatMeasure}
                                otherLabels={GEO_OTHER_LABELS}
                                testId="location-sunburst-explorer"
                            />
                        {/if}
                    {/if}
                </div>
            </aside>
        </section>

        {#if !initialLoad}
            <section class="dimensions-row" aria-label="Dimension breakdowns">
                <MeasureToggle
                    options={MEASURES}
                    value={measure}
                    onChange={(key) => {
                        trackControl('maps-explorer', 'measure', key);
                        measure = key as Measure;
                    }}
                />
                <div class="dimensions-divider" aria-hidden="true"></div>

                {#each PIE_DIMS as pd (pd.key)}
                    <DimensionPie
                        title={pd.label}
                        filterKey={pd.key}
                        slices={pieSlices[pd.key] ?? []}
                        size={pieSize}
                        format={pd.format}
                        sliceValue={(s) => s.amount ?? s.minutes}
                        formatValue={formatMeasure}
                        selectedValue={firstFilterValue(activeFilters, pd.key)}
                        onSelect={(v) =>
                            v === null
                                ? positionsExplorerFilters.removeFilter(pd.key, 'pie')
                                : positionsExplorerFilters.setFilter(pd.key, v, 'pie')}
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

    .header-right {
        display: flex;
        align-items: center;
        gap: 0.65rem;
    }

    .measure-toggle {
        display: inline-flex;
        border: 1px solid var(--border, hsl(var(--border)));
        border-radius: var(--radius-md);
        overflow: hidden;
    }

    .measure-btn {
        padding: 0.4rem 0.7rem;
        font-size: var(--text-small);
        cursor: pointer;
        color: hsl(var(--muted-foreground));
        background: transparent;
        border: none;
        border-left: 1px solid var(--border, hsl(var(--border)));
        transition:
            color 0.18s ease,
            background-color 0.18s ease;
    }

    .measure-btn:first-child {
        border-left: none;
    }

    .measure-btn:hover {
        color: hsl(var(--foreground));
    }

    .measure-btn.active {
        color: hsl(var(--foreground));
        background: color-mix(in srgb, hsl(var(--foreground)) 12%, transparent);
        font-weight: 600;
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

    .spatial-header {
        flex: none;
        display: flex;
        justify-content: flex-end;
    }

    .sunburst-host {
        width: 100%;
        flex: 1;
        min-height: 0;
        display: flex;
        align-items: center;
        justify-content: center;
    }

    .geo-pending {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.35rem;
        max-width: 18rem;
        text-align: center;
        font-size: var(--text-body);
        color: hsl(var(--muted-foreground));
    }

    .geo-pending-hint {
        font-size: var(--text-small);
        opacity: 0.75;
        font-variant-numeric: tabular-nums;
    }

    .geo-pending-track {
        width: 100%;
        height: 3px;
        margin-top: 0.35rem;
        border-radius: var(--radius-pill);
        overflow: hidden;
        background: hsl(var(--secondary) / 0.6);
    }

    .geo-pending-fill {
        height: 100%;
        border-radius: var(--radius-pill);
        background: hsl(var(--primary));
        transition: width 0.4s ease;
    }

    /* Below a certain width, stack constellation + sunburst (cf. Spotify). */
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
