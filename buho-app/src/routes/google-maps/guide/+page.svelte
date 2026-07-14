<script lang="ts">
    import { dataStore } from "$lib/stores/dataStore.svelte";
    import {
        getNightsPerPlace,
        getNightCoverage,
        getUncoveredNights,
        getMonthlyDurationByCountry,
        getMonthlyDurationByRegion,
        getSpeedDistribution,
        getDays,
        type NightsPerPlace,
        type NightCoverage,
        type UncoveredNight,
        type MonthlyDurationData,
        type SpeedDistribution,
        type DayRecord,
    } from "$lib/data/queries/googleMapsQueries";
    import NightsPerPlaceChart from "$lib/components/visualizations/guide/NightsPerPlaceChart.svelte";
    import SpeedDistributionChart from "$lib/components/visualizations/guide/SpeedDistributionChart.svelte";
    import DistanceCalendar from "$lib/components/visualizations/guide/DistanceCalendar.svelte";
    import DailyDistanceScatter from "$lib/components/visualizations/guide/DailyDistanceScatter.svelte";
    import BarChartRace, {
        type RaceRow,
    } from "$lib/components/visualizations/BarChartRace.svelte";

    const dbReady = $derived(
        dataStore.source === "google-maps" && !dataStore.isLoading,
    );

    let nights = $state<NightsPerPlace[]>([]);
    let coverage = $state<NightCoverage | null>(null);
    let uncovered = $state<UncoveredNight[]>([]);
    let speed = $state<SpeedDistribution | null>(null);
    let days = $state<DayRecord[]>([]);
    let countryRows = $state<RaceRow[]>([]);
    let regionRows = $state<RaceRow[]>([]);

    const pct = (n: number, total: number) =>
        total > 0 ? Math.round((n / total) * 100) : 0;

    const toRaceRows = (rows: MonthlyDurationData[]): RaceRow[] =>
        rows.map((r) => ({ month: r.month, name: r.name, value: r.hours }));

    let loaded = false;
    $effect(() => {
        if (!dbReady || loaded) return;
        loaded = true;
        (async () => {
            let country: MonthlyDurationData[];
            let region: MonthlyDurationData[];
            [nights, coverage, uncovered, speed, days, country, region] =
                await Promise.all([
                    getNightsPerPlace(25),
                    getNightCoverage(),
                    getUncoveredNights(),
                    getSpeedDistribution(),
                    getDays(),
                    getMonthlyDurationByCountry(),
                    getMonthlyDurationByRegion(),
                ]);
            countryRows = toRaceRows(country);
            regionRows = toRaceRows(region);
        })();
    });

    // Aggregates over the uncovered nights, sorted most-frequent first.
    function tally(
        rows: UncoveredNight[],
        keyOf: (r: UncoveredNight) => string,
    ): { key: string; count: number }[] {
        const m = new Map<string, number>();
        for (const r of rows) {
            const k = keyOf(r);
            m.set(k, (m.get(k) ?? 0) + 1);
        }
        return [...m.entries()]
            .map(([key, count]) => ({ key, count }))
            .sort((a, b) => b.count - a.count);
    }

    const byCountry = $derived(tally(uncovered, (r) => r.country));
    const byYear = $derived(tally(uncovered, (r) => r.year).sort((a, b) =>
        a.key.localeCompare(b.key),
    ));
    const travelCount = $derived(
        uncovered.filter((r) => r.kind === "travel").length,
    );
    // The country where most days start — the user's base, so "abroad" isn't
    // hardcoded to any particular country.
    const homeCountry = $derived.by(() => {
        const counts = new Map<string, number>();
        for (const d of days) {
            if (d.startCountry === "Unknown") continue;
            counts.set(d.startCountry, (counts.get(d.startCountry) ?? 0) + 1);
        }
        let best: string | null = null;
        let bestN = 0;
        for (const [c, n] of counts) {
            if (n > bestN) { best = c; bestN = n; }
        }
        return best;
    });
    const abroadCount = $derived(
        homeCountry === null
            ? 0
            : uncovered.filter(
                  (r) => r.country !== "None" && r.country !== homeCountry,
              ).length,
    );

    // Speed distribution summary shares (over the bucketed legs).
    const speedTotal = $derived(
        speed ? speed.buckets.reduce((s, b) => s + b.count, 0) : 0,
    );
    const shareBelow = (kmh: number) =>
        speed && speedTotal > 0
            ? Math.round(
                  (speed.buckets
                      .filter((b) => b.hi !== null && b.hi <= kmh)
                      .reduce((s, b) => s + b.count, 0) /
                      speedTotal) *
                      100,
              )
            : 0;

    const formatHours = (h: number) => `${h.toFixed(0)}h`;
</script>

