<script lang="ts">
    import type { Action } from "svelte/action";

    type Props = {
        plotFn: (data?: any) => HTMLElement | SVGElement;
        data?: any;
    };

    let { plotFn, data }: Props = $props();

    const renderPlot: Action<
        HTMLElement,
        { fn: typeof plotFn; plotData: typeof data }
    > = (node, { fn, plotData }) => {
        const plot = fn(plotData);
        node.appendChild(plot);

        return {
            update({ fn, plotData }) {
                node.innerHTML = ""; // Clear previous
                const plot = fn(plotData);
                node.appendChild(plot);
            },
            destroy() {
                node.innerHTML = "";
            },
        };
    };
</script>

<div
    class="plot-container"
    use:renderPlot={{ fn: plotFn, plotData: data }}
></div>

<style>
    .plot-container {
        /* No width: 100% — let the SVG render at its intrinsic (Plot-calculated) width.
           This allows the parent scroll container to detect overflow and show a scrollbar. */
        display: block;
    }
</style>
