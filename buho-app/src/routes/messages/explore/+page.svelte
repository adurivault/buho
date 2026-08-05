<script lang="ts">
    import { onDestroy, untrack } from "svelte";
    import ConstellationChart from "$lib/components/visualizations/ConstellationChart.svelte";
    import ContactRankingPanel, {
        type ContactRankRow,
    } from "$lib/components/visualizations/ContactRankingPanel.svelte";
    import DimensionPie from "$lib/components/visualizations/DimensionPie.svelte";
    import MeasureToggle, {
        type MeasureOption,
    } from "$lib/components/visualizations/MeasureToggle.svelte";
    import LoadingOverlay from "$lib/components/LoadingOverlay.svelte";
    import {
        getMessageBasePoints,
        getMessageTimeDomain,
        type MessageBasePoint,
    } from "$lib/data/queries/messageQueries";
    import type { DimensionSlice } from "$lib/data/queries/dimensionQueries";
    import type { ConnectablePoint } from "$lib/data/queries/behaviorQueries";
    import type { FilterScalar, FilterState } from "$lib/types/filters";
    import { dataStore } from "$lib/stores/dataStore.svelte";
    import { messagesExplorerFilters } from "$lib/stores/messagesExplorerFilters.svelte";
    import { stickyColor } from "$lib/utils/dimensionColors";
    import { trackControl } from "$lib/analytics";
    import { firstFilterValue } from "$lib/utils/filters";

    const MESSAGES_ACCENT = "#3b82f6";

    // The points are loaded ONCE (raw: no reactive proxy over the whole export).
    // The `matched` flag is recomputed in JS in place, and `matchVersion` triggers
    // a chart-side redraw without rebuilding the quadtree or hitting the DB.
    let basePoints = $state.raw<MessageBasePoint[]>([]);
    let matchVersion = $state(0);
    let pieSlices = $state<Record<string, DimensionSlice[]>>({});
    let contactRows = $state<ContactRankRow[]>([]);
    /** Totals for the current selection, shown above the charts. */
    let tiles = $state({ messages: 0, words: 0, chars: 0 });

    let initialLoad = $state(true);
    let containerWidth = $state(0);
    let containerHeight = $state(0);
    let viewportHeight = $state(0);
    let timeDomain = $state<[number, number] | null>(null);
    let viewTimeDomain = $state<[number, number] | null>(null);
    let viewHourDomain = $state<[number, number] | null>(null);

    // The pies take ~10% of the screen height (square + label). Clamped to stay
    // legible on small screens and reasonable on large ones.
    const pieSize = $derived(
        Math.max(56, Math.min(120, Math.round(viewportHeight * 0.1) - 20)),
    );

    const activeFilters = $derived(messagesExplorerFilters.activeFilters);
    const dbReady = $derived(
        dataStore.source === "messages" && !dataStore.isLoading,
    );

    // The `timestamp` column is stored as LOCAL wall-clock time (cf.
    // parseMessages). The "YYYY-MM-DD HH:MM:SS" format has no zone suffix:
    // new Date() already interprets it as local time.
    function formatSentAt(sentAt: string): string {
        const d = new Date(sentAt.replace(" ", "T"));
        return Number.isNaN(d.getTime()) ? sentAt : d.toLocaleString();
    }

    /** Message text is the point of the tooltip, but a whole paragraph isn't. */
    function truncate(text: string, max = 120): string {
        const clean = text.replace(/\s+/g, " ").trim();
        return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
    }

    function constellationTooltip(m: Record<string, unknown>) {
        const text = truncate((m.text as string) ?? "");
        const reactions = (m.reactions as string) ?? "";
        // Title is the conversation, first line is who wrote it. In a group the
        // sender can't be guessed from the direction, and even one-to-one it is
        // what you actually want to read first.
        const lines = [
            `${m.sender} · ${m.network} · ${formatSentAt(m.sentAt as string)}`,
        ];
        if (text) lines.push(text);
        else if (m.mediaKind !== "none") lines.push(`[${m.mediaKind}]`);
        if (reactions) lines.push(reactions.split(",").join(" "));
        return { title: m.contact as string, lines };
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
    // `key` = store key; `field` = field carried by the base points. All of them
    // affect the constellation's `matched`; `contact` drives the ranking panel
    // rather than a pie, so it is not in PIE_DIMS.
    type DimField = keyof MessageBasePoint;
    interface MatchDim {
        key: string;
        field: DimField;
    }
    const CONTACT_DIM: MatchDim = { key: "contact", field: "fContact" };
    const MATCH_DIMS: MatchDim[] = [
        CONTACT_DIM,
        { key: "network", field: "fNetwork" },
        { key: "direction", field: "fDirection" },
        { key: "msg_type", field: "fType" },
        { key: "media_kind", field: "fMediaKind" },
        { key: "reacted", field: "fReacted" },
        { key: "length_bucket", field: "fLength" },
        { key: "dayofweek", field: "dow" },
        { key: "year", field: "year" },
    ];

    function dowLabel(v: string): string {
        // DuckDB DAYOFWEEK: 0 = Sunday … 6 = Saturday.
        const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
        const n = Number(v);
        return Number.isInteger(n) && n >= 0 && n < 7 ? names[n] : v;
    }

    interface PieDim extends MatchDim {
        label: string;
        format?: (v: string) => string;
    }
    const PIE_DIMS: PieDim[] = [
        { key: "network", field: "fNetwork", label: "Network" },
        { key: "direction", field: "fDirection", label: "Direction" },
        { key: "msg_type", field: "fType", label: "Type" },
        { key: "media_kind", field: "fMediaKind", label: "Attachment" },
        { key: "reacted", field: "fReacted", label: "Reactions" },
        { key: "length_bucket", field: "fLength", label: "Length" },
        {
            key: "dayofweek",
            field: "dow",
            label: "Day of week",
            format: dowLabel,
        },
        { key: "year", field: "year", label: "Year" },
    ];

    /** Every dimension that gets its own breakdown: the pies plus the ranking. */
    const BREAKDOWN_DIMS: MatchDim[] = [CONTACT_DIM, ...PIE_DIMS];

    // --- Measure ----------------------------------------------------------
    // What every figure counts. Messages is the default; words and characters
    // re-weight the same points towards how much was actually written, which
    // tells a different story for someone who sends essays vs one-liners.
    type Measure = "messages" | "words" | "chars";
    let measure = $state<Measure>("messages");

    const MEASURES: MeasureOption[] = [
        { key: "messages", label: "Messages", hint: "One unit per message" },
        { key: "words", label: "Words", hint: "Weighted by words written" },
        { key: "chars", label: "Characters", hint: "Weighted by characters typed" },
    ];

    function measureOf(m: Measure, p: MessageBasePoint): number {
        if (m === "words") return p.words;
        if (m === "chars") return p.chars;
        return 1;
    }

    const measureValue = (p: MessageBasePoint) => measureOf(measure, p);

    // A fresh closure per measure change, so the satellite bars recompute.
    const barValue = $derived.by(() => {
        const m = measure;
        return (p: ConnectablePoint) => measureOf(m, p as MessageBasePoint);
    });

    const measureLabel = $derived(
        measure === "messages" ? "messages" : measure === "words" ? "words" : "characters",
    );

    const TOP_N = 15;
    /** Contacts listed in the ranking panel — enough to scroll, not to drown. */
    const CONTACT_LIMIT = 60;

    // --- Coloring by dimension -------------------------------------------
    // `colorBy` = store key of the dimension that colors the constellation and
    // stacks the satellite barcharts (null = the Messages accent by default).
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

    /** Currently filtered dimensions + their Set of values. */
    function activeDims(f: FilterState) {
        const out: { key: string; field: DimField; vals: Set<string> }[] = [];
        for (const d of MATCH_DIMS) {
            const vals = filterValueSet(f, d.key);
            if (vals) out.push({ key: d.key, field: d.field, vals });
        }
        return out;
    }

    /** Signature of the filters that affect `matched` (time/hour are view domains). */
    function matchSig(f: FilterState): string {
        return JSON.stringify(MATCH_DIMS.map((d) => f[d.key] ?? null));
    }

    let prevMatchSig = "";

    /**
     * Recomputes `matched` in place on the points (mutation, not a new reference)
     * then bumps `matchVersion` to trigger a chart redraw.
     */
    function computeMatched() {
        const active = activeDims(messagesExplorerFilters.activeFilters);
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

    function topNSlices(acc: Map<string, number>): DimensionSlice[] {
        const sorted = [...acc.entries()]
            .map(([value, count]) => ({ value, minutes: count, plays: count }))
            .sort((a, b) => b.plays - a.plays);
        const slices = sorted.slice(0, TOP_N);
        const rest = sorted.slice(TOP_N);
        if (rest.length) {
            const other = rest.reduce((s, x) => s + x.plays, 0);
            if (other > 0)
                slices.push({ value: "Other", minutes: other, plays: other });
        }
        return slices;
    }

    /**
     * Breakdown of every dimension — the pies, the contact ranking and the stat
     * tiles — in a SINGLE JS pass over the in-memory points (no DB round-trip, so
     * it stays immediate during a brush).
     * Each breakdown excludes its own filter (like the classic bars): per point we
     * count the failing active dimensions — a point counts for a breakdown if it
     * passes EVERYTHING (0 failures) or if it fails ONLY on that one. The visible
     * time/hour window (brush) applies throughout.
     */
    function computeBreakdowns() {
        const pts = basePoints;
        if (pts.length === 0) {
            pieSlices = Object.fromEntries(PIE_DIMS.map((d) => [d.key, []]));
            contactRows = [];
            tiles = { messages: 0, words: 0, chars: 0 };
            return;
        }

        const active = activeDims(messagesExplorerFilters.activeFilters);
        const tWin = viewTimeDomain;
        const hWin = viewHourDomain;

        const maps: Record<string, Map<string, number>> = {};
        for (const d of BREAKDOWN_DIMS) maps[d.key] = new Map();
        // The contact panel also shows who wrote what, so it needs its own tally.
        const contactSent = new Map<string, number>();

        let messages = 0;
        let words = 0;
        let chars = 0;

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

            // Every breakdown is weighted by the active measure, so switching it
            // rescales the pies and the ranking in the same pass.
            const weight = measureValue(p);

            for (const d of BREAKDOWN_DIMS) {
                if (fails === 1 && failedKey !== d.key) continue;
                const key = p[d.field] as string;
                const m = maps[d.key];
                m.set(key, (m.get(key) ?? 0) + weight);
                if (d.key === CONTACT_DIM.key && p.fDirection === "Sent") {
                    contactSent.set(key, (contactSent.get(key) ?? 0) + weight);
                }
            }

            // The tiles describe the current selection itself, so they only count
            // points passing every filter.
            if (fails === 0) {
                messages += 1;
                words += p.words;
                chars += p.chars;
            }
        }

        const nextPies: Record<string, DimensionSlice[]> = {};
        for (const d of PIE_DIMS) nextPies[d.key] = topNSlices(maps[d.key]);
        pieSlices = nextPies;

        contactRows = [...maps[CONTACT_DIM.key].entries()]
            .map(([contact, count]) => ({
                contact,
                messages: count,
                sent: contactSent.get(contact) ?? 0,
            }))
            .sort((a, b) => b.messages - a.messages)
            .slice(0, CONTACT_LIMIT);

        tiles = { messages, words, chars };
    }

    // Recompute coalesced in rAF: during the brush, several window changes per
    // frame ⇒ a single recompute.
    let breakdownRaf = 0;
    function scheduleBreakdownRecompute() {
        if (breakdownRaf) return;
        breakdownRaf = requestAnimationFrame(() => {
            breakdownRaf = 0;
            computeBreakdowns();
        });
    }

    let baseSeq = 0;

    async function loadBasePoints() {
        baseSeq += 1;
        const runId = baseSeq;
        try {
            const [nextPoints, domain] = await Promise.all([
                getMessageBasePoints(),
                getMessageTimeDomain(),
            ]);
            if (runId !== baseSeq) return;

            timeDomain = domain;
            basePoints = nextPoints; // stable reference until the next dataset
            prevMatchSig = matchSig(messagesExplorerFilters.activeFilters);
            computeMatched();
        } catch (e) {
            console.error("Error loading message base points:", e);
        } finally {
            if (runId === baseSeq && initialLoad) initialLoad = false;
        }
    }

    function resetState() {
        baseSeq += 1;
        basePoints = [];
        matchVersion = 0;
        pieSlices = {};
        contactRows = [];
        tiles = { messages: 0, words: 0, chars: 0 };
        initialLoad = true;
        prevMatchSig = "";
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

    // Pies, ranking and tiles: JS recompute (immediate, no DB) whenever the
    // points, the selection, or the brush's time/hour window change.
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
</script>

<svelte:window bind:innerHeight={viewportHeight} />

<div class="explorer-page">
    <div class="header-bar">
        <div class="indicators" aria-label="Global indicators">
            <div class="indicator">
                <span class="indicator-value"
                    >{tiles.messages.toLocaleString()}</span
                >
                <span class="indicator-label">messages</span>
            </div>
            <div class="indicator">
                <span class="indicator-value"
                    >{tiles.words.toLocaleString()}</span
                >
                <span class="indicator-label">words</span>
            </div>
            <div class="indicator">
                <span class="indicator-value"
                    >{tiles.chars.toLocaleString()}</span
                >
                <span class="indicator-label">characters</span>
            </div>
        </div>

        {#if messagesExplorerFilters.hasActiveFilters}
            <button
                class="clear-filters-btn"
                type="button"
                onclick={() => messagesExplorerFilters.clearAll()}
            >
                Clear all filters
            </button>
        {/if}
    </div>

    <section class="explorer-grid" aria-label="Messages explorer layout">
        <article
            class="chart-placeholder constellation"
            aria-label="Constellation chart area"
        >
            <div
                class="constellation-host"
                bind:clientWidth={containerWidth}
                bind:clientHeight={containerHeight}
            >
                {#if !dbReady}
                    <p class="empty">
                        Import your messages export to explore it.
                    </p>
                {:else if initialLoad}
                    <div
                        class="loading-wrapper relative w-full h-full flex items-center justify-center"
                    >
                        <LoadingOverlay message="Rendering conversations..." />
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
                        matchedColor={MESSAGES_ACCENT}
                        {barValue}
                        formatTooltip={constellationTooltip}
                        tooltipMatchedOnly
                        bind:viewTimeDomain
                        bind:viewHourDomain
                    />
                {/if}
            </div>
        </article>

        <aside class="chart-placeholder ranking" aria-label="Contact ranking">
            {#if dbReady && !initialLoad}
                <ContactRankingPanel
                    rows={contactRows}
                    filterKey="contact"
                    selected={firstFilterValue(activeFilters, "contact")}
                    onSelect={(v) =>
                        v === null
                            ? messagesExplorerFilters.removeFilter(
                                  "contact",
                                  "bar",
                              )
                            : messagesExplorerFilters.setFilter(
                                  "contact",
                                  v,
                                  "bar",
                              )}
                />
            {/if}
        </aside>
    </section>

    {#if !initialLoad && dbReady}
        <section class="dimensions-row" aria-label="Dimension breakdowns">
            <MeasureToggle
                options={MEASURES}
                value={measure}
                onChange={(key) => {
                    trackControl("messages-explorer", "measure", key);
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
                    sliceValue={(s) => s.plays}
                    formatValue={(v) =>
                        `${Math.round(v).toLocaleString()} ${measureLabel}`}
                    selectedValue={firstFilterValue(activeFilters, pd.key)}
                    onSelect={(v) =>
                        v === null
                            ? messagesExplorerFilters.removeFilter(pd.key, "pie")
                            : messagesExplorerFilters.setFilter(
                                  pd.key,
                                  v,
                                  "pie",
                              )}
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
        /* Lets the measure toggle pick up the source hue. */
        --source-accent: var(--accent-messages, #3b82f6);
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
        color: var(--accent-messages, #3b82f6);
        font-variant-numeric: tabular-nums;
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
        border-color: var(--accent-messages, #3b82f6);
        color: var(--accent-messages, #3b82f6);
        background: color-mix(
            in srgb,
            var(--accent-messages, #3b82f6) 10%,
            transparent
        );
    }

    .explorer-grid {
        flex: 1;
        min-height: 0;
        display: grid;
        gap: 1rem;
        grid-template-columns: 2.2fr 1fr;
        grid-template-rows: minmax(0, 1fr);
        grid-template-areas: "constellation ranking";
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

    .ranking {
        grid-area: ranking;
        min-width: 0;
        overflow: hidden;
    }

    .empty {
        color: hsl(var(--muted-foreground));
        font-size: 0.9rem;
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
                "constellation"
                "ranking";
        }

        .constellation-host {
            min-height: 26rem;
        }

        .ranking {
            min-height: 22rem;
        }
    }
</style>
