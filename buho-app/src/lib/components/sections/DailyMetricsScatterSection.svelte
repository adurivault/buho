<script lang="ts">
    import {
        getDailyAnalysis,
        type DailyAnalysisData,
    } from "$lib/data/queries/temporalQueries";
    import type { DateRange } from "$lib/data/queries/common";
    import PlotChart from "$lib/components/PlotChart.svelte";
    import { dailyAnalysisScatterPlot } from "$lib/visualizations/plots/temporalPlots";
    import { dataStore } from "$lib/stores/dataStore.svelte";
    import { spotifyFilterStore } from "$lib/stores/spotifyFilterStore.svelte";
    import { onMount } from "svelte";

    type DailyMetricKey =
        | "dateEpochMs"
        | "playCount"
        | "totalMinutes"
        | "uniqueArtists"
        | "uniqueTracks"
        | "maxSameTrackPlays"
        | "shuffleRate"
        | "intentionalStopRate"
        | "intentionalStartRate"
        | "skipRate"
        | "eveningRate"
        | "meanListenHour"
        | "repeatIntensity";

    const METRIC_OPTIONS: Array<{ value: DailyMetricKey; label: string }> = [
        { value: "dateEpochMs", label: "Date" },
        { value: "playCount", label: "Nb d'écoutes" },
        { value: "totalMinutes", label: "Durée d'écoute (minutes)" },
        { value: "uniqueArtists", label: "Nb d'artistes uniques" },
        { value: "uniqueTracks", label: "Nb de chansons uniques" },
        { value: "maxSameTrackPlays", label: "Max écoutes d'une même chanson" },
        { value: "shuffleRate", label: "Taux shuffle (%)" },
        {
            value: "intentionalStopRate",
            label: "Taux d'arrêt intentionnel (%)",
        },
        {
            value: "intentionalStartRate",
            label: "Taux de lancement intentionnel (%)",
        },
        { value: "skipRate", label: "Taux de skip (%)" },
        { value: "eveningRate", label: "Taux d'écoute soirée (19h-5h) (%)" },
        { value: "meanListenHour", label: "Heure moyenne d'écoute" },
        {
            value: "repeatIntensity",
            label: "Intensité de répétition (écoutes/track)",
        },
    ];

    const METRIC_LABELS = Object.fromEntries(
        METRIC_OPTIONS.map((option) => [option.value, option.label]),
    ) as Record<DailyMetricKey, string>;

    let data = $state<DailyAnalysisData[]>([]);
    let xMetric = $state<DailyMetricKey>("dateEpochMs");
    let yMetric = $state<DailyMetricKey>("playCount");
    let element: HTMLElement;
    let chartHost: HTMLElement;
    let chartWidth = $state(1400);
    let isVisible = $state(false);

    function currentDateRange(): DateRange {
        return {
            startDate: spotifyFilterStore.startDate,
            endDate: spotifyFilterStore.endDate,
        };
    }

    $effect(() => {
        const _mode = dataStore.isDemo;
        const _range = spotifyFilterStore.rangeKey;
        if (isVisible && !dataStore.isLoading && dataStore.source) {
            fetchData();
        }
    });

    async function fetchData() {
        try {
            data = await getDailyAnalysis(currentDateRange());
        } catch (e) {
            console.error("Failed to load daily analysis:", e);
            data = [];
        }
    }

    onMount(() => {
        const observer = new IntersectionObserver(
            (entries) => {
                if (entries[0].isIntersecting) {
                    isVisible = true;
                    observer.disconnect();
                }
            },
            { threshold: 0.1 },
        );

        if (element) observer.observe(element);

        const resizeObserver = new ResizeObserver(() => {
            if (chartHost)
                chartWidth = Math.max(900, Math.floor(chartHost.clientWidth));
        });

        if (chartHost) {
            chartWidth = Math.max(900, Math.floor(chartHost.clientWidth));
            resizeObserver.observe(chartHost);
        }

        return () => {
            observer.disconnect();
            resizeObserver.disconnect();
        };
    });

    const plotOptions = $derived({
        data,
        xMetric,
        yMetric,
        xLabel: METRIC_LABELS[xMetric],
        yLabel: METRIC_LABELS[yMetric],
        width: chartWidth,
        height: Math.max(680, Math.floor(chartWidth * 0.55)),
    });
</script>

<section bind:this={element} class="guide-section py-8">
    <div class="text-content mb-6">
        <h2 class="text-2xl font-bold mb-2">Days: scatter plot</h2>
        <p class="opacity-80 max-w-3xl">
            One point = one day. Freely pick the axes from the daily metrics.
        </p>
    </div>

    <div class="mb-4 grid gap-4 md:grid-cols-2">
        <label class="text-sm">
            <span class="mb-2 block opacity-80">X axis</span>
            <select
                class="w-full rounded-md border border-surface-700 bg-surface-950 px-3 py-2"
                bind:value={xMetric}
            >
                {#each METRIC_OPTIONS as option}
                    <option value={option.value}>{option.label}</option>
                {/each}
            </select>
        </label>
        <label class="text-sm">
            <span class="mb-2 block opacity-80">Y axis</span>
            <select
                class="w-full rounded-md border border-surface-700 bg-surface-950 px-3 py-2"
                bind:value={yMetric}
            >
                {#each METRIC_OPTIONS as option}
                    <option value={option.value}>{option.label}</option>
                {/each}
            </select>
        </label>
    </div>

    <div
        bind:this={chartHost}
        class="chart-container bg-surface-900 rounded-lg p-6 border border-surface-700 overflow-x-auto"
    >
        {#if data.length > 0}
            <PlotChart plotFn={dailyAnalysisScatterPlot} data={plotOptions} />
        {:else if isVisible}
            <div
                class="w-full h-[680px] flex items-center justify-center opacity-50"
            >
                Loading daily scatter...
            </div>
        {:else}
            <div
                class="w-full h-[680px] flex items-center justify-center opacity-50"
            >
                Scroll to view
            </div>
        {/if}
    </div>
</section>
