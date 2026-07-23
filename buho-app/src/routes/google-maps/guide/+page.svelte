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
    import SpeedDistributionChart from "$lib/components/visualizations/guide/SpeedDistributionChart.svelte";
    import DistanceCalendar from "$lib/components/visualizations/guide/DistanceCalendar.svelte";
    import DailyDistanceScatter from "$lib/components/visualizations/guide/DailyDistanceScatter.svelte";
    import DayRaceMap from "$lib/components/visualizations/guide/DayRaceMap.svelte";
    import BarChartRace, {
        type RaceRow,
    } from "$lib/components/visualizations/BarChartRace.svelte";

    const dbReady = $derived(
        dataStore.source === "google-maps" && !dataStore.isLoading,
    );

    let speed = $state<SpeedDistribution | null>(null);
    let days = $state<DayRecord[]>([]);
    let raceSegments = $state<DayRaceSegmentRows | null>(null);
    let countryRows = $state<RaceRow[]>([]);
    let regionRows = $state<RaceRow[]>([]);

    const toRaceRows = (rows: MonthlyDurationData[]): RaceRow[] =>
        rows.map((r) => ({ month: r.month, name: r.name, value: r.hours }));

    let loaded = false;
    $effect(() => {
        if (!dbReady || loaded) return;
        loaded = true;
        (async () => {
            let country: MonthlyDurationData[];
            let region: MonthlyDurationData[];
            [speed, days, raceSegments, country, region] =
                await Promise.all([
                    getSpeedDistribution(),
                    getDays(),
                    getDayRaceSegments(),
                    getMonthlyDurationByCountry(),
                    getMonthlyDurationByRegion(),
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
</script>

<div class="guide">
    {#if !dbReady}
        <p class="empty">Import your Google Timeline export to see the guide.</p>
    {:else}
        <section class="viz">
            <h2>How fast you move</h2>
            <p class="sub">
                Google Timeline stores no speed, so this is derived: each moving
                segment's travelled distance over its duration, in 1 km/h bins.
                Glitchy segments above 400 km/h are dropped as GPS noise.
            </p>
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

        <section class="viz">
            <h2>Your year in kilometres</h2>
            <p class="sub">
                Every day coloured by how far you travelled — a GitHub-style
                activity calendar over the distance you covered.
            </p>
            {#if days.length}
                <DistanceCalendar data={days} />
            {:else}
                <p class="empty">No per-day mobility data available.</p>
            {/if}
        </section>

        <section class="viz">
            <h2>How far, and how far out</h2>
            <p class="sub">
                One dot per day. Pick any two metrics for the axes — distance,
                speed, departure / return time, novelty, places — and colour the
                cloud by start city, weekday, or the calendar. Everything
                rearranges with a transition.
            </p>
            {#if days.length}
                <div class="bleed">
                    <DailyDistanceScatter data={days} />
                </div>
            {:else}
                <p class="empty">No per-day mobility data available.</p>
            {/if}
        </section>

        <section class="viz">
            <h2>Every day at once</h2>
            <p class="sub">
                One dot per day, all racing the same 24-hour clock: home in the
                morning, fanning out across the city, converging back by night.
            </p>
            {#if days.length && raceSegments?.numRows}
                <DayRaceMap {days} segments={raceSegments} />
            {:else}
                <p class="empty">No per-day mobility data available.</p>
            {/if}
        </section>

        <BarChartRace
            title="Bar Chart Race: time spent by country"
            rows={countryRows}
            formatValue={formatHours}
            ariaLabel="Bar chart race of cumulative time spent by country"
            loadingLabel="Loading country race…"
        />

        <BarChartRace
            title="Bar Chart Race: time spent by region"
            rows={regionRows}
            formatValue={formatHours}
            ariaLabel="Bar chart race of cumulative time spent by region"
            loadingLabel="Loading region race…"
        />
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
    .viz > .sub,
    .viz > .coverage,
    .guide > .empty {
        max-width: 860px;
    }

    .viz h2 {
        font-size: 1.35rem;
        font-weight: 600;
        color: hsl(var(--foreground));
        margin: 0 0 0.25rem;
    }

    .sub {
        font-size: 0.85rem;
        color: hsl(var(--muted-foreground));
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
