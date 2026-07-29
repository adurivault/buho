<script lang="ts">
    import { onDestroy, untrack } from "svelte";
    import ConstellationChart from "$lib/components/visualizations/ConstellationChart.svelte";
    import ArtistSunburstExplorer from "$lib/components/visualizations/ArtistSunburstExplorer.svelte";
    import DimensionPie from "$lib/components/visualizations/DimensionPie.svelte";
    import {
        getConstellationTimeDomain,
        getExplorerBasePoints,
        getArtistSunburstFiltered,
        getExplorerMacroStats,
        type ExplorerBasePoint,
        type ArtistSunburstRow,
        type ExplorerMacroStats,
        type DimensionSlice,
    } from "$lib/data/queries/spotifyQueries";
    import type { FilterScalar, FilterState } from "$lib/types/filters";
    import LoadingOverlay from "$lib/components/LoadingOverlay.svelte";
    import { dataStore } from "$lib/stores/dataStore.svelte";
    import { spotifyExplorerFilters } from "$lib/stores/spotifyExplorerFilters.svelte";
    import { formatDurationLong } from "$lib/utils/duration";
    import { stickyColor } from "$lib/utils/dimensionColors";
    import { firstFilterValue } from "$lib/utils/filters";
    import { MODIFIER_LABEL, openSpotify } from "$lib/utils/spotify";

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
    const pieSize = $derived(
        Math.max(56, Math.min(120, Math.round(viewportHeight * 0.1) - 20)),
    );

    let baseSeq = 0;
    let sunburstSeq = 0;
    let macroSeq = 0;

    let sunburstTimer: ReturnType<typeof setTimeout> | null = null;
    let macroTimer: ReturnType<typeof setTimeout> | null = null;

    let prevSunburstSig = "";
    let prevMacroSig = "";
    let prevMatchSig = "";
    const REQUEST_DEBOUNCE_MS = 30;
    // The brush emits continuously during the drag; we throttle applying the
    // filter to refresh the sunburst ~9 times/s without saturating the thread.
    const FILTER_SYNC_THROTTLE_MS = 110;

    let viewTimeDomain = $state<[number, number] | null>(null);
    let viewHourDomain = $state<[number, number] | null>(null);

    const activeFilters = $derived(spotifyExplorerFilters.activeFilters);
    const dbReady = $derived(
        dataStore.source === "spotify" && !dataStore.isLoading,
    );

    // The `timestamp` column is stored as LOCAL wall-clock time (cf.
    // insertSpotifyPlays → formatLocalTimestamp). The "YYYY-MM-DD HH:MM:SS" format
    // has no zone suffix: new Date() already interprets it as local time.
    function formatPlayedAt(playedAt: string): string {
        const d = new Date(playedAt.replace(" ", "T"));
        return Number.isNaN(d.getTime()) ? playedAt : d.toLocaleString();
    }

    function constellationTooltip(m: Record<string, unknown>) {
        return {
            title: m.track as string,
            lines: [m.artist as string, formatPlayedAt(m.playedAt as string)],
            hint: m.trackUri
                ? `${MODIFIER_LABEL}+click to play on Spotify`
                : undefined,
        };
    }

    function constellationPointClick(m: Record<string, unknown>): boolean {
        return openSpotify(m.trackUri as string | null);
    }

    /** Set<string> of a filter's values, or null if not applicable (range, etc.). */
    function filterValueSet(f: FilterState, key: string): Set<string> | null {
        const v = f[key];
        if (v === undefined || v === null) return null;
        if (v instanceof Set) return new Set([...v].map(String));
        if (Array.isArray(v)) return new Set(v.map((x) => String(x)));
        if (typeof v === "object") return null;
        return new Set([String(v as FilterScalar)]);
    }

    // --- Dimensions (config) ---------------------------------------------
    // `key` = store key / SQL column; `field` = field carried by the base points.
    // All these dimensions affect the constellation's `matched`.
    type DimField = keyof ExplorerBasePoint;
    interface MatchDim {
        key: string;
        field: DimField;
    }
    const MATCH_DIMS: MatchDim[] = [
        { key: "artist_name", field: "fArtist" },
        { key: "album_name", field: "fAlbum" },
        { key: "track_name", field: "fTrack" },
        { key: "ip_addr", field: "ip" },
        { key: "platform_clean", field: "platform" },
        { key: "country", field: "country" },
        { key: "dayofweek", field: "dow" },
        { key: "media_type", field: "mediaType" },
        { key: "reason_start", field: "reasonStart" },
        { key: "shuffle", field: "shuffle" },
        { key: "skipped", field: "skipped" },
        { key: "offline", field: "offline" },
    ];

    function dowLabel(v: string): string {
        // DuckDB DAYOFWEEK : 0 = dimanche … 6 = samedi.
        const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
        const n = Number(v);
        return Number.isInteger(n) && n >= 0 && n < 7 ? names[n] : v;
    }

    // Boolean fields are encoded 'True'/'False' (cf. getExplorerBasePoints).
    const boolLabel =
        (yes: string, no: string) =>
        (v: string): string =>
            v === "True" ? yes : no;

    // Subset shown as pie charts (artist/album/track are the sunburst).
    interface PieDim extends MatchDim {
        label: string;
        format?: (v: string) => string;
    }
    const PIE_DIMS: PieDim[] = [
        { key: "ip_addr", field: "ip", label: "IP address" },
        { key: "country", field: "country", label: "Country" },
        { key: "platform_clean", field: "platform", label: "Platform" },
        {
            key: "dayofweek",
            field: "dow",
            label: "Day of week",
            format: dowLabel,
        },
        { key: "reason_start", field: "reasonStart", label: "Reason start" },
        { key: "media_type", field: "mediaType", label: "Media type" },
        {
            key: "shuffle",
            field: "shuffle",
            label: "Shuffle",
            format: boolLabel("Shuffle", "In order"),
        },
        {
            key: "skipped",
            field: "skipped",
            label: "Skipped",
            format: boolLabel("Skipped", "Completed"),
        },
        {
            key: "offline",
            field: "offline",
            label: "Offline",
            format: boolLabel("Offline", "Online"),
        },
    ];

    const TOP_N = 15;

    // --- Coloring by dimension -------------------------------------------
    // `colorBy` = store key of the dimension that colors the constellation and
    // stacks the satellite barcharts (null = green by default). Any pie can be the
    // source; the toggle is exclusive. The categories/colors are derived from the
    // dimension to stay pixel-aligned with the pie.
    let colorBy = $state<string | null>(null);

    const colorByDim = $derived(
        colorBy ? (PIE_DIMS.find((d) => d.key === colorBy) ?? null) : null,
    );

    // Category order/colors: aligned EXACTLY on the pie's slices (so brush window
    // + all filters included). The colors shown in the constellation/barcharts
    // thus reference what the pie shows.
    // The trade-off is that the stacking order can flip when brushing — but the
    // barcharts only color the brushed portion (cf. ConstellationChart), so the
    // flip stays readable.
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

    /** Currently filtered dimensions + their Set of values. */
    function activeDims(f: FilterState) {
        const out: { key: string; field: DimField; vals: Set<string> }[] = [];
        for (const d of MATCH_DIMS) {
            const vals = filterValueSet(f, d.key);
            if (vals) out.push({ key: d.key, field: d.field, vals });
        }
        return out;
    }

    /**
     * Signature of the filters that affect `matched` (= all dimensions except
     * timestamp/hour, handled as view domains by the chart).
     */
    function matchSig(f: FilterState): string {
        return JSON.stringify(MATCH_DIMS.map((d) => f[d.key] ?? null));
    }

    /**
     * Recomputes `matched` in place on the points (mutation, not a new reference)
     * then bumps `matchVersion` to trigger a chart redraw.
     */
    function computeMatched() {
        const active = activeDims(spotifyExplorerFilters.activeFilters);
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
        acc: Map<string, { minutes: number; plays: number }>,
    ): DimensionSlice[] {
        const sorted = [...acc.entries()]
            .map(([value, v]) => ({
                value,
                minutes: v.minutes,
                plays: v.plays,
            }))
            .sort((a, b) => b.minutes - a.minutes);
        const slices = sorted.slice(0, TOP_N);
        const rest = sorted.slice(TOP_N);
        if (rest.length) {
            const om = rest.reduce((s, x) => s + x.minutes, 0);
            const op = rest.reduce((s, x) => s + x.plays, 0);
            if (om > 0.5)
                slices.push({ value: "Other", minutes: om, plays: op });
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
            return;
        }
        const active = activeDims(spotifyExplorerFilters.activeFilters);
        const tWin = viewTimeDomain;
        const hWin = viewHourDomain;
        const maps: Record<
            string,
            Map<string, { minutes: number; plays: number }>
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
                    e = { minutes: 0, plays: 0 };
                    m.set(key, e);
                }
                e.minutes += p.mins;
                e.plays += 1;
            }
        }

        for (const pd of PIE_DIMS) next[pd.key] = topNSlices(maps[pd.key]);
        pieSlices = next;
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
            prevMatchSig = matchSig(spotifyExplorerFilters.activeFilters);
            computeMatched();
        } catch (e) {
            console.error("Error loading constellation base points:", e);
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
            console.error("Error loading sunburst data:", e);
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
            console.error("Error loading macro stats:", e);
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
        prevSunburstSig = "";
        prevMacroSig = "";
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
        sunburstTimer = setTimeout(
            () => void loadSunburst(f),
            REQUEST_DEBOUNCE_MS,
        );
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

    function applyRangeFilter(
        key: "timestamp" | "hour_of_day",
        view: [number, number] | null,
    ) {
        if (view) {
            spotifyExplorerFilters.setFilter(
                key,
                { min: view[0], max: view[1] },
                "constellation",
            );
        } else {
            spotifyExplorerFilters.removeFilter(key, "constellation");
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
        if (sunburstTimer) clearTimeout(sunburstTimer);
        if (macroTimer) clearTimeout(macroTimer);
        if (pieRaf) cancelAnimationFrame(pieRaf);
        if (timeRangeSyncTimer) clearTimeout(timeRangeSyncTimer);
        if (hourRangeSyncTimer) clearTimeout(hourRangeSyncTimer);
    });
</script>

<svelte:window bind:innerHeight={viewportHeight} />

<div class="explorer-page">
    <div class="header-bar">
        <div class="indicators" aria-label="Global indicators">
            <div class="indicator">
                <span class="indicator-value"
                    >{formatDurationLong(macroStats.totalMinutes)}</span
                >
                <span class="indicator-label">listened</span>
            </div>
            <div class="indicator">
                <span class="indicator-value"
                    >{macroStats.uniqueArtists.toLocaleString()}</span
                >
                <span class="indicator-label">unique artists</span>
            </div>
            <div class="indicator">
                <span class="indicator-value"
                    >{macroStats.uniqueAlbums.toLocaleString()}</span
                >
                <span class="indicator-label">unique albums</span>
            </div>
            <div class="indicator">
                <span class="indicator-value"
                    >{macroStats.uniqueTracks.toLocaleString()}</span
                >
                <span class="indicator-label">unique tracks</span>
            </div>
            <div class="indicator">
                <span class="indicator-value"
                    >{macroStats.totalPlays.toLocaleString()}</span
                >
                <span class="indicator-label">listens</span>
            </div>
        </div>

        {#if spotifyExplorerFilters.hasActiveFilters}
            <button
                class="clear-filters-btn"
                type="button"
                onclick={() => spotifyExplorerFilters.clearAll()}
            >
                Clear all filters
            </button>
        {/if}
    </div>

    <section class="explorer-grid" aria-label="Spotify explorer layout">
        <article
            class="chart-placeholder constellation"
            aria-label="Constellation chart area"
        >
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
                        width={containerWidth}
                        height={containerHeight}
                        {timeDomain}
                        colorField={colorByDim?.field ?? null}
                        {colorCategories}
                        formatTooltip={constellationTooltip}
                        onPointClick={constellationPointClick}
                        bind:viewTimeDomain
                        bind:viewHourDomain
                    />
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
                    selectedValue={firstFilterValue(activeFilters, pd.key)}
                    onSelect={(v) =>
                        v === null
                            ? spotifyExplorerFilters.removeFilter(pd.key, "pie")
                            : spotifyExplorerFilters.setFilter(pd.key, v, "pie")}
                    colorByEnabled
                    colorByActive={colorBy === pd.key}
                    onToggleColorBy={() => toggleColorBy(pd.key)}
                />
            {/each}
        </section>
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
        color: var(--accent-spotify, #1db954);
    }

    .indicator-label {
        font-size: 0.72rem;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: hsl(var(--muted-foreground));
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
        border-color: var(--accent-spotify, #1db954);
        color: var(--accent-spotify, #1db954);
        background: color-mix(
            in srgb,
            var(--accent-spotify, #1db954) 10%,
            transparent
        );
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
