<script lang="ts">
    import {
        getArtistAnalysis,
        type ArtistAnalysisData,
    } from "$lib/data/queries/artistQueries";
    import type { DateRange } from "$lib/data/queries/common";
    import PlotChart from "$lib/components/PlotChart.svelte";
    import { artistAnalysisScatterPlot } from "$lib/visualizations/plots/artistPlots";
    import { dataStore } from "$lib/stores/dataStore.svelte";
    import { spotifyFilterStore } from "$lib/stores/spotifyFilterStore.svelte";
    import { onMount } from "svelte";

    type ArtistMetricKey =
        | "totalMinutes"
        | "playCount"
        | "uniqueTracks"
        | "intentionalStopRate"
        | "shuffleRate"
        | "intentionalStartRate"
        | "meanListenDateEpochMs"
        | "listenDateVarianceDays2"
        | "eveningRate"
        | "recencyDays"
        | "activeDays"
        | "skipRate"
        | "repeatIntensity";

    const METRIC_OPTIONS: Array<{ value: ArtistMetricKey; label: string }> = [
        { value: "totalMinutes", label: "Durée d'écoute (minutes)" },
        { value: "playCount", label: "Nombre d'écoutes" },
        { value: "uniqueTracks", label: "Nb de chansons uniques" },
        {
            value: "intentionalStopRate",
            label: "Taux d'arrêt intentionnel (%)",
        },
        { value: "shuffleRate", label: "Taux d'écoute shuffle (%)" },
        {
            value: "intentionalStartRate",
            label: "Taux de lancement intentionnel (%)",
        },
        { value: "meanListenDateEpochMs", label: "Moyenne date d'écoute" },
        {
            value: "listenDateVarianceDays2",
            label: "Variance date d'écoute (jours²)",
        },
        { value: "eveningRate", label: "Taux d'écoute soirée (19h-5h) (%)" },
        {
            value: "recencyDays",
            label: "Recency (jours depuis dernière écoute)",
        },
        { value: "activeDays", label: "Nombre de jours actifs" },
        { value: "skipRate", label: "Taux de skip (%)" },
        {
            value: "repeatIntensity",
            label: "Intensité de répétition (écoutes/track)",
        },
    ];

    const METRIC_LABELS = Object.fromEntries(
        METRIC_OPTIONS.map((option) => [option.value, option.label]),
    ) as Record<ArtistMetricKey, string>;

    let data = $state<ArtistAnalysisData[]>([]);
    let xMetric = $state<ArtistMetricKey>("totalMinutes");
    let yMetric = $state<ArtistMetricKey>("repeatIntensity");
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
            const rows = await getArtistAnalysis(1000, currentDateRange());
            data = rows.filter((row) => row.playCount >= 20);
        } catch (e) {
            console.error("Failed to load artist analysis:", e);
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
            if (chartHost) {
                chartWidth = Math.max(900, Math.floor(chartHost.clientWidth));
            }
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
        <h2 class="text-2xl font-bold mb-2">Artists: scatter plot</h2>
        <p class="opacity-80 max-w-3xl">
            Each artist is a point. Pick the X/Y axes from the available
            metrics.
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
            <PlotChart plotFn={artistAnalysisScatterPlot} data={plotOptions} />
        {:else if isVisible}
            <div
                class="w-full h-[680px] flex items-center justify-center opacity-50"
            >
                Loading artist scatter...
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