<div class="guide">
    {#if !dbReady}
        <p class="empty">Upload your Google Timeline export to see the guide.</p>
    {:else}
        <section class="viz">
            <h2>Where you spent the most nights</h2>
            <p class="sub">
                Distinct nights (presence at 04:00) per place, top 25.
            </p>
            {#if coverage}
                <p class="coverage">
                    Of <b>{coverage.totalNights.toLocaleString()}</b> tracked
                    nights, this heuristic captures
                    <b
                        >{coverage.stationaryNights.toLocaleString()} ({pct(
                            coverage.stationaryNights,
                            coverage.totalNights,
                        )}%)</b
                    >. Missed:
                    {coverage.movingOnlyNights.toLocaleString()} overnight travel,
                    {coverage.uncoveredNights.toLocaleString()} tracking gaps.
                </p>
            {/if}
            {#if nights.length}
                <NightsPerPlaceChart data={nights} />
            {:else}
                <p class="empty">No stationary nights found.</p>
            {/if}
        </section>

        <section class="viz">
            <h2>The nights without a place — where do they come from?</h2>
            <p class="sub">
                Every night with no stationary visit at 04:00, tagged with the
                country of the nearest segment in time (±2 days).
            </p>
            {#if uncovered.length}
                <p class="coverage">
                    <b>{uncovered.length.toLocaleString()}</b> nights missed.
                    <b>{travelCount.toLocaleString()}</b> were spent in transit
                    (a trip covers 04:00){#if homeCountry};
                        <b>{abroadCount.toLocaleString()}</b> fall outside
                        {homeCountry} by the nearest segment — so
                        {pct(abroadCount, uncovered.length)}% look abroad /
                        other timezone{/if}.
                </p>

                <div class="cols">
                    <div class="col">
                        <h3>By country</h3>
                        <ul class="bars">
                            {#each byCountry.slice(0, 12) as row (row.key)}
                                <li>
                                    <span class="lbl">{row.key}</span>
                                    <span
                                        class="bar"
                                        style:width="{pct(
                                            row.count,
                                            byCountry[0].count,
                                        )}%"
                                    ></span>
                                    <span class="num">{row.count}</span>
                                </li>
                            {/each}
                        </ul>
                    </div>
                    <div class="col">
                        <h3>By year</h3>
                        <ul class="bars">
                            {#each byYear as row (row.key)}
                                <li>
                                    <span class="lbl">{row.key}</span>
                                    <span
                                        class="bar"
                                        style:width="{pct(
                                            row.count,
                                            Math.max(
                                                ...byYear.map((y) => y.count),
                                            ),
                                        )}%"
                                    ></span>
                                    <span class="num">{row.count}</span>
                                </li>
                            {/each}
                        </ul>
                    </div>
                </div>
            {:else}
                <p class="empty">No uncovered nights — full coverage.</p>
            {/if}
        </section>

        <section class="viz">
            <h2>How fast you move</h2>
            <p class="sub">
                Google Timeline stores no speed, so this is derived: each raw GPS
                path leg's distance over its duration. Glitchy legs above 400
                km/h are dropped as GPS noise.
            </p>
            {#if speed && speed.totalLegs}
                <p class="coverage">
                    Across <b>{speed.totalLegs.toLocaleString()}</b> path legs, your
                    median speed is <b>{speed.medianKmh.toFixed(0)} km/h</b>.
                    <b>{shareBelow(15)}%</b> of legs are under 15 km/h (walking /
                    cycling / crawling traffic).
                </p>
                <SpeedDistributionChart
                    data={speed.buckets}
                    medianKmh={speed.medianKmh}
                />
            {:else}
                <p class="empty">No moving path legs to derive speed from.</p>
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
                One dot per day: horizontally, the total distance travelled;
                vertically, the farthest you got from where the day started;
                coloured by that starting city.
            </p>
            {#if days.length}
                <DailyDistanceScatter data={days} />
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
        max-width: 860px;
        margin: 0 auto;
        padding: 2rem 1.5rem 6rem;
        display: flex;
        flex-direction: column;
        gap: 4rem;
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

    .cols {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 2rem;
    }
    @media (max-width: 640px) {
        .cols {
            grid-template-columns: 1fr;
        }
    }

    .col h3 {
        font-size: 0.8rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: hsl(var(--muted-foreground));
        margin: 0 0 0.75rem;
    }

    .bars {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 0.3rem;
    }
    .bars li {
        display: grid;
        grid-template-columns: 6.5rem 1fr auto;
        align-items: center;
        gap: 0.5rem;
        font-size: 0.82rem;
    }
    .lbl {
        color: hsl(var(--foreground));
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }
    .bar {
        height: 0.7rem;
        min-width: 2px;
        border-radius: 2px;
        background: #ea4335;
        opacity: 0.85;
    }
    .num {
        color: hsl(var(--muted-foreground));
        font-variant-numeric: tabular-nums;
    }
</style>
