<script lang="ts">
    import { onMount } from 'svelte';
    import type { MonthlyCohortPoint } from '#lib/data/queries/discoveryQueries.ts';
    import {
        createDiscoverySediment,
        type SedimentChart,
        type SedimentColorMode,
    } from '#lib/visualizations/d3/discoverySediment.ts';
    import { trackControl } from '#lib/analytics.ts';

    /**
     * The discovery sediment stream with its playback controls: months stack up
     * one at a time behind a playhead, so the reader watches old discoveries sink
     * and fresh ones pile on top rather than reading a finished picture.
     */
    interface Props {
        data: MonthlyCohortPoint[];
        /** Plays itself once when it first has data; set false to wait for a click. */
        autoplay?: boolean;
    }

    let { data, autoplay = true }: Props = $props();

    /** Target length of the whole run, before the per-frame floor and ceiling. */
    const RUN_MS = 8000;
    const MIN_FRAME_MS = 45;
    const MAX_FRAME_MS = 180;

    let chartNode = $state<HTMLDivElement | undefined>();
    let width = $state(0);
    let chart: SedimentChart | null = null;

    /** Playhead in ms; null means settled on the finished chart. */
    let playhead = $state<number | null>(null);
    let colorMode = $state<SedimentColorMode>('discovery');
    let playing = $state(false);
    let timer: ReturnType<typeof setInterval> | undefined;
    let hasAutoPlayed = false;

    const months = $derived.by(() => {
        const unique = new Set(data.map((d) => new Date(`${d.month}T00:00:00`).getTime()));
        return [...unique].sort((a, b) => a - b);
    });

    function stop() {
        if (timer) clearInterval(timer);
        timer = undefined;
        playing = false;
    }

    function play() {
        if (months.length < 2) return;
        stop();
        const step = Math.min(
            MAX_FRAME_MS,
            Math.max(MIN_FRAME_MS, Math.round(RUN_MS / months.length))
        );
        let index = 0;
        playhead = months[0];
        playing = true;
        timer = setInterval(() => {
            index += 1;
            if (index >= months.length) {
                playhead = months[months.length - 1];
                stop();
                return;
            }
            playhead = months[index];
        }, step);
    }

    $effect(() => {
        if (autoplay && !hasAutoPlayed && data.length > 0) {
            hasAutoPlayed = true;
            play();
        }
    });

    $effect(() => {
        if (!chartNode || width < 10) return;
        if (!chart) chart = createDiscoverySediment(chartNode);
        chart.update(data, { width, nowTime: playhead, colorMode });
    });

    onMount(() => () => {
        stop();
        chart?.destroy();
        chart = null;
    });
</script>

<div class="sediment">
    <div class="controls">
        <button
            type="button"
            class="control"
            disabled={months.length < 2 || playing}
            onclick={() => {
                trackControl('spotify-discovery-sediment', 'playback', 'replay');
                play();
            }}
        >
            {playing ? 'Playing…' : '↻ Replay'}
        </button>

        <div class="modes" role="group" aria-label="Colour mode">
            {#each [{ id: 'discovery', label: 'By discovery date' }, { id: 'age', label: 'By age when played' }] as const as option (option.id)}
                <button
                    type="button"
                    class="control mode"
                    class:selected={colorMode === option.id}
                    aria-pressed={colorMode === option.id}
                    onclick={() => {
                        trackControl('spotify-discovery-sediment', 'color-mode', option.id);
                        colorMode = option.id;
                    }}
                >
                    {option.label}
                </button>
            {/each}
        </div>
    </div>

    <div class="chart-frame" bind:clientWidth={width}>
        <div bind:this={chartNode}></div>
        {#if data.length === 0}
            <p class="empty-chart">Not enough history to sediment yet.</p>
        {/if}
    </div>
</div>

<style>
    .controls {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 0.75rem;
        margin-bottom: 1rem;
    }

    .modes {
        display: inline-flex;
        gap: 0.25rem;
        padding: 0.2rem;
        border: 1px solid hsl(var(--border));
        border-radius: var(--radius-pill);
        background: hsl(var(--secondary) / 0.4);
    }

    .control {
        border: 1px solid hsl(var(--border));
        background: transparent;
        border-radius: var(--radius-pill);
        padding: 0.3rem 0.9rem;
        font-size: var(--text-small);
        color: hsl(var(--muted-foreground));
        cursor: pointer;
        transition:
            color 0.15s,
            background-color 0.15s;
    }

    .control:hover:not(:disabled) {
        color: hsl(var(--foreground));
    }

    .control:disabled {
        opacity: 0.5;
        cursor: default;
    }

    .mode {
        border: none;
    }

    .mode.selected {
        background: hsl(var(--background));
        color: hsl(var(--foreground));
        font-weight: 600;
    }

    .chart-frame {
        position: relative;
        border: 1px solid hsl(var(--border));
        border-radius: var(--radius-lg);
        background: hsl(var(--card));
        overflow-x: auto;
    }

    .empty-chart {
        padding: 4rem 1rem;
        text-align: center;
        color: hsl(var(--muted-foreground));
        font-size: var(--text-body);
    }
</style>
