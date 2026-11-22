<script lang="ts">
    // Every module on the same days: the years in the header, the open year
    // below, then the open day. Not a module — it holds no data of its own.
    import Icon from '#lib/components/Icon.svelte';
    import OwlLogo from '#lib/components/OwlLogo.svelte';
    import ImportDialog from '#lib/components/ImportDialog.svelte';
    import ImportStatus from '#lib/components/ImportStatus.svelte';
    import YearPicker from '#lib/components/calendar/YearPicker.svelte';
    import CalendarPill from '#lib/components/calendar/CalendarPill.svelte';
    import CalendarEmpty from '#lib/components/calendar/CalendarEmpty.svelte';
    import { DATA_MODULES, type ModuleId } from '#lib/data/modules.ts';
    import { dataStore } from '#lib/stores/dataStore.svelte.ts';
    import { listeningMeasure } from '#lib/stores/listeningMeasure.svelte.ts';
    import { calendarStore } from '#lib/stores/calendarStore.svelte.ts';
    import { trackEvent } from '#lib/analytics.ts';
    import YearLanes from '#lib/components/calendar/YearLanes.svelte';
    import WeekCalendar from '#lib/components/calendar/WeekCalendar.svelte';
    import YearRadViz from '#lib/components/calendar/YearRadViz.svelte';
    import ParallelDays from '#lib/components/calendar/ParallelDays.svelte';
    import DayTracks from '#lib/components/calendar/DayTracks.svelte';
    import DayMap from '#lib/components/calendar/DayMap.svelte';
    import YearClock from '#lib/components/calendar/YearClock.svelte';
    import {
        getDayTimeline,
        getHeartRateStops,
        getYearData,
        getYearQuarters,
        getYearSummaries,
        type LoadedModules,
    } from '#lib/data/queries/calendarQueries.ts';
    import type { QuarterCell } from '#lib/calendar/clock.ts';
    import { coverageOf, yearRows, type YearSummary } from '#lib/calendar/years.ts';
    import { buildYearDays } from '#lib/calendar/days.ts';
    import { LANE_HEAD, LANE_LEFT, layoutYear } from '#lib/calendar/lanes.ts';
    import { dailyFigures, type YearData } from '#lib/calendar/yearData.ts';
    import type { DayTimeline } from '#lib/calendar/timeline.ts';
    import { DayLoader } from '#lib/calendar/dayLoader.ts';
    import type { FigureContext } from '#lib/calendar/figures.ts';
    import { dayInYear, stepDay } from '#lib/calendar/dates.ts';
    import type { ColorStop } from '#lib/visualizations/signalGrid.ts';

    let summaries = $state.raw<YearSummary[]>([]);
    /** Which read the summaries on screen came from; 0 until the first lands. */
    let summariesRun = $state(0);
    /** The heart-rate ramp, over the whole history. Empty without one. */
    let stops = $state.raw<ColorStop[]>([]);
    let yearData = $state.raw<YearData | null>(null);
    /**
     * The day the day section draws: the hovered one while the pointer is on
     * the year's charts, the selected one otherwise. It stays on the previous
     * day until the next one has been read, so the section never blinks empty.
     */
    let shown = $state.raw<DayTimeline | null>(null);
    /** The day under the pointer in any of the year's three charts. */
    let hovered = $state<string | null>(null);
    /**
     * The module under the pointer — in the lanes, in the week calendar's
     * legend, on an anchor of the RadViz or an axis of the parallel
     * coordinates — which the clock and the week calendar then show alone,
     * and the RadViz and the parallel coordinates bring forward; null while
     * the pointer is on none, and they show them all.
     */
    let pointedModule = $state<ModuleId | null>(null);
    /** The minute under the pointer on the day's tracks, which the map marks. */
    let cursor = $state<number | null>(null);

    let dialogOpen = $state(false);
    let dialogFocus = $state<ModuleId | undefined>(undefined);
    let building = $state(false);

    const loaded = $derived<LoadedModules>({ ...dataStore.loaded });
    const anyLoaded = $derived(DATA_MODULES.some((module) => loaded[module.id]));
    const ready = $derived(anyLoaded && !dataStore.isLoading);
    const measure = $derived(listeningMeasure.measure);

    const rows = $derived(yearRows(summaries));
    const coverage = $derived(coverageOf(summaries));
    const row = $derived(rows.find((r) => r.year === calendarStore.year) ?? null);
    /** The first and last day anything was recorded on: where stepping stops. */
    const firstDay = $derived(rows.find((r) => r.firstDay)?.firstDay ?? null);
    const lastDay = $derived(rows.findLast((r) => r.lastDay)?.lastDay ?? null);

    const year = $derived(yearData && yearData.year === calendarStore.year ? yearData : null);
    const yearDays = $derived(year ? buildYearDays(year.year, dailyFigures(year), coverage) : null);
    const laneLayout = $derived(year && yearDays ? layoutYear(loaded, yearDays, year) : null);

    const COLUMN_GAP = 28;
    const ROW_GAP = 30;
    /** Narrowest the lanes get, labels included. */
    const LANES_MIN = 640;
    /** Smallest the clock gets beside the lanes before it goes under them. */
    const CLOCK_MIN = 320;

    let gridWidth = $state(0);
    const lanesHeight = $derived(LANE_HEAD + (laneLayout?.height ?? 0));

    /**
     * Two columns while there is room: the lanes, with the RadViz and the
     * week calendar under them; the clock beside the lanes, as tall as them,
     * with the parallel coordinates under it. One column when the page is
     * too narrow for the lanes and the clock side by side.
     */
    const yearLayout = $derived.by((): { mode: 'side' | 'stacked'; clock: number } => {
        // Not measured yet: the clock at its own default size.
        if (gridWidth === 0) return { mode: 'side', clock: 400 };
        const clock = Math.min(lanesHeight, gridWidth - COLUMN_GAP - LANES_MIN);
        if (clock >= CLOCK_MIN) return { mode: 'side', clock: Math.round(clock) };
        return { mode: 'stacked', clock: Math.min(400, gridWidth) };
    });
    const clockSize = $derived(yearLayout.clock);
    const context = $derived<FigureContext>({ measure });

    let summaryCount = 0;
    $effect(() => {
        if (!ready) return;
        const modules = loaded;
        const counting = measure;
        const run = ++summaryCount;
        void (async () => {
            const [next, ramp] = await Promise.all([
                getYearSummaries(modules, counting),
                modules.health ? getHeartRateStops() : Promise.resolve<ColorStop[]>([]),
            ]);
            if (run !== summaryCount) return;
            summaries = next;
            stops = ramp;
            summariesRun = run;
        })();
    });

    // Open the latest day on arrival, and again whenever the open one stops
    // existing — the data it belonged to was removed.
    $effect(() => {
        if (summariesRun === 0 || !firstDay || !lastDay) return;
        const open = calendarStore.day;
        if (open && open >= firstDay && open <= lastDay) return;
        calendarStore.selectDay(lastDay);
    });

    let yearCount = 0;
    $effect(() => {
        const open = calendarStore.year;
        if (!ready || open === null || summariesRun === 0) return;
        const modules = loaded;
        const options = { measure, heartRateStops: stops };
        void dataStore.daysVersion;
        const run = ++yearCount;
        void (async () => {
            const next = await getYearData(open, modules, options);
            if (run === yearCount) yearData = next;
        })();
    });

    /**
     * The open year quarter-hour by quarter-hour, for the clock. Read apart
     * from the year's days, so the lanes never wait for it.
     */
    let yearQuarters = $state.raw<{
        year: number;
        quarters: Partial<Record<ModuleId, QuarterCell[]>>;
    } | null>(null);
    const quarters = $derived(
        yearQuarters && yearQuarters.year === calendarStore.year ? yearQuarters.quarters : null
    );

    let quartersCount = 0;
    $effect(() => {
        const open = calendarStore.year;
        if (!ready || open === null || summariesRun === 0) return;
        const modules = loaded;
        void dataStore.daysVersion;
        const run = ++quartersCount;
        void (async () => {
            const next = await getYearQuarters(open, modules);
            if (run === quartersCount) yearQuarters = { year: open, quarters: next };
        })();
    });

    // One loader per state of the data: its cache answers a day seen before at
    // once, which is what lets the day follow the pointer across the year.
    let loader: DayLoader<DayTimeline> | null = null;
    let loaderFor = '';
    $effect(() => {
        if (!ready || summariesRun === 0) return;
        const modules = loaded;
        const options = { heartRateStops: stops };
        const key = `${summariesRun}:${dataStore.geoVersion}`;
        if (!loader || key !== loaderFor) {
            loaderFor = key;
            loader = new DayLoader(
                (date) => getDayTimeline(date, modules, options),
                (_, next) => (shown = next)
            );
        }
        const target = hovered ?? calendarStore.day;
        if (target) loader.want(target);
    });

    function pick(day: string) {
        calendarStore.selectDay(day);
    }

    function pickYear(year: number) {
        const target = rows.find((r) => r.year === year);
        if (!target) return;
        const next = dayInYear(calendarStore.day, year, target);
        if (next) calendarStore.selectDay(next);
    }

    function step(delta: number) {
        if (!calendarStore.day || !firstDay || !lastDay) return;
        const next = stepDay(calendarStore.day, delta, firstDay, lastDay);
        if (next) calendarStore.selectDay(next);
    }

    function onKey(event: KeyboardEvent) {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
        if (dialogOpen || !anyLoaded) return;
        const target = event.target;
        if (
            target instanceof Element &&
            target.closest('input, textarea, select, [contenteditable="true"]')
        ) {
            return;
        }
        event.preventDefault();
        step(event.key === 'ArrowLeft' ? -1 : 1);
    }

    function openImport(module?: ModuleId) {
        trackEvent('import-open', module ? { module } : {});
        dialogFocus = module;
        dialogOpen = true;
    }

    /**
     * Every sample there is, one after the other. Behind a dynamic import, like
     * the module pages' button: the invented data never reaches anybody who
     * came with an export of their own.
     */
    async function loadDemoData() {
        building = true;
        try {
            const { loadDemo } = await import('#lib/demo/load.ts');
            for (const module of DATA_MODULES) {
                if (module.hasDemo) await loadDemo(module.id);
            }
        } finally {
            building = false;
        }
    }
