<script lang="ts">
    import { dataStore } from '#lib/stores/dataStore.svelte.ts';
    import {
        getMonthlyDurationByCountry,
        getMonthlyDurationByRegion,
        getSpeedDistribution,
        getDays,
        getDayRaceSegments,
        type MonthlyDurationData,
        type SpeedDistribution,
        type DayRecord,
        type DayRaceSegmentRows,
    } from '#lib/data/queries/positionsQueries.ts';
    import { getZoneRollup } from '#lib/data/queries/geoQueries.ts';
    import type { ZoneRollupRow } from '#lib/visualizations/zoneChoropleth.ts';
    import ZoneChoroplethMap from '#lib/components/visualizations/guide/ZoneChoroplethMap.svelte';
    import SpeedDistributionChart from '#lib/components/visualizations/guide/SpeedDistributionChart.svelte';
    import DistanceCalendar from '#lib/components/visualizations/guide/DistanceCalendar.svelte';
    import DailyDistanceScatter from '#lib/components/visualizations/guide/DailyDistanceScatter.svelte';
    import DayRaceMap from '#lib/components/visualizations/guide/DayRaceMap.svelte';
    import RelativeTraceRace from '#lib/components/visualizations/guide/RelativeTraceRace.svelte';
    import { hasContinuousRows, hasEpisodicRows } from '#lib/visualizations/relativeTraces.ts';
    import BarChartRace, { type RaceRow } from '#lib/components/visualizations/BarChartRace.svelte';
    import ModuleEmptyState from '#lib/components/ModuleEmptyState.svelte';
    import { moduleById } from '#lib/data/modules.ts';
    import GuidePage from '#lib/components/guide/GuidePage.svelte';
    import GuideSection from '#lib/components/guide/GuideSection.svelte';

    const dbReady = $derived(dataStore.loaded.positions && !dataStore.isLoading);

    let speed = $state<SpeedDistribution | null>(null);
    let days = $state<DayRecord[]>([]);
    let raceSegments = $state<DayRaceSegmentRows | null>(null);
    let countryRows = $state<RaceRow[]>([]);
    let regionRows = $state<RaceRow[]>([]);
    let zoneRows = $state.raw<ZoneRollupRow[]>([]);

    const toRaceRows = (rows: MonthlyDurationData[]): RaceRow[] =>
        rows.map((r) => ({ month: r.month, name: r.name, value: r.hours }));

    // Speed and the raw race segments read the segments table directly, so they
    // are ready as soon as the import unblocks.
    let loaded = false;
    $effect(() => {
        if (!dbReady || loaded) return;
        loaded = true;
        (async () => {
            [speed, raceSegments] = await Promise.all([
                getSpeedDistribution(),
                getDayRaceSegments(),
            ]);
        })();
    });

    // The daily dataset is built twice — once from the raw segments, once more
    // with the place names — so it lands well before attribution completes.
    let daysLoadedVersion = 0;
    $effect(() => {
        const version = dataStore.daysVersion;
        if (!dbReady || version === 0 || version === daysLoadedVersion) return;
        daysLoadedVersion = version;
        (async () => {
            days = await getDays();
        })();
    });

    // The geo races need the attributed columns, so they wait for the whole
    // enrichment — cf. dataStore.enrichGeo.
    let geoLoadedVersion = 0;
    $effect(() => {
        const version = dataStore.geoVersion;
        if (!dbReady || version === 0 || version === geoLoadedVersion) return;
        geoLoadedVersion = version;
        (async () => {
            let country: MonthlyDurationData[];
            let region: MonthlyDurationData[];
            [country, region, zoneRows] = await Promise.all([
                getMonthlyDurationByCountry(),
                getMonthlyDurationByRegion(),
                getZoneRollup(),
            ]);
            countryRows = toRaceRows(country);
            regionRows = toRaceRows(region);
        })();
    });

    // Share of moving segments below a given km/h (sum of the 1-km/h bins).
    const shareBelow = (kmh: number) =>
        speed && speed.totalLegs > 0
            ? Math.round(
                  (speed.bins.slice(0, kmh).reduce((s, c) => s + c, 0) / speed.totalLegs) * 100
              )
            : 0;

    const formatHours = (h: number) => `${h.toFixed(0)}h`;

    // Which of the two relative-trace plots has anything to show. Each is a scan
    // of every row, so it is answered once per load rather than on every render.
    const hasContinuous = $derived(raceSegments ? hasContinuousRows(raceSegments) : false);
    const hasEpisodic = $derived(raceSegments ? hasEpisodicRows(raceSegments) : false);

    /** Enrichment still running: the day-based sections are waiting on it. */
    const geoPending = $derived(!dataStore.geoReady && dataStore.geo?.status !== 'failed');
</script>

