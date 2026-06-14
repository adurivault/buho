<script lang="ts">
    import { onMount } from "svelte";
    import {
        getArtistDiscoveryRecency,
        type ArtistDiscoveryRecencyData,
    } from "$lib/data/queries/discoveryQueries";
    import type { DateRange } from "$lib/data/queries/common";
    import PlotChart from "$lib/components/PlotChart.svelte";
    import { discoveryRecencyScatterPlot } from "$lib/visualizations/plots/discoveryPlots";
    import { dataStore } from "$lib/stores/dataStore.svelte";
    import { spotifyFilterStore } from "$lib/stores/spotifyFilterStore.svelte";

    let data = $state<ArtistDiscoveryRecencyData[]>([]);
    let element: HTMLElement;
    let chartHost: HTMLElement;
    let chartWidth = $state(1200);
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
            data = await getArtistDiscoveryRecency(20, 400, currentDateRange());
        } catch (e) {
            console.error("Failed to load discovery/recency data:", e);
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
                chartWidth = Math.max(700, Math.floor(chartHost.clientWidth));
            }
        });
        if (chartHost) {
            chartWidth = Math.max(700, Math.floor(chartHost.clientWidth));
            resizeObserver.observe(chartHost);
        }

        return () => {
            observer.disconnect();
            resizeObserver.disconnect();
        };
    });

    const plotOptions = $derived({
        data,
        width: chartWidth,
        height: Math.max(620, Math.floor(chartWidth * 0.6)),
    });
</script>

<section bind:this={element} class="guide-section py-8">
    <div class="text-content mb-6">
        <h2 class="text-2xl font-bold mb-2">Lifelong loves vs. one-night stands</h2>
        <p class="opacity-80 max-w-3xl">
            Each bubble is an artist: X axis = when you discovered them, Y axis
            = your last listen, size = number of plays. The diagonal is the
            "played then instantly forgotten" line. The higher a bubble sits
            above it, the longer the story lasted.
        </p>
    </div>

    <div
        bind:this={chartHost}
        class="chart-container bg-surface-900 rounded-lg p-6 border border-surface-700 overflow-x-auto"
    >
        {#if data.length > 0}
            <PlotChart plotFn={discoveryRecencyScatterPlot} data={plotOptions} />
        {:else if isVisible}
            <div class="w-full h-[620px] flex items-center justify-center opacity-50">
                Loading artist lifecycle...
            </div>
        {:else}
            <div class="w-full h-[620px] flex items-center justify-center opacity-50">
                Scroll to view
            </div>
        {/if}
    </div>
</section>
