<script lang="ts">
    import { onMount } from "svelte";
    import {
        getTopArtistsMonthlyDuration,
        type ArtistMonthlyDurationData,
    } from "$lib/data/queries/artistQueries";
    import type { DateRange } from "$lib/data/queries/common";
    import PlotChart from "$lib/components/PlotChart.svelte";
    import { artistRidgelinePlot } from "$lib/visualizations/plots/artistPlots";
    import { dataStore } from "$lib/stores/dataStore.svelte";
    import { spotifyFilterStore } from "$lib/stores/spotifyFilterStore.svelte";

    const TOP_N = 40;

    let data = $state<ArtistMonthlyDurationData[]>([]);
    let element: HTMLElement;
    let chartHost: HTMLElement;
    let chartWidth = $state(1100);
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
            data = await getTopArtistsMonthlyDuration(
                TOP_N,
                currentDateRange(),
            );
        } catch (e) {
            console.error("Failed to load artist ridgeline:", e);
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
                chartWidth = Math.max(640, Math.floor(chartHost.clientWidth));
            }
        });
        if (chartHost) {
            chartWidth = Math.max(640, Math.floor(chartHost.clientWidth));
            resizeObserver.observe(chartHost);
        }

        return () => {
            observer.disconnect();
            resizeObserver.disconnect();
        };
    });
</script>

<section bind:this={element} class="guide-section py-8">
    <div class="text-content mb-6">
        <h2 class="text-2xl font-bold mb-2">The shape of your obsessions</h2>
    </div>

    <div
        bind:this={chartHost}
        class="chart-container bg-surface-900 rounded-lg p-6 border border-surface-700 overflow-x-auto"
    >
        {#if data.length > 0}
            <PlotChart
                plotFn={(d) => artistRidgelinePlot(d, { width: chartWidth })}
                {data}
            />
        {:else if isVisible}
            <div
                class="w-full h-[500px] flex items-center justify-center opacity-50"
            >
                Loading ridgeline...
            </div>
        {:else}
            <div
                class="w-full h-[500px] flex items-center justify-center opacity-50"
            >
                Scroll to view
            </div>
        {/if}
    </div>
</section>