{#snippet geoPendingNote()}
    <p class="empty" role="status">
        Preparing your location data… <span class="pending-detail">
            {dataStore.geo?.message ?? 'Locating your points'}
        </span>
    </p>
{/snippet}

<GuidePage>
    {#if !dbReady}
        <ModuleEmptyState module={moduleById('positions')} />
    {:else}
        <GuideSection
            id="maps-day-race"
            title="Every day at once"
            hint="Every day you were tracked, replayed together on a single 24-hour clock. Each dot is one day of your life moving through the map: still at home in the morning, spreading out across the city, drifting back home at night."
        >
            {#if days.length && raceSegments?.numRows}
                <DayRaceMap {days} segments={raceSegments} />
            {:else if geoPending}
                {@render geoPendingNote()}
            {:else}
                <p class="empty">No per-day mobility data available.</p>
            {/if}
        </GuideSection>

        {#if raceSegments && hasContinuous}
            <GuideSection
                id="maps-day-shapes"
                title="Every day from the same spot"
                hint="The same days, with the geography taken out: each one moved so its first recorded point sits at the centre, then all of them drawn over each other. Starts within a hundred metres of one another are treated as the same doorstep, so a phone's margin of error stops sliding whole days apart. The clock is the clock of the day, 04:00 to 04:00, so where a strand is along the bar says what time it was. What's left is the shape of a day — how far it reaches, in how many directions, how long it takes to come home."
            >
                <RelativeTraceRace {days} segments={raceSegments} mode="days" />
            </GuideSection>
        {/if}

        {#if raceSegments && hasEpisodic}
            <GuideSection
                id="maps-activity-shapes"
                title="Every outing from the same start"
                hint="One trace per recorded activity, each moved so it begins at the centre and each starting at zero — so a run at seven in the morning and one at seven in the evening lie on top of one another. Starts within a hundred metres of one another share a centre, so the seconds a watch spends finding you don't scatter the routes you always take. The clock is elapsed time, not time of day, which is the only way the shapes are comparable at all. It changes gear past the tick: everything longer than the usual outing plays out fast rather than being cut off."
            >
                <RelativeTraceRace {days} segments={raceSegments} mode="activities" />
            </GuideSection>
        {/if}

        <GuideSection
            id="maps-zone-choropleth"
            title="Where your time went"
            hint="Every zone shaded by how much of your life you spent inside it. Zoom in and the map follows you down a level on its own — countries, then regions, then departments, then arrondissements. Click a zone to fly to it."
        >
            <p class="sub">
                The darker the fill, the more time you spent there. Zoom into a country and it
                breaks apart into its regions; keep going and the regions break apart in turn.
            </p>
            {#if zoneRows.length}
                <div class="bleed">
                    <ZoneChoroplethMap rows={zoneRows} />
                </div>
            {:else if geoPending}
                {@render geoPendingNote()}
            {:else}
                <p class="empty">No located segments to map.</p>
            {/if}
        </GuideSection>

        <BarChartRace
            trackId="maps-country-race"
            title="Time spent by country"
            hint="A month-by-month race between the countries you spent time in,
            counting the hours as they add up. The bars reorder as the years go by
            and a trip, a move, or a long stay pushes a new country to the front."
            rows={countryRows}
            formatValue={formatHours}
            ariaLabel="Bar chart race of cumulative time spent by country"
            loadingLabel="Loading country race…"
        />

        <BarChartRace
            trackId="maps-region-race"
            title="Time spent by region"
            hint="The same race, one level closer to home: regions and states
            rather than countries. It shows where your life was really anchored,
            and when that anchor moved."
            rows={regionRows}
            formatValue={formatHours}
            ariaLabel="Bar chart race of cumulative time spent by region"
            loadingLabel="Loading region race…"
        />

        <GuideSection
            id="maps-distance-calendar"
            title="Your year in kilometres"
            hint="One square per day, from January to December, the darker the further you travelled that day. Holidays, commutes and quiet weeks at home all leave their own pattern; pale grey squares are days with no tracking at all."
        >
            {#if days.length}
                <DistanceCalendar data={days} />
            {:else if geoPending}
                {@render geoPendingNote()}
            {:else}
                <p class="empty">No per-day mobility data available.</p>
            {/if}
        </GuideSection>

        <GuideSection
            id="maps-speed"
            title="How fast you move"
            hint="How your trips split between walking, cycling, driving and flying, measured as the average speed of every trip you made. The peaks tell you which of those fills most of your travelling life."
        >
            {#if speed && speed.totalLegs}
                <p class="coverage">
                    Across <b>{speed.totalLegs.toLocaleString()}</b> moving segments, your median
                    speed is <b>{speed.medianKmh.toFixed(0)} km/h</b>.
                    <b>{shareBelow(15)}%</b> are under 15 km/h (walking / cycling / crawling traffic).
                </p>
                <SpeedDistributionChart
                    bins={speed.bins}
                    maxKmh={speed.maxKmh}
                    medianKmh={speed.medianKmh}
                />
            {:else}
                <p class="empty">No moving segments to derive speed from.</p>
            {/if}
        </GuideSection>

        <GuideSection
            id="maps-daily-scatter"
            title="How far, and how far out"
            hint="One dot per day, placed by whichever two measures you choose — kilometres covered, average speed, when you left and came back, how many new places you saw. Colour the cloud by city, weekday or year and the days regroup around what they have in common."
        >
            {#if days.length}
                <div class="bleed">
                    <DailyDistanceScatter data={days} />
                </div>
            {:else if geoPending}
                {@render geoPendingNote()}
            {:else}
                <p class="empty">No per-day mobility data available.</p>
            {/if}
        </GuideSection>
    {/if}
</GuidePage>

<style>
    /* Only what is specific to this guide; the rest comes from GuidePage. */
    .pending-detail {
        opacity: 0.7;
        font-variant-numeric: tabular-nums;
    }
</style>
