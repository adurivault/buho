<script lang="ts" generics="T">
    import type { Action } from 'svelte/action';
    import ShareMenu from '#lib/components/ShareMenu.svelte';
    import type { ShareSource } from '#lib/export/index.ts';

    type Props = {
        /** Builds the chart from the data: one of the D3 factories. */
        chartFn: (data: T) => HTMLElement | SVGElement;
        data: T;
        /**
         * Turns on the share control. The name is the file-name stem and the
         * analytics id, so it must be a literal — never a value out of the data.
         */
        share?: { name: string; title?: string; caption?: string };
    };

    let { chartFn, data, share }: Props = $props();

    let container = $state<HTMLElement | undefined>(undefined);

    const shareSource = $derived<ShareSource | null>(
        share ? { ...share, element: () => container } : null
    );

    const renderChart: Action<HTMLElement, { fn: typeof chartFn; chartData: typeof data }> = (
        node,
        { fn, chartData }
    ) => {
        node.appendChild(fn(chartData));

        return {
            update({ fn, chartData }) {
                node.innerHTML = '';
                node.appendChild(fn(chartData));
            },
            destroy() {
                node.innerHTML = '';
            },
        };
    };
</script>

<div class="chart-frame">
    <div
        bind:this={container}
        class="chart-scroll"
        use:renderChart={{ fn: chartFn, chartData: data }}
    ></div>

    {#if shareSource}
        <!-- No control row to join: the chart is the picture and nothing
             else, so here the corner really is free. -->
        <ShareMenu source={shareSource} vizId={share!.name} floating />
    {/if}
</div>

<style>
    /*
       A positioning context for the share control, and nothing else: the
       scrolling below has to stay on the element that holds the SVG, or a
       chart wider than the phone would scroll its own share button off screen.
    */
    .chart-frame {
        position: relative;
    }

    .chart-scroll {
        /* No width: 100% — let the chart render at the width its factory
           asked for, and scroll it here when it doesn't fit. Several charts have a
           floor well past a phone's width (the calendar asks for 700px), and
           without a scroller of their own that overflow pushed the whole page
           sideways instead. */
        display: block;
        overflow-x: auto;
        /* A swipe that runs off the end of the chart must not hand the gesture
           to the browser's back-navigation. */
        overscroll-behavior-x: contain;
    }
</style>