</script>

<svelte:window onkeydown={onKey} />

<ImportDialog bind:open={dialogOpen} onClose={() => (dialogOpen = false)} focus={dialogFocus} />

<div class="calendar-page">
    <header class="calendar-header">
        <span class="title"><Icon name="calendar" size={18} />Calendar</span>

        {#if anyLoaded && rows.length > 0}
            <div class="controls">
                <YearPicker
                    {rows}
                    selected={calendarStore.year}
                    {loaded}
                    {measure}
                    onPick={pickYear}
                />
            </div>
        {/if}

        <!-- Nothing to report before anything is loaded: the page's drop zone
             is the way in. -->
        {#if anyLoaded || dataStore.loading}
            <div class="header-end">
                <CalendarPill onAdd={() => openImport()} />
            </div>
        {/if}
    </header>

    <ImportStatus />

    {#if !anyLoaded}
        <CalendarEmpty onDemo={loadDemoData} {building} />
    {:else}
        <main class="calendar-main">
            <section id="year" class="year" aria-label="Year">
                {#if year && yearDays && laneLayout}
                    <div
                        class="year-grid {yearLayout.mode}"
                        bind:clientWidth={gridWidth}
                        style:--column-gap="{COLUMN_GAP}px"
                        style:--row-gap="{ROW_GAP}px"
                        style:--side="{clockSize}px"
                    >
                        <YearLanes
                            days={yearDays}
                            data={year}
                            layout={laneLayout}
                            {coverage}
                            end={row?.to ?? null}
                            glyphs={row?.glyphs ?? {}}
                            selected={calendarStore.day}
                            {hovered}
                            first={firstDay}
                            last={lastDay}
                            {context}
                            onPick={pick}
                            onHover={(next) => (hovered = next)}
                            onModule={(next) => (pointedModule = next)}
                            onAdd={openImport}
                        />
                        {#if quarters}
                            <YearClock
                                {quarters}
                                days={yearDays.days}
                                module={pointedModule}
                                heartStops={stops}
                                selected={calendarStore.day}
                                {hovered}
                                onPick={pick}
                                onHover={(next) => (hovered = next)}
                                size={clockSize}
                            />
                        {/if}
                        <div class="year-bottom" style:--left="{LANE_LEFT}px">
                            <YearRadViz
                                days={yearDays}
                                {loaded}
                                selected={calendarStore.day}
                                {hovered}
                                onPick={pick}
                                onHover={(next) => (hovered = next)}
                                module={pointedModule}
                                onModule={(next) => (pointedModule = next)}
                                size={150}
                            />
                            <WeekCalendar
                                days={yearDays}
                                {loaded}
                                selected={calendarStore.day}
                                {hovered}
                                {context}
                                onPick={pick}
                                onHover={(next) => (hovered = next)}
                                module={pointedModule}
                                onModule={(next) => (pointedModule = next)}
                            />
                        </div>
                        <ParallelDays
                            days={yearDays}
                            {loaded}
                            selected={calendarStore.day}
                            {hovered}
                            {context}
                            onPick={pick}
                            onHover={(next) => (hovered = next)}
                            module={pointedModule}
                            onModule={(next) => (pointedModule = next)}
                        />
                    </div>
                {/if}
            </section>

            {#if calendarStore.day}
                <section id="day" class="day" aria-label="Day">
                    <div class="day-head">
                        <div class="day-title">
                            <!-- yyyy-mm-dd: the same width every day, so nothing below
                                 shifts as the pointer sweeps the year. -->
                            <h2 class="date">{shown?.date ?? calendarStore.day}</h2>
                        </div>
                        <div class="day-arrows">
                            <button
                                type="button"
                                class="arrow"
                                aria-label="Previous day"
                                disabled={!firstDay || calendarStore.day <= firstDay}
                                onclick={() => step(-1)}
                            >
                                ‹
                            </button>
                            <button
                                type="button"
                                class="arrow"
                                aria-label="Next day"
                                disabled={!lastDay || calendarStore.day >= lastDay}
                                onclick={() => step(1)}
                            >
                                ›
                            </button>
                        </div>
                    </div>
                    {#if shown}
                        <div class="day-body" class:with-map={loaded.positions}>
                            <DayTracks
                                day={shown}
                                {loaded}
                                {coverage}
                                {context}
                                onAdd={openImport}
                                onCursor={(minute) => (cursor = minute)}
                            />
                            {#if loaded.positions}
                                <DayMap points={shown.positions?.points ?? []} minute={cursor} />
                            {/if}
                        </div>
                    {/if}
                </section>
            {/if}

            <footer class="calendar-foot">
                <OwlLogo size={18} />
                Nothing is uploaded. It all runs in your browser.
            </footer>
        </main>
    {/if}
</div>

<style>
    .calendar-page {
        min-height: 100%;
        display: flex;
        flex-direction: column;
        color: hsl(var(--foreground));
        background: hsl(var(--background));
    }

    .calendar-header {
        position: sticky;
        top: 0;
        z-index: 30;
        display: grid;
        grid-template-columns: auto minmax(0, 1fr) auto;
        align-items: center;
        gap: 0.5rem 1.25rem;
        min-height: 52px;
        padding: 0.375rem 1rem;
        border-bottom: 1px solid hsl(var(--border));
        background: hsl(var(--background) / 0.9);
        backdrop-filter: blur(8px);
    }

    .title {
        display: inline-flex;
        align-items: center;
        gap: 0.5rem;
        font-family: var(--font-display);
        font-size: var(--text-subheading);
        font-weight: 600;
        letter-spacing: -0.01em;
        color: hsl(var(--heading));
        white-space: nowrap;
    }

    /* One line, always: the year strip gives way and scrolls. */
    .controls {
        display: flex;
        align-items: center;
        gap: 14px;
        min-width: 0;
    }

    .day-arrows {
        display: flex;
        align-items: center;
        gap: 2px;
    }

    .arrow {
        width: 32px;
        height: 32px;
        border: 0;
        border-radius: var(--radius-sm);
        font: inherit;
        font-size: 1.25rem;
        line-height: 1;
        color: hsl(var(--muted-foreground));
        background: transparent;
        cursor: pointer;
    }

    .arrow:hover:not(:disabled) {
        color: hsl(var(--foreground));
        background: hsl(var(--accent));
    }

    .arrow:disabled {
        cursor: default;
        opacity: 0.35;
    }

    .header-end {
        justify-self: end;
    }

    .calendar-main {
        width: 100%;
        max-width: 1760px;
        box-sizing: border-box;
        margin: 0 auto;
        padding: 32px 40px 72px;
        display: flex;
        flex-direction: column;
        gap: 36px;
    }

    section {
        display: flex;
        flex-direction: column;
        scroll-margin-top: 72px;
    }

    .day {
        gap: 16px;
    }

    h2 {
        margin: 0;
        font-family: var(--font-display);
        font-size: var(--text-heading);
        line-height: 1.3;
        font-weight: 600;
        letter-spacing: -0.01em;
        color: hsl(var(--heading));
    }

    .day-title {
        display: flex;
        align-items: baseline;
        flex-wrap: wrap;
        gap: 4px 12px;
        min-width: 0;
    }

    .date {
        font-variant-numeric: tabular-nums;
    }

    /* The map sits beside the tracks, level with their first one. */
    .day-body.with-map {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        align-items: start;
        gap: 24px;
    }

    .day-body.with-map > :global(.day-map) {
        margin-top: 30px;
    }

    .day-head {
        display: flex;
        align-items: flex-end;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: 8px 16px;
    }

    /* Two columns: the lanes over the RadViz and the week calendar; the
       clock over the parallel coordinates. One column when it is narrow.
       See `yearLayout`. */
    .year-grid {
        display: grid;
        grid-template-columns: minmax(0, 1fr) var(--side);
        grid-template-areas:
            'lanes clock'
            'bottom parallel';
        align-items: start;
        gap: var(--row-gap) var(--column-gap);
    }

    .year-grid.stacked {
        grid-template-columns: minmax(0, 1fr);
        grid-template-areas: 'lanes' 'bottom' 'clock' 'parallel';
    }

    .year-grid > :global(.lanes) {
        grid-area: lanes;
        min-width: 0;
    }

    .year-grid > :global(.year-clock) {
        grid-area: clock;
    }

    .year-grid > :global(.parallel) {
        grid-area: parallel;
    }

    /* The RadViz under the lanes' labels and projections; the week calendar
       where the lanes' bars start, on their days. */
    .year-bottom {
        grid-area: bottom;
        min-width: 0;
        display: grid;
        grid-template-columns: var(--left) minmax(0, 1fr);
        align-items: start;
    }

    .calendar-foot {
        display: flex;
        align-items: center;
        gap: 8px;
        padding-top: 20px;
        border-top: 1px solid hsl(var(--border));
        font-size: var(--text-small);
        color: hsl(var(--muted-foreground));
    }
</style>
