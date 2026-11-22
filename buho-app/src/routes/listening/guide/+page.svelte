<script lang="ts">
    import { onDestroy, onMount, tick } from 'svelte';
    import { dataStore } from '#lib/stores/dataStore.svelte.ts';
    import { uiStore, setListeningGuideScrollTop } from '#lib/stores/uiStore.svelte.ts';
    import { sectionView } from '#lib/actions/sectionView.ts';

    import ModuleEmptyState from '#lib/components/ModuleEmptyState.svelte';
    import { moduleById } from '#lib/data/modules.ts';
    import GuidePage from '#lib/components/guide/GuidePage.svelte';
    import GuideSection from '#lib/components/guide/GuideSection.svelte';
    import Scrolly from '#lib/components/guide/Scrolly.svelte';
    import PlayRecordCard from '#lib/components/guide/PlayRecordCard.svelte';
    import ChartFrame from '#lib/components/ChartFrame.svelte';
    import BarChartRace, { type RaceRow } from '#lib/components/visualizations/BarChartRace.svelte';
    import ListeningConstellation from '#lib/components/visualizations/guide/ListeningConstellation.svelte';
    import DiscoverySediment from '#lib/components/visualizations/guide/DiscoverySediment.svelte';
    import GuideToExploreHandoffSection from '#lib/components/sections/GuideToExploreHandoffSection.svelte';

    import {
        getAllConnectablePoints,
        getMacroStats,
        getPlayRecord,
        type ConnectablePoint,
        type MacroStats,
        type PlayRecord,
    } from '#lib/data/queries/behaviorQueries.ts';
    import {
        getDailyListeningCalendar,
        getHourWeekdayMinutes,
        type DailyCalendarPoint,
        type HourWeekdayCell,
    } from '#lib/data/queries/temporalQueries.ts';
    import {
        getTopArtistsMonthly,
        type ArtistMonthlyPoint,
    } from '#lib/data/queries/artistQueries.ts';
    import {
        getArtistDiscoveryRecency,
        getMonthlyDiscoveryCohorts,
        type ArtistDiscoveryRecencyData,
        type MonthlyCohortPoint,
    } from '#lib/data/queries/discoveryQueries.ts';

    import {
        artistRidgelineChart,
        calendarHeatmapChart,
        discoveryRecencyChart,
        listeningClockChart,
    } from '#lib/visualizations/d3/listeningCharts.ts';

    import {
        clockOf,
        formatDayLabel,
        pickFocusDay,
        spanLabel,
    } from '#lib/visualizations/listeningStory.ts';
    import { longestDailyStreak } from '#lib/utils/streak.ts';
    import { formatDurationLong } from '#lib/utils/duration.ts';
    import { MEASURE_OPTIONS, formatMeasure } from '#lib/utils/measure.ts';
    import { listeningMeasure } from '#lib/stores/listeningMeasure.svelte.ts';
    import type { Measure } from '#lib/data/sql/measure.ts';
    import MeasureToggle from '#lib/components/visualizations/MeasureToggle.svelte';
    import { trackControl } from '#lib/analytics.ts';

    const DAY_LABELS = [
        'Sunday',
        'Monday',
        'Tuesday',
        'Wednesday',
        'Thursday',
        'Friday',
        'Saturday',
    ];

    const dbReady = $derived(dataStore.loaded.listening && !dataStore.isLoading);

    /**
     * What the charts count. Shared with the Explorer, and not always a choice:
     * a history of Last.fm scrobbles carries no duration on any row, so there
     * the guide counts plays and the toggle is not shown.
     */
    const measure = $derived(listeningMeasure.measure);

    let points = $state<ConnectablePoint[]>([]);
    let clock = $state<HourWeekdayCell[]>([]);
    let calendar = $state<DailyCalendarPoint[]>([]);
    let macro = $state<MacroStats | null>(null);
    let artistMonths = $state<ArtistMonthlyPoint[]>([]);
    let ridgeRows = $state<ArtistMonthlyPoint[]>([]);
    let cohorts = $state<MonthlyCohortPoint[]>([]);
    let lifespans = $state<ArtistDiscoveryRecencyData[]>([]);
    let record = $state<PlayRecord | null>(null);

    // The whole guide reads one table the import has already finished building,
    // so it loads in a single pass rather than section by section.
    let loaded = false;
    $effect(() => {
        if (!dbReady || loaded) return;
        loaded = true;
        (async () => {
            const [allPoints, hourGrid, macroStats, monthlyCohorts, recency] = await Promise.all([
                getAllConnectablePoints(),
                getHourWeekdayMinutes(),
                getMacroStats(),
                getMonthlyDiscoveryCohorts(),
                getArtistDiscoveryRecency(20, 400),
            ]);
            points = allPoints;
            clock = hourGrid;
            macro = macroStats;
            cohorts = monthlyCohorts;
            lifespans = recency;
        })();
    });

    // The three charts whose numbers *are* the measure, reloaded when it
    // changes. The rest carry both counts already, or neither.
    let measureLoaded: Measure | null = null;
    $effect(() => {
        const active = measure;
        if (!dbReady || measureLoaded === active) return;
        measureLoaded = active;
        (async () => {
            const [daily, artistRace, ridge] = await Promise.all([
                getDailyListeningCalendar(active),
                getTopArtistsMonthly(null, active),
                getTopArtistsMonthly(40, active),
            ]);
            // A slower earlier measure must not land on top of the current one.
            if (measureLoaded !== active) return;
            calendar = daily;
            artistMonths = artistRace;
            ridgeRows = ridge;
        })();
    });

    /* --- the opening act --------------------------------------------------- */

    let activeStep = $state(0);

    const focus = $derived(pickFocusDay(points));
    const firstPlay = $derived(focus?.points[0] ?? null);

    /** The full row behind the play the act zooms in on. */
    let recordFor: string | null = null;
    $effect(() => {
        const playedAt = firstPlay?.metadata?.playedAt;
        if (typeof playedAt !== 'string' || playedAt === recordFor) return;
        recordFor = playedAt;
        getPlayRecord(playedAt).then((row) => {
            record = row;
        });
    });

    /* --- derived narration ------------------------------------------------- */

    const streak = $derived(longestDailyStreak(calendar.map((d) => d.date)));

    const busiestDay = $derived.by(() => {
        let best: DailyCalendarPoint | null = null;
        for (const day of calendar) {
            if (!best || day.value > best.value) best = day;
        }
        return best;
    });

    /** The cell's value under the active measure — the query counts both. */
    const cellValue = $derived((cell: HourWeekdayCell) =>
        measure === 'plays' ? cell.plays : cell.minutes
    );

    const peakCell = $derived.by(() => {
        let best: HourWeekdayCell | null = null;
        for (const cell of clock) {
            if (!best || cellValue(cell) > cellValue(best)) best = cell;
        }
        return best;
    });

    const raceRows = $derived<RaceRow[]>(
        artistMonths.map((d) => ({
            month: d.month,
            name: d.artist,
            value: d.value,
        }))
    );

    const formatValue = $derived((v: number) => formatMeasure(measure, v));

    /** Artists still being played more than a year after the first play. */
    const keepers = $derived(
        lifespans.filter(
            (a) =>
                Date.parse(`${a.lastDate}T00:00:00Z`) - Date.parse(`${a.firstDate}T00:00:00Z`) >
                365 * 86_400_000
        ).length
    );

    function formatDay(date: string): string {
        const parsed = new Date(`${date}T00:00:00Z`);
        return Number.isNaN(parsed.getTime())
            ? date
            : parsed.toLocaleDateString(undefined, { timeZone: 'UTC' });
    }

    /* Measured so the wide charts fill the page instead of Plot's 640px default. */
    let clockWidth = $state(0);
    let calendarWidth = $state(0);
    let ridgeWidth = $state(0);
    let lifespanWidth = $state(0);

    /* --- scroll position --------------------------------------------------- */

    // The guide is long; coming back from the Explorer should not send the
    // reader to the top of it again.
    function handleScroll(event: Event) {
        setListeningGuideScrollTop((event.target as HTMLElement).scrollTop);
    }

    onMount(async () => {
        await tick();
        await tick();
        const content = document.querySelector('.listening-content');
        if (!(content instanceof HTMLElement)) return;
        if (uiStore.listeningGuideScrollTop > 0) {
            content.scrollTop = uiStore.listeningGuideScrollTop;
        }
        content.addEventListener('scroll', handleScroll, { passive: true });
    });

    onDestroy(() => {
        const content = document.querySelector('.listening-content');
        if (!(content instanceof HTMLElement)) return;
        content.removeEventListener('scroll', handleScroll);
        setListeningGuideScrollTop(content.scrollTop);
    });
