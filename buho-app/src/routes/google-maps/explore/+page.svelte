<script lang="ts">
    import { onDestroy, untrack } from "svelte";
    import ConstellationChart from "$lib/components/visualizations/ConstellationChart.svelte";
    import DimensionPie from "$lib/components/visualizations/DimensionPie.svelte";
    import SunburstExplorer from "$lib/components/visualizations/SunburstExplorer.svelte";
    import LocationMap from "$lib/components/visualizations/LocationMap.svelte";
    import {
        getGoogleMapsConstellationTimeDomain,
        getGoogleMapsExplorerBasePoints,
        type LocationBasePoint,
    } from "$lib/data/queries/googleMapsQueries";
    import type { ConnectablePoint } from "$lib/data/queries/behaviorQueries";
    import {
        buildPathHierarchy,
        type PathLevel,
        type SunburstNode,
    } from "$lib/visualizations/sunburstHierarchy";
    import type { DimensionSlice } from "$lib/data/queries/dimensionQueries";
    import type { FilterScalar, FilterState } from "$lib/types/filters";
    import LoadingOverlay from "$lib/components/LoadingOverlay.svelte";
    import { dataStore } from "$lib/stores/dataStore.svelte";
    import { googleMapsExplorerFilters } from "$lib/stores/googleMapsExplorerFilters.svelte";
    import { formatDuration, formatDurationLong } from "$lib/utils/duration";
    import { firstFilterValue } from "$lib/utils/filters";
    import { stickyColor } from "$lib/utils/dimensionColors";

    // Points loaded ONCE (raw). `matched` recomputed in JS in place, `matchVersion`
    // triggers a redraw without rebuilding the quadtree (cf. /spotify/explore).
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
    type Measure = "time" | "km" | "points";
    let measure = $state<Measure>("time");
    const MEASURES: { key: Measure; label: string }[] = [
        { key: "time", label: "time" },
        { key: "km", label: "km" },
        { key: "points", label: "points" },
    ];

    function measureOf(m: Measure, p: LocationBasePoint): number {
        switch (m) {
            case "km":
                return p.distanceMeters / 1000;
            case "points":
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
        if (measure === "km") return `${Math.round(v).toLocaleString()} km`;
        if (measure === "points") return Math.round(v).toLocaleString();
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
    let sunburstTree = $state.raw<SunburstNode>({ name: "All locations" });
    let prevSunburstSig = "";

    const pieSize = $derived(
        Math.max(56, Math.min(120, Math.round(viewportHeight * 0.1) - 20)),
    );

    let baseSeq = 0;
    let prevMatchSig = "";
    const FILTER_SYNC_THROTTLE_MS = 110;

    let viewTimeDomain = $state<[number, number] | null>(null);
    let viewHourDomain = $state<[number, number] | null>(null);

    const activeFilters = $derived(googleMapsExplorerFilters.activeFilters);
    const dbReady = $derived(
        dataStore.source === "google-maps" && !dataStore.isLoading,
    );

    /** Set<string> of a filter's values, or null if not applicable (range, etc.). */
    function filterValueSet(f: FilterState, key: string): Set<string> | null {
        const v = f[key];
        if (v === undefined || v === null) return null;
        if (v instanceof Set) return new Set([...v].map(String));
        if (Array.isArray(v)) return new Set(v.map((x) => String(x)));
        if (typeof v === "object") return null;
        return new Set([String(v as FilterScalar)]);
    }

    // --- Dimensions ------------------------------------------------------
    type DimField = keyof LocationBasePoint;
    interface MatchDim {
        key: string;
        field: DimField;
    }
    const MATCH_DIMS: MatchDim[] = [
        { key: "segment_type", field: "fSegmentType" },
        { key: "activity_type", field: "fActivityType" },
        { key: "semantic_type", field: "fSemanticType" },
        { key: "dayofweek", field: "dow" },
        { key: "year", field: "year" },
        // Geo dims drive the sunburst's cross-filtering (constellation + pies).
        { key: "country", field: "country" },
        { key: "region", field: "region" },
        { key: "department", field: "department" },
        { key: "nearest_city", field: "nearestCity" },
        { key: "arrondissement", field: "arrondissement" },
    ];

    // Sunburst hierarchy config: depth (1-based) → store filter key, and the keys
    // the sunburst owns (excluded from its OWN data so it stays full under them).
    const GEO_KEY_BY_DEPTH = {
        1: "country",
        2: "region",
        3: "department",
        4: "nearest_city",
        5: "arrondissement",
    };
    const GEO_OTHER_LABELS = [
        "Other countries",
        "Other regions",
        "Other departments",
        "Other cities",
        "Other arrondissements",
    ];
    const GEO_KEYS = new Set([
        "country",
        "region",
        "department",
        "nearest_city",
        "arrondissement",
    ]);

    function dowLabel(v: string): string {
        // DuckDB DAYOFWEEK : 0 = dimanche … 6 = samedi.
        const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
        const n = Number(v);
        return Number.isInteger(n) && n >= 0 && n < 7 ? names[n] : v;
    }

    interface PieDim extends MatchDim {
        label: string;
        format?: (v: string) => string;
    }
    const PIE_DIMS: PieDim[] = [
        { key: "segment_type", field: "fSegmentType", label: "Segment type" },
        { key: "activity_type", field: "fActivityType", label: "Activity" },
        { key: "semantic_type", field: "fSemanticType", label: "Place type" },
        { key: "year", field: "year", label: "Year" },
        {
            key: "dayofweek",
            field: "dow",
            label: "Day of week",
            format: dowLabel,
        },
    ];

    const TOP_N = 15;

    // Spatial slot: the constellation stays fixed; this slot toggles between the
    // geo sunburst and the interactive map (both read the same basePoints/matchVersion).
    let spatialView = $state<"sunburst" | "map">("sunburst");

    // --- Coloring by dimension -------------------------------------------
    let colorBy = $state<string | null>(null);
    const colorByDim = $derived(
        colorBy ? (PIE_DIMS.find((d) => d.key === colorBy) ?? null) : null,
    );
    const colorCategories = $derived(
        colorBy
            ? (pieSlices[colorBy] ?? []).map((s) => ({
                  value: s.value,
                  color: stickyColor(colorBy as string, s.value),
              }))
            : [],
    );
    function toggleColorBy(key: string) {
        colorBy = colorBy === key ? null : key;
    }

    // --- Tooltip ---------------------------------------------------------
    // The `timestamp` column is the LOCAL wall-clock time (cf. parseGoogleMaps);
    // "YYYY-MM-DD HH:MM:SS" with no zone suffix is read by new Date() as local.
    function formatPlayedAt(playedAt: string): string {
        const d = new Date(playedAt.replace(" ", "T"));
        return Number.isNaN(d.getTime()) ? playedAt : d.toLocaleString();
    }
    /** Geo breakdown line, most specific → least, deduped (city == department). */
    function geoLine(m: Record<string, unknown>): string {
        const parts = [m.arrondissement, m.nearestCity, m.department, m.region, m.country]
            .map((v) => (v == null ? "" : String(v)))
            .filter((v) => v && v !== "Unknown");
        return parts.filter((v, i) => v !== parts[i - 1]).join(" · ");
    }

    function constellationTooltip(m: Record<string, unknown>) {
        const seg = m.segmentType as string;
        const detail =
            seg === "stationary"
                ? (m.semanticType as string)
                : (m.activityType as string);
        const title =
            detail && detail !== "Unknown"
                ? detail
                : seg === "stationary"
                  ? "Visit"
                  : "Move";
        const lines = [
            formatPlayedAt(m.playedAt as string),
            formatDuration(Number(m.durationMinutes) || 0),
        ];
        const location = geoLine(m);
        if (location) lines.push(location);
        return { title, lines };
    }

    /** Currently filtered dimensions + their Set of values. */
    function activeDims(f: FilterState) {
        const out: { key: string; field: DimField; vals: Set<string> }[] = [];
        for (const d of MATCH_DIMS) {
            const vals = filterValueSet(f, d.key);
            if (vals) out.push({ key: d.key, field: d.field, vals });
        }
        return out;
    }

    function matchSig(f: FilterState): string {
        return JSON.stringify(MATCH_DIMS.map((d) => f[d.key] ?? null));
    }

    function computeMatched() {
        const active = activeDims(googleMapsExplorerFilters.activeFilters);
        const pts = basePoints;
        for (let i = 0; i < pts.length; i++) {
            const p = pts[i];
            let m = true;
            for (const d of active) {
                if (!d.vals.has(p[d.field] as string)) {
                    m = false;
                    break;
                }
            }
            p.matched = m;
        }
        matchVersion += 1;
    }

    function topNSlices(
        acc: Map<string, { minutes: number; plays: number; amount: number }>,
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
            if (oa > 0) slices.push({ value: "Other", minutes: om, plays: op, amount: oa });
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
        const active = activeDims(googleMapsExplorerFilters.activeFilters);
        const tWin = viewTimeDomain;
        const hWin = viewHourDomain;
        const maps: Record<
            string,
            Map<string, { minutes: number; plays: number; amount: number }>
        > = {};
        for (const pd of PIE_DIMS) maps[pd.key] = new Map();

        for (let i = 0; i < pts.length; i++) {
            const p = pts[i];
            if (tWin && (p.x < tWin[0] || p.x > tWin[1])) continue;
            if (hWin && (p.y < hWin[0] || p.y > hWin[1])) continue;

            let fails = 0;
            let failedKey = "";
            for (const d of active) {
                if (!d.vals.has(p[d.field] as string)) {
                    fails++;
                    if (fails > 1) break;
                    failedKey = d.key;
                }
            }
            if (fails > 1) continue;

            for (const pd of PIE_DIMS) {
                if (fails === 1 && failedKey !== pd.key) continue;
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
        const active = activeDims(googleMapsExplorerFilters.activeFilters);
        const tWin = viewTimeDomain;
        const hWin = viewHourDomain;
        let segs = 0;
        let mins = 0;
        let meters = 0;
        const places = new Set<string>();
        for (let i = 0; i < pts.length; i++) {
            const p = pts[i];
            if (tWin && (p.x < tWin[0] || p.x > tWin[1])) continue;
            if (hWin && (p.y < hWin[0] || p.y > hWin[1])) continue;
            let ok = true;
            for (const d of active) {
                if (!d.vals.has(p[d.field] as string)) {
                    ok = false;
                    break;
                }
            }
            if (!ok) continue;
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
        const active = activeDims(
            googleMapsExplorerFilters.activeFilters,
        ).filter((d) => !GEO_KEYS.has(d.key));
        const tWin = viewTimeDomain;
        const hWin = viewHourDomain;
        const agg = new Map<string, { levels: PathLevel[]; value: number }>();

        // depth → (filter key, point field). Levels are compacted (absent ones
        // skipped), so a foreign point becomes country → region → city even
        // without a department; the level's key drives cross-filtering.
        const LEVELS: { key: string; field: DimField }[] = [
            { key: "country", field: "country" },
            { key: "region", field: "region" },
            { key: "department", field: "department" },
            { key: "nearest_city", field: "nearestCity" },
            { key: "arrondissement", field: "arrondissement" },
        ];

        for (let i = 0; i < pts.length; i++) {
            const p = pts[i];
            if (tWin && (p.x < tWin[0] || p.x > tWin[1])) continue;
            if (hWin && (p.y < hWin[0] || p.y > hWin[1])) continue;
            let ok = true;
            for (const d of active) {
                if (!d.vals.has(p[d.field] as string)) {
                    ok = false;
                    break;
                }
            }
            if (!ok) continue;

            if (p.country === "Unknown") continue; // no country → outside the geo hierarchy
            const levels: PathLevel[] = [];
            for (const lvl of LEVELS) {
                const name = p[lvl.field] as string;
                if (name && name !== "Unknown") levels.push({ name, key: lvl.key });
            }
            const mapKey = levels.map((l) => l.name).join(" ");
            let e = agg.get(mapKey);
            if (!e) {
                e = { levels, value: 0 };
                agg.set(mapKey, e);
            }
            e.value += measureValue(p);
        }

        const rows = [...agg.values()].map((e) => ({ levels: e.levels, value: e.value }));
        return buildPathHierarchy(rows, "All locations");
    }

    /** Signature of inputs affecting the sunburst DATA (geo dims excluded). */
    function sunburstSig(): string {
        const f = googleMapsExplorerFilters.activeFilters;
        const rest: FilterState = {};
        for (const k in f) if (!GEO_KEYS.has(k)) rest[k] = f[k];
        return JSON.stringify([rest, basePoints.length, measure]);
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
                getGoogleMapsExplorerBasePoints(),
                getGoogleMapsConstellationTimeDomain(),
            ]);
            if (runId !== baseSeq) return;
            if (domain) timeDomain = [domain.minX, domain.maxX];
            basePoints = nextPoints;
            prevMatchSig = matchSig(googleMapsExplorerFilters.activeFilters);
            computeMatched();
        } catch (e) {
            console.error("Error loading constellation base points:", e);
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
        prevMatchSig = "";
        sunburstTree = { name: "All locations" };
        prevSunburstSig = "";
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

    // Highlight: JS recompute of `matched` when the selection changes.
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

    // Pies + macro: immediate JS recompute whenever points/selection/window change.
    $effect(() => {
        const _b = basePoints;
        const _m = matchVersion;
        const _t = viewTimeDomain;
        const _h = viewHourDomain;
        const _ms = measure;
        if (!dbReady) return;
        scheduleRecompute();
    });

    // Sync brush → filtres globaux (throttle leading + trailing).
    let timeRangeSyncTimer: ReturnType<typeof setTimeout> | null = null;
    let hourRangeSyncTimer: ReturnType<typeof setTimeout> | null = null;
    let lastTimeSync = 0;
    let lastHourSync = 0;

    function applyRangeFilter(
        key: "timestamp" | "hour_of_day",
        view: [number, number] | null,
    ) {
        if (view) {
            googleMapsExplorerFilters.setFilter(key, {
                min: view[0],
                max: view[1],
            });
        } else {
            googleMapsExplorerFilters.removeFilter(key);
        }
    }

    $effect(() => {
        if (!dbReady || initialLoad) return;
        const currentView = viewTimeDomain;
        if (timeRangeSyncTimer) clearTimeout(timeRangeSyncTimer);
        const elapsed = performance.now() - lastTimeSync;
        if (elapsed >= FILTER_SYNC_THROTTLE_MS) {
            lastTimeSync = performance.now();
            applyRangeFilter("timestamp", currentView);
        } else {
            timeRangeSyncTimer = setTimeout(() => {
                lastTimeSync = performance.now();
                applyRangeFilter("timestamp", currentView);
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
            applyRangeFilter("hour_of_day", currentView);
        } else {
            hourRangeSyncTimer = setTimeout(() => {
                lastHourSync = performance.now();
                applyRangeFilter("hour_of_day", currentView);
            }, FILTER_SYNC_THROTTLE_MS - elapsed);
        }
    });

    onDestroy(() => {
        if (recomputeRaf) cancelAnimationFrame(recomputeRaf);
        if (timeRangeSyncTimer) clearTimeout(timeRangeSyncTimer);
        if (hourRangeSyncTimer) clearTimeout(hourRangeSyncTimer);
    });
</script>

<svelte:window bind:innerHeight={viewportHeight} />

<div class="explorer-page">
    {#if !dbReady}
        <div class="empty-state">
            <p>Upload your Google Maps Timeline export to explore it here.</p>
            <p class="empty-hint">
                Use the upload control in the header above.
            </p>
        </div>
    {:else}
        <div class="header-bar">
            <div class="indicators" aria-label="Global indicators">
                <div class="indicator">
                    <span class="indicator-value"
                        >{formatDurationLong(macroStats.totalMinutes)}</span
                    >
                    <span class="indicator-label">time</span>
                </div>
                <div class="indicator">
                    <span class="indicator-value"
                        >{Math.round(macroStats.totalKm).toLocaleString()} km</span
                    >
                    <span class="indicator-label">distance</span>
                </div>
                <div class="indicator">
                    <span class="indicator-value"
                        >{macroStats.uniquePlaces.toLocaleString()}</span
                    >
                    <span class="indicator-label">unique places</span>
                </div>
                <div class="indicator">
                    <span class="indicator-value"
                        >{macroStats.totalSegments.toLocaleString()}</span
                    >
                    <span class="indicator-label">segments</span>
                </div>
            </div>

            <div class="header-right">
                <div
                    class="measure-toggle"
                    role="group"
                    aria-label="Measure"
                >
                    {#each MEASURES as m (m.key)}
                        <button
                            type="button"
                            class="measure-btn"
                            class:active={measure === m.key}
                            aria-pressed={measure === m.key}
                            onclick={() => (measure = m.key)}
                        >
                            {m.label}
                        </button>
                    {/each}
                </div>

                {#if googleMapsExplorerFilters.hasActiveFilters}
                    <button
                        class="clear-filters-btn"
                        type="button"
                        onclick={() => googleMapsExplorerFilters.clearAll()}
                    >
                        Clear all filters
                    </button>
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
                    <div
                        class="measure-toggle"
                        role="group"
                        aria-label="Spatial view"
                    >
                        <button
                            type="button"
                            class="measure-btn"
                            class:active={spatialView === "sunburst"}
                            aria-pressed={spatialView === "sunburst"}
                            onclick={() => (spatialView = "sunburst")}
                        >
                            Sunburst
                        </button>
                        <button
                            type="button"
                            class="measure-btn"
                            class:active={spatialView === "map"}
                            aria-pressed={spatialView === "map"}
                            onclick={() => (spatialView = "map")}
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
                        {#if spatialView === "map"}
                            <LocationMap
                                data={basePoints}
                                {matchVersion}
                                width={sunburstWidth}
                                height={sunburstHeight}
                                formatTooltip={constellationTooltip}
                            />
                        {:else}
                            <SunburstExplorer
                                data={sunburstTree}
                                width={sunburstWidth}
                                height={sunburstHeight}
                                filters={googleMapsExplorerFilters}
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
                                ? googleMapsExplorerFilters.removeFilter(pd.key)
                                : googleMapsExplorerFilters.setFilter(pd.key, v)}
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

    .empty-state {
        flex: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 0.4rem;
        text-align: center;
        color: hsl(var(--muted-foreground));
    }

    .empty-hint {
        font-size: 0.8rem;
        opacity: 0.7;
    }

    .header-bar {
        flex: none;
        display: flex;
        align-items: center;
        justify-content: space-between;
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
        border-radius: 0.75rem;
        background: var(--bg-secondary, hsl(var(--card)));
    }

    .indicators {
        display: flex;
        gap: 1.5rem;
    }

    .indicator {
        display: flex;
        flex-direction: column;
        line-height: 1.1;
    }

    .indicator-value {
        font-size: 1.4rem;
        font-weight: 700;
        color: hsl(var(--foreground));
    }

    .indicator-label {
        font-size: 0.72rem;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: hsl(var(--muted-foreground));
    }

    .header-right {
        display: flex;
        align-items: center;
        gap: 0.65rem;
    }

    .measure-toggle {
        display: inline-flex;
        border: 1px solid var(--border, hsl(var(--border)));
        border-radius: 0.55rem;
        overflow: hidden;
    }

    .measure-btn {
        padding: 0.4rem 0.7rem;
        font-size: 0.78rem;
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

    .clear-filters-btn {
        border: 1px solid var(--border, hsl(var(--border)));
        border-radius: 0.55rem;
        padding: 0.45rem 0.85rem;
        font-size: 0.85rem;
        transition:
            border-color 0.18s ease,
            color 0.18s ease,
            background-color 0.18s ease;
        cursor: pointer;
        color: hsl(var(--muted-foreground));
        background: transparent;
    }

    .clear-filters-btn:hover {
        border-color: hsl(var(--foreground));
        color: hsl(var(--foreground));
    }

    .explorer-grid {
        flex: 1;
        min-height: 0;
        display: grid;
        gap: 1rem;
        grid-template-columns: 1.5fr 1fr;
        grid-template-rows: minmax(0, 1fr);
        grid-template-areas: "constellation sunburst";
    }

    .chart-placeholder {
        min-height: 0;
        border: 1px solid var(--border, hsl(var(--border)));
        border-radius: 0.75rem;
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
                "constellation"
                "sunburst";
        }

        .constellation-host {
            min-height: 26rem;
        }

        .sunburst-host {
            min-height: 26rem;
        }
    }
</style>
