<script lang="ts">
    import { dataStore } from "$lib/stores/dataStore.svelte";
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
    } from "$lib/data/queries/googleMapsQueries";
    import { getZoneRollup } from "$lib/data/queries/geoQueries";
    import type { ZoneRollupRow } from "$lib/visualizations/zoneChoropleth";
    import ZoneChoroplethMap from "$lib/components/visualizations/guide/ZoneChoroplethMap.svelte";
    import SpeedDistributionChart from "$lib/components/visualizations/guide/SpeedDistributionChart.svelte";
    import DistanceCalendar from "$lib/components/visualizations/guide/DistanceCalendar.svelte";
    import DailyDistanceScatter from "$lib/components/visualizations/guide/DailyDistanceScatter.svelte";
    import DayRaceMap from "$lib/components/visualizations/guide/DayRaceMap.svelte";
    import BarChartRace, {
        type RaceRow,
    } from "$lib/components/visualizations/BarChartRace.svelte";
    import { sectionView } from "$lib/actions/sectionView";
    import InfoHint from "$lib/components/InfoHint.svelte";

    const dbReady = $derived(
        dataStore.source === "google-maps" && !dataStore.isLoading,
    );

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
                  (speed.bins
                      .slice(0, kmh)
                      .reduce((s, c) => s + c, 0) /
                      speed.totalLegs) *
                      100,
              )
            : 0;

    const formatHours = (h: number) => `${h.toFixed(0)}h`;

    /** Enrichment still running: the day-based sections are waiting on it. */
    const geoPending = $derived(
        !dataStore.geoReady && dataStore.geo?.status !== "failed",
    );
</script>

{#snippet geoPendingNote()}
    <p class="empty" role="status">
        Preparing your location data… <span class="pending-detail"
            >{dataStore.geo?.message ?? "Locating your points"}</span
        >
    </p>
{/snippet}

<div class="guide">
    {#if !dbReady}
        <p class="empty">Import your Google Timeline export to see the guide.</p>
    {:else}
        <section class="viz" use:sectionView={"maps-day-race"}>
            <h2>
                Every day at once
                <InfoHint
                    text="Every day you were tracked, replayed together on a single
                    24-hour clock. Each dot is one day of your life moving through
                    the map: still at home in the morning, spreading out across the
                    city, drifting back home at night."
                />
            </h2>
            {#if days.length && raceSegments?.numRows}
                <DayRaceMap {days} segments={raceSegments} />
            {:else if geoPending}
                {@render geoPendingNote()}
            {:else}
                <p class="empty">No per-day mobility data available.</p>
            {/if}
        </section>

        <section class="viz" use:sectionView={"maps-zone-choropleth"}>
            <h2>
                Where your time went
                <InfoHint
                    text="Every zone shaded by how much of your life you spent
                    inside it. Zoom in and the map follows you down a level on its
                    own — countries, then regions, then departments, then
                    arrondissements. Click a zone to fly to it."
                />
            </h2>
            <p class="sub">
                The darker the fill, the more time you spent there. Zoom into a
                country and it breaks apart into its regions; keep going and the
                regions break apart in turn.
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
        </section>

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

        <section class="viz" use:sectionView={"maps-distance-calendar"}>
            <h2>
                Your year in kilometres
                <InfoHint
                    text="One square per day, from January to December, the darker
                    the further you travelled that day. Holidays, commutes and quiet
                    weeks at home all leave their own pattern; pale grey squares are
                    days with no tracking at all."
                />
            </h2>
            {#if days.length}
                <DistanceCalendar data={days} />
            {:else if geoPending}
                {@render geoPendingNote()}
            {:else}
                <p class="empty">No per-day mobility data available.</p>
            {/if}
        </section>

        <section class="viz" use:sectionView={"maps-speed"}>
            <h2>
                How fast you move
                <InfoHint
                    text="How your trips split between walking, cycling, driving and
                    flying, measured as the average speed of every trip you made.
                    The peaks tell you which of those fills most of your travelling
                    life."
                />
            </h2>
            {#if speed && speed.totalLegs}
                <p class="coverage">
                    Across <b>{speed.totalLegs.toLocaleString()}</b> moving segments,
                    your median speed is <b>{speed.medianKmh.toFixed(0)} km/h</b>.
                    <b>{shareBelow(15)}%</b> are under 15 km/h (walking / cycling /
                    crawling traffic).
                </p>
                <SpeedDistributionChart
                    bins={speed.bins}
                    maxKmh={speed.maxKmh}
                    medianKmh={speed.medianKmh}
                />
            {:else}
                <p class="empty">No moving segments to derive speed from.</p>
            {/if}
        </section>

        <section class="viz" use:sectionView={"maps-daily-scatter"}>
            <h2>
                How far, and how far out
                <InfoHint
                    text="One dot per day, placed by whichever two measures you
                    choose — kilometres covered, average speed, when you left and
                    came back, how many new places you saw. Colour the cloud by city,
                    weekday or year and the days regroup around what they have in
                    common."
                />
            </h2>
            {#if days.length}
                <div class="bleed">
                    <DailyDistanceScatter data={days} />
                </div>
            {:else if geoPending}
                {@render geoPendingNote()}
            {:else}
                <p class="empty">No per-day mobility data available.</p>
            {/if}
        </section>
    {/if}
</div>

<style>
    .guide {
        width: 100%;
        margin: 0 auto;
        padding: 2rem 2rem 6rem;
        display: flex;
        flex-direction: column;
        gap: 4rem;
    }

    /* Charts span the full page width; the narrative text stays at a readable
       measure so lines don't stretch across the whole viewport. */
    .viz > h2,
    .viz > .coverage,
    .guide > .empty {
        max-width: 860px;
    }

    .viz h2 {
        font-size: 1.35rem;
        font-weight: 600;
        color: hsl(var(--foreground));
        margin: 0 0 1.25rem;
    }

    .coverage {
        font-size: 0.85rem;
        color: hsl(var(--muted-foreground));
        margin: 0 0 1.25rem;
        padding: 0.6rem 0.8rem;
        border-left: 2px solid #ea4335;
        background: hsl(var(--secondary) / 0.3);
        border-radius: 0 0.4rem 0.4rem 0;
    }
    .coverage b {
        color: hsl(var(--foreground));
        font-weight: 600;
    }

    .empty {
        color: hsl(var(--muted-foreground));
        font-size: 0.9rem;
    }

    .pending-detail {
        opacity: 0.7;
        font-variant-numeric: tabular-nums;
    }

    /* Break a chart out of the 860px reading column to (nearly) the viewport. */
    .bleed {
        width: min(100vw, 1500px);
        position: relative;
        left: 50%;
        transform: translateX(-50%);
        padding: 0 1.5rem;
        box-sizing: border-box;
    }
</style>