</script>

{#snippet stepEverything()}
    <h3>Everything you played</h3>
    <p>
        <b>{points.length.toLocaleString()}</b> plays, one square each. This is the chart the Explorer
        opens on. The next four steps take it apart and put it back together.
    </p>
{/snippet}

{#snippet stepOnePlay()}
    <h3>One play</h3>
    {#if firstPlay && focus}
        <p>
            All the other squares removed, leaving the play from
            <b>{clockOf(firstPlay)}</b> on
            <b>{formatDayLabel(focus.date)}</b>. Here is everything the export records about it:
        </p>
        {#if record}
            <PlayRecordCard {record} />
        {/if}
        <p>
            Two of those fields set its position. The <b>date</b> places it left to right. The
            <b>time</b> places it top to bottom — midnight at the top, noon in the middle, midnight again
            at the bottom.
        </p>
    {:else}
        <p>No play to show.</p>
    {/if}
{/snippet}

{#snippet stepDay()}
    <h3>One day</h3>
    {#if focus && focus.points.length > 1}
        <p>
            The rest of that day added back: <b>{focus.points.length}</b> plays between
            <b>{spanLabel(focus.points)}</b>.
        </p>
        <p>
            They share a date, so they share a horizontal position. A day is a vertical line, and
            the gaps in it are the hours you did not play anything.
        </p>
    {:else}
        <p>A day of plays is a vertical line: same date, different times.</p>
    {/if}
{/snippet}

{#snippet stepMonths()}
    <h3>Two months</h3>
    <p>
        The 60 days around it, each one its own vertical line. Days with no plays leave an empty
        column.
    </p>
{/snippet}

{#snippet stepBack()}
    <h3>Everything again</h3>
    <p>
        Back to all <b>{points.length.toLocaleString()}</b> plays, same two axes. Every square is one
        row of the export, placed by its date and its time of day.
    </p>
    <p>Hover any square to see which play it is.</p>
{/snippet}

<GuidePage>
    {#if !dbReady}
        <ModuleEmptyState module={moduleById('listening')} />
    {:else if points.length === 0 && !macro}
        <p class="empty" role="status">Reading your listening history…</p>
    {:else}
        <p class="lead">
            An export of your listening is a list of plays, one row per play. This guide starts from
            a single row and works up to the charts, so that each one says what it is made of.
        </p>

        {#if listeningMeasure.selectable}
            <MeasureToggle
                options={MEASURE_OPTIONS}
                label="Charts count"
                value={measure}
                onChange={(key) => {
                    trackControl('spotify-guide', 'measure', key);
                    listeningMeasure.set(key as Measure);
                }}
            />
        {/if}

        <GuideSection
            id="spotify-one-point"
            title="How to read the constellation"
            hint="Every square is one play. Horizontally: the day it happened — the time of day is deliberately dropped from this axis, since it is already the vertical one. Vertically: the time of day, midnight at the top. Only the width of the horizontal window changes between steps. The day it zooms in on is a busy but ordinary one, not the biggest in the export."
        >
            <Scrolly
                bind:activeStep
                label="How to read the constellation"
                steps={[stepEverything, stepOnePlay, stepDay, stepMonths, stepBack]}
            >
                {#snippet graphic()}
                    <ListeningConstellation {points} {focus} stage={activeStep} />
                {/snippet}
            </Scrolly>
        </GuideSection>

        <GuideSection
            id="spotify-clock"
            title="The same plays, by weekday and hour"
            hint="Each cell holds every play that landed on that weekday at that hour, anywhere in the export, coloured by the measure the charts count. Anything that repeats weekly stacks into one cell; one-off nights stay faint."
        >
            <p>
                The constellation has two axes, so there are two ways to collapse it. Drop which
                week a play happened in, keep its weekday and hour, and repeated habits stack up
                instead of spreading out.
            </p>
            {#if peakCell}
                <p class="coverage">
                    Highest cell:
                    <b>
                        {DAY_LABELS[peakCell.dow] ?? ''} at {String(peakCell.hour).padStart(
                            2,
                            '0'
                        )}:00
                    </b>, with <b>{formatValue(cellValue(peakCell))}</b> across the whole export.
                </p>
            {/if}
            <div bind:clientWidth={clockWidth}>
                {#if clock.length}
                    <ChartFrame
                        chartFn={(data) =>
                            listeningClockChart(data, {
                                width: Math.max(520, clockWidth),
                                measure,
                            })}
                        data={clock}
                        share={{
                            name: 'listening-clock',
                            title: 'The same plays, by weekday and hour',
                        }}
                    />
                {:else}
                    <p class="empty">No plays to place on the week.</p>
                {/if}
            </div>
        </GuideSection>

        <GuideSection
            id="spotify-calendar"
            title="The same plays, by day"
            hint="One square per day, coloured by the measure the charts count, laid out as a calendar year by year. Shows stretches — trips, gaps, months with a lot on — rather than habits."
        >
            <p>The other collapse: drop the time of day and keep the date. One square per day.</p>
            <p class="coverage">
                Longest run of consecutive days with at least one play:
                <b>{streak.length}</b>
                {streak.length === 1 ? 'day' : 'days'}{#if streak.start}, from
                    <b>{formatDay(streak.start)}</b>{/if}{#if busiestDay}. Biggest day: <b>
                        {formatDay(busiestDay.date)}
                    </b>, at
                    <b>{formatValue(busiestDay.value)}</b>{/if}.
            </p>
            <div class="bleed" bind:clientWidth={calendarWidth}>
                {#if calendar.length}
                    <ChartFrame
                        chartFn={(data) =>
                            calendarHeatmapChart(data, {
                                width: Math.max(700, calendarWidth - 48),
                                measure,
                            })}
                        data={calendar}
                        share={{
                            name: 'listening-calendar',
                            title: 'The same plays, by day',
                        }}
                    />
                {:else}
                    <p class="empty">No daily activity to draw.</p>
                {/if}
            </div>
        </GuideSection>

        <GuideSection
            id="spotify-totals"
            title="Totals"
            hint="Listening time counts milliseconds actually played, so a skipped track contributes almost nothing. A play counts as skipped when it ended on a skip-forward, a skip-back, or a stop. Both figures are left out when no export you loaded recorded them."
        >
            {#if macro}
                <div class="stats">
                    <!-- Left out rather than shown as zero when nothing on the
                         table carries a duration: a scrobble records that a
                         track was played, never for how long. -->
                    {#if macro.totalMinutes !== null}
                        <div class="stat">
                            <div class="value">
                                {formatDurationLong(macro.totalMinutes)}
                            </div>
                            <div class="label">Spent listening</div>
                        </div>
                    {/if}
                    <div class="stat">
                        <div class="value">
                            {points.length.toLocaleString()}
                        </div>
                        <div class="label">Plays</div>
                    </div>
                    <div class="stat">
                        <div class="value">
                            {macro.uniqueArtists.toLocaleString()}
                        </div>
                        <div class="label">Artists</div>
                    </div>
                    <div class="stat">
                        <div class="value">
                            {macro.uniqueTracks.toLocaleString()}
                        </div>
                        <div class="label">Tracks</div>
                    </div>
                </div>
                <p class="coverage">
                    {#if macro.skipRate !== null}<b>{macro.skipRate}%</b> of plays ended early, across{:else}Spread
                        across{/if}
                    <b>{calendar.length.toLocaleString()}</b> days with at least one play.
                </p>
            {/if}
        </GuideSection>

        <div id="spotify-artist-race" use:sectionView={'spotify-artist-race'}>
            <BarChartRace
                trackId="spotify-artist-race"
                title="Artists, month by month"
                hint="A running total per artist. Nothing is ever subtracted, so a bar can only grow — what changes is the order. A bar that stops growing is an artist you stopped playing."
                rows={raceRows}
                {formatValue}
                ariaLabel="Bar chart race of cumulative listening by artist"
                loadingLabel="Loading the artist race…"
            />
        </div>

        <GuideSection
            id="spotify-ridgeline"
            title="Each artist's listening over time"
            hint="One ridge per artist, ordered by the month of their first play. Ridge height is what that month was worth under the measure the charts count. Narrow peaks are short intense periods; long low ridges are artists played a little over a long time."
        >
            <p>The race shows the running totals. This shows when they were actually run up.</p>
            <div class="bleed" bind:clientWidth={ridgeWidth}>
                {#if ridgeRows.length}
                    <ChartFrame
                        chartFn={(data) =>
                            artistRidgelineChart(data, {
                                width: Math.max(700, ridgeWidth - 48),
                                measure,
                            })}
                        data={ridgeRows}
                        share={{
                            name: 'artist-ridgeline',
                            title: "Each artist's listening over time",
                        }}
                    />
                {:else}
                    <p class="empty">Not enough artists to lay out over time.</p>
                {/if}
            </div>
        </GuideSection>

        <GuideSection
            id="spotify-discovery-sediment"
            title="New tracks vs. tracks you already had"
            hint="Each column is one month of plays, split by the month the track was first played. A track's first-play month never changes, so older layers stay at the bottom while newer ones stack on top. Replay steps through the months one at a time."
        >
            <p>
                Every play is either a track you had heard before or one you had not. The bright
                layer on top is the plays of tracks discovered that month.
            </p>
            <DiscoverySediment data={cohorts} />
        </GuideSection>

        <GuideSection
            id="spotify-discovery-recency"
            title="How long you kept each artist"
            hint="One bubble per artist with at least 20 plays: horizontally the first play, vertically the last, sized by total plays. The dashed diagonal is first and last play on the same day; distance above it is how long the artist stayed in rotation."
        >
            {#if lifespans.length}
                <p class="coverage">
                    Of the <b>{lifespans.length}</b> artists shown,
                    <b>{keepers}</b> were still being played more than a year after their first play.
                </p>
                <div class="bleed" bind:clientWidth={lifespanWidth}>
                    <ChartFrame
                        chartFn={discoveryRecencyChart}
                        data={{
                            data: lifespans,
                            width: Math.max(700, lifespanWidth - 48),
                            height: 620,
                        }}
                        share={{
                            name: 'artist-lifespans',
                            title: 'How long you kept each artist',
                        }}
                    />
                </div>
            {:else}
                <p class="empty">Not enough repeat listening to compare artist lifespans.</p>
            {/if}
        </GuideSection>

        <GuideSection id="spotify-handoff" title="The Explorer">
            <p>
                The Explorer opens on the constellation from the first section: the same squares,
                the same two axes. It adds filters — by artist, device, country, reason — and
                redraws to show only the plays that match.
            </p>
            <GuideToExploreHandoffSection explorePath="listening/explore" />
        </GuideSection>
    {/if}
</GuidePage>

<style>
    /* Scoped to this page: GuidePage owns the layout and the shared classes
       (.coverage, .stats, .bleed), this only styles the prose written here. */
    p {
        font-size: var(--text-body);
        line-height: 1.6;
        color: hsl(var(--muted-foreground));
    }

    p + p {
        margin-top: 0.65rem;
    }

    p b {
        color: hsl(var(--foreground));
        font-weight: 600;
    }

    .lead {
        max-width: 860px;
        font-size: var(--text-lede);
        line-height: 1.65;
    }

    /* Step headings in the opening act: below the section title, above the body. */
    h3 {
        font-size: var(--text-lede);
        font-weight: 600;
        margin: 0 0 0.5rem;
        color: hsl(var(--foreground));
    }
</style>
