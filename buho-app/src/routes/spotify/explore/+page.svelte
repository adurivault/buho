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

    // Les points de la constellation sont chargés UNE fois (raw : pas de proxy
    // réactif sur 167k objets). Le flag `matched` est recalculé en JS en place,
    // et `matchVersion` déclenche un simple redraw côté chart — sans rebuild du
    // quadtree (~1,3 s) ni round-trip DB à chaque filtre.
    let basePoints = $state.raw<ExplorerBasePoint[]>([]);
    let matchVersion = $state(0);
    let sunburstRows = $state<ArtistSunburstRow[]>([]);
    let pieSlices = $state<Record<string, DimensionSlice[]>>({});
    let macroStats = $state<ExplorerMacroStats>({
        totalMinutes: 0,
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

    // Les pies occupent ~10% de la hauteur d'écran (carré + label). Bornées pour
    // rester lisibles sur petits écrans et raisonnables sur grands.
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
    // Le brush émet en continu pendant le drag ; on throttle l'application du
    // filtre pour rafraîchir le sunburst ~9 fois/s sans saturer le thread.
    const FILTER_SYNC_THROTTLE_MS = 110;

    let viewTimeDomain = $state<[number, number] | null>(null);
    let viewHourDomain = $state<[number, number] | null>(null);

    const activeFilters = $derived(spotifyExplorerFilters.activeFilters);
    const dbReady = $derived(
        dataStore.source === "spotify" && !dataStore.isLoading,
    );

    /** Set<string> des valeurs d'un filtre, ou null si non applicable (range, etc.). */
    function filterValueSet(f: FilterState, key: string): Set<string> | null {
        const v = f[key];
        if (v === undefined || v === null) return null;
        if (v instanceof Set) return new Set([...v].map(String));
        if (Array.isArray(v)) return new Set(v.map((x) => String(x)));
        if (typeof v === "object") return null;
        return new Set([String(v as FilterScalar)]);
    }

    // --- Dimensions (config) ---------------------------------------------
    // `key` = clé du store / colonne SQL ; `field` = champ porté par les base
    // points. Toutes ces dimensions influent sur `matched` de la constellation.
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

    // Les champs booléens sont encodés 'True'/'False' (cf. getExplorerBasePoints).
    const boolLabel =
        (yes: string, no: string) =>
        (v: string): string =>
            v === "True" ? yes : no;

    // Sous-ensemble affiché en pie charts (artiste/album/titre sont le sunburst).
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

    // --- Coloration par dimension ----------------------------------------
    // `colorBy` = clé store de la dimension qui colore la constellation et empile
    // les barcharts satellites (null = vert par défaut). N'importe quelle pie peut
    // être la source ; le toggle est exclusif. Les catégories/couleurs sont
    // dérivées de la dimension pour rester au pixel avec le camembert.
    let colorBy = $state<string | null>(null);

    const colorByDim = $derived(
        colorBy ? (PIE_DIMS.find((d) => d.key === colorBy) ?? null) : null,
    );

    // Ordre/couleurs des catégories : alignés EXACTEMENT sur les slices de la pie
    // (donc fenêtre de brush + tous les filtres compris). Les couleurs affichées
    // dans la constellation/barcharts référencent ainsi ce que montre le pie.
    // En contrepartie, l'ordre d'empilement peut s'inverser quand on brushe — mais
    // les barcharts ne colorent que la portion brushée (cf. ConstellationChart),
    // donc l'inversion est lisible.
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

    /** Dimensions actuellement filtrées + leur Set de valeurs. */
    function activeDims(f: FilterState) {
        const out: { key: string; field: DimField; vals: Set<string> }[] = [];
        for (const d of MATCH_DIMS) {
            const vals = filterValueSet(f, d.key);
            if (vals) out.push({ key: d.key, field: d.field, vals });
        }
        return out;
    }

    /**
     * Signature des filtres qui influent sur `matched` (= toutes les dimensions
     * hors timestamp/hour, gérées comme domaines de vue par le chart).
     */
    function matchSig(f: FilterState): string {
        return JSON.stringify(MATCH_DIMS.map((d) => f[d.key] ?? null));
    }

    /**
     * Recalcule `matched` en place sur les points (mutation, pas de nouvelle
     * référence) puis bumpe `matchVersion` pour déclencher un redraw du chart.
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
     * Répartition de TOUTES les dimensions pie en UN seul passage JS sur les
     * points en mémoire (pas de round-trip DB → immédiat pendant le brush).
     * Chaque pie exclut son propre filtre (comme les bars classiques) : on
     * compte, par point, le nb de dimensions actives en échec — un point compte
     * pour une pie s'il passe TOUT (0 échec) ou s'il n'échoue QUE sur cette pie.
     * La fenêtre temps/heure visible (brush) s'applique à toutes.
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

    // Recompute coalescé en rAF : pendant le brush, plusieurs changements de
    // fenêtre par frame ⇒ un seul recalcul (et dégradation gracieuse si lourd).
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
            basePoints = nextPoints; // référence stable jusqu'au prochain dataset
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
            uniqueArtists: 0,
            uniqueAlbums: 0,
            uniqueTracks: 0,
        };
        isProcessing = false;
        initialLoad = true;
        prevSunburstSig = "";
        prevMacroSig = "";
    }

    // Chargement des points : UNE fois quand la source est prête. Le jeu de
    // points ne dépend pas des filtres.
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

    // Surlignage de la constellation : recalcul JS de `matched` quand la
    // sélection artist/album/track change. La signature évite tout recalcul
    // inutile (ex. brush temps/heure) et `untrack` garantit que la mutation en
    // place de `basePoints` ne peut pas re-déclencher cet effet (anti-boucle).
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

    // Sunburst : re-query quand un filtre AUTRE que artist/album/track change
    // (il exclut ses propres dimensions pour garder la hiérarchie complète).
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

    // Indicateurs globaux : recalculés à chaque changement de filtre.
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

    // Pies : recalcul JS (immédiat, sans DB) dès que les points, la sélection,
    // ou la fenêtre temps/heure du brush changent. Coalescé en rAF.
    $effect(() => {
        const _b = basePoints;
        const _m = matchVersion; // proxy des changements de sélection
        const _t = viewTimeDomain;
        const _h = viewHourDomain;
        if (!dbReady) return;
        schedulePieRecompute();
    });

    // Sync interactions from ConstellationChart to global filters.
    // Le brush émet en continu : on applique le filtre en throttle (leading +
    // trailing) pour rafraîchir pendant le drag, pas seulement au relâchement.
    let timeRangeSyncTimer: ReturnType<typeof setTimeout> | null = null;
    let hourRangeSyncTimer: ReturnType<typeof setTimeout> | null = null;
    let lastTimeSync = 0;
    let lastHourSync = 0;

    function applyRangeFilter(
        key: "timestamp" | "hour_of_day",
        view: [number, number] | null,
    ) {
        if (view) {
            spotifyExplorerFilters.setFilter(key, {
                min: view[0],
                max: view[1],
            });
        } else {
            spotifyExplorerFilters.removeFilter(key);
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

    /* Sous une certaine largeur, on empile constellation + sunburst et on laisse
       la page défiler : impossible de tout garder lisible en un seul écran. */
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
