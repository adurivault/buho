<script lang="ts">
    import { onMount } from "svelte";
    import {
        getMonthlyDiscoveryCohorts,
        type MonthlyCohortPoint,
    } from "$lib/data/queries/discoveryQueries";
    import type { DateRange } from "$lib/data/queries/common";
    import {
        createDiscoverySediment,
        type SedimentChart,
        type SedimentColorMode,
    } from "$lib/visualizations/d3/discoverySediment";
    import { dataStore } from "$lib/stores/dataStore.svelte";
    import { spotifyFilterStore } from "$lib/stores/spotifyFilterStore.svelte";

    let data = $state<MonthlyCohortPoint[]>([]);
    let element: HTMLElement;
    let chartHost: HTMLElement;
    let chartNode = $state<HTMLDivElement | undefined>();
    let chart: SedimentChart | null = null;
    let chartWidth = $state(1100);
    let isVisible = $state(false);

    // Bar-chart-race animation: `nowTime` is the playhead (ms). null = settled / full chart.
    let nowTime = $state<number | null>(null);
    let colorMode = $state<SedimentColorMode>("discovery");
    let isPlaying = $state(false);
    let hasAutoPlayed = false;
    let animTimer: ReturnType<typeof setInterval> | undefined;

    function sortedMonths(): number[] {
        const set = new Set(data.map((d) => new Date(`${d.month}T00:00:00`).getTime()));
        return [...set].sort((a, b) => a - b);
    }

    function stopAnimation() {
        if (animTimer) clearInterval(animTimer);
        animTimer = undefined;
        isPlaying = false;
    }

    function playAnimation() {
        const months = sortedMonths();
        if (months.length < 2) return;
        stopAnimation();
        // Aim for ~8s total, clamped to a comfortable per-frame pace.
        const stepMs = Math.min(180, Math.max(45, Math.round(8000 / months.length)));
        let i = 0;
        nowTime = months[0];
        isPlaying = true;
        animTimer = setInterval(() => {
            i += 1;
            if (i >= months.length) {
                nowTime = months[months.length - 1];
                stopAnimation();
                return;
            }
            nowTime = months[i];
        }, stepMs);
    }

    // Auto-play once, the first time data is ready while the section is on screen.
    $effect(() => {
        if (!hasAutoPlayed && isVisible && data.length > 0) {
            hasAutoPlayed = true;
            playAnimation();
        }
    });

    // Drive the D3 chart: create it once the node exists, then redraw whenever data, the
    // playhead, or the width changes (this $effect tracks all three reactive reads).
    $effect(() => {
        if (!chartNode) return;
        if (!chart) chart = createDiscoverySediment(chartNode);
        chart.update(data, { width: chartWidth, nowTime, colorMode });
    });

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
            stopAnimation();
            nowTime = null; // settle to the full chart until (re)played
            data = await getMonthlyDiscoveryCohorts(currentDateRange());
        } catch (e) {
            console.error("Failed to load discovery curve:", e);
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
            stopAnimation();
            chart?.destroy();
            chart = null;
        };
    });
</script>

<section bind:this={element} class="guide-section py-8">
    <div class="text-content mb-6">
        <h2 class="text-2xl font-bold mb-2">Discovery sedimentation</h2>
        <p class="opacity-80 max-w-3xl">
            The chart builds up month by month. Each column stacks your plays
            by <strong>track discovery date</strong>: at first everything is
            fresh (light yellow) and fits on a single bar. Then the months pile
            up, the legend stretches, and as time passes the past browns — old
            discoveries drift toward brown, while new light layers stack on top.
            Switch to <strong>Age when played</strong> to color each layer by
            the track's actual age at the moment you were listening to it.
        </p>
    </div>

    <div class="flex flex-wrap items-center gap-3 mb-4">
        <button
            type="button"
            class="px-3 py-1.5 rounded-md bg-surface-700 hover:bg-surface-600 border border-surface-600 text-sm transition-colors disabled:opacity-50"
            onclick={playAnimation}
            disabled={data.length < 2 || isPlaying}
        >
            {isPlaying ? "▶ Playing…" : "↻ Replay animation"}
        </button>

        <div
            class="inline-flex rounded-md border border-surface-600 overflow-hidden text-sm"
            role="group"
            aria-label="Color mode"
        >
            <button
                type="button"
                class="px-3 py-1.5 transition-colors {colorMode === 'discovery'
                    ? 'bg-surface-600 text-white'
                    : 'bg-surface-800 hover:bg-surface-700 opacity-70'}"
                onclick={() => (colorMode = "discovery")}
            >
                Discovery date
            </button>
            <button
                type="button"
                class="px-3 py-1.5 transition-colors border-l border-surface-600 {colorMode === 'age'
                    ? 'bg-surface-600 text-white'
                    : 'bg-surface-800 hover:bg-surface-700 opacity-70'}"
                onclick={() => (colorMode = "age")}
            >
                Age when played
            </button>
        </div>
    </div>

    <div
        bind:this={chartHost}
        class="chart-container relative bg-surface-900 rounded-lg p-6 border border-surface-700 overflow-x-auto"
    >
        <div bind:this={chartNode} class="w-full"></div>
        {#if data.length === 0}
            <div
                class="absolute inset-0 flex items-center justify-center opacity-50"
            >
                {isVisible ? "Loading discovery curve..." : "Scroll to view"}
            </div>
        {/if}
    </div>
</section>
