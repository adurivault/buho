<script lang="ts">
    import * as d3 from "d3";
    import type { DimensionSlice } from "$lib/data/queries/dimensionQueries";
    import { spotifyExplorerFilters } from "$lib/stores/spotifyExplorerFilters.svelte";
    import type { FilterScalar } from "$lib/types/filters";
    import { stickyColor } from "$lib/utils/dimensionColors";

    interface Props {
        title: string;
        /** Clé du store cross-filtering, ex. "ip_addr". */
        filterKey: string;
        slices: DimensionSlice[];
        size?: number;
        /** Formatage de la valeur pour l'affichage (tooltip), ex. jour de semaine. */
        format?: (value: string) => string;
        /** Affiche le toggle « color by » (colore la constellation par cette dimension). */
        colorByEnabled?: boolean;
        /** Cette dimension est-elle la source de couleur active ? */
        colorByActive?: boolean;
        /** Bascule la source de couleur. */
        onToggleColorBy?: () => void;
    }

    let {
        title,
        filterKey,
        slices,
        size = 132,
        format = (v: string) => v,
        colorByEnabled = false,
        colorByActive = false,
        onToggleColorBy,
    }: Props = $props();

    let svgEl = $state<SVGSVGElement>();
    let hostEl = $state<HTMLDivElement>();
    let tooltip = $state({ visible: false, x: 0, y: 0, label: "", value: "" });

    function selectedValue(): string | null {
        const v = spotifyExplorerFilters.activeFilters[filterKey];
        if (v === undefined || v === null) return null;
        if (v instanceof Set) {
            const a = [...v];
            return a.length ? String(a[0]) : null;
        }
        if (Array.isArray(v)) return v.length ? String(v[0]) : null;
        if (typeof v === "object") return null;
        return String(v as FilterScalar);
    }

    function toggle(value: string) {
        if (value === "Other") return; // pas filtrable
        if (selectedValue() === value) {
            spotifyExplorerFilters.removeFilter(filterKey);
        } else {
            spotifyExplorerFilters.setFilter(filterKey, value);
        }
    }

    function formatMinutes(m: number): string {
        return `${Math.round(m).toLocaleString()} min`;
    }

    function positionTooltip(event: PointerEvent) {
        if (!hostEl) return;
        const rect = hostEl.getBoundingClientRect();
        let x = event.clientX - rect.left + 12;
        let y = event.clientY - rect.top + 12;
        if (x + 200 > rect.width) x = event.clientX - rect.left - 200 - 12;
        tooltip.x = Math.max(0, x);
        tooltip.y = Math.max(0, y);
    }

    function render() {
        if (!svgEl) return;
        const svg = d3.select(svgEl);
        svg.selectAll("*").remove();
        if (slices.length === 0) return;

        const radius = size / 2;
        const selected = selectedValue();

        const fill = (s: DimensionSlice) => stickyColor(filterKey, s.value);

        const pie = d3
            .pie<DimensionSlice>()
            .sort(null)
            .value((d) => d.minutes);
        const arc = d3
            .arc<d3.PieArcDatum<DimensionSlice>>()
            .innerRadius(radius * 0.55)
            .outerRadius(radius - 1)
            .padAngle(0.012);

        svg.attr("viewBox", [-radius, -radius, size, size])
            .attr("width", size)
            .attr("height", size);

        svg.append("g")
            .selectAll("path")
            .data(pie(slices))
            .join("path")
            .attr("d", arc)
            .attr("fill", (d) => fill(d.data))
            .attr("fill-opacity", (d) =>
                selected && d.data.value !== selected ? 0.18 : 0.9,
            )
            .style("cursor", (d) =>
                d.data.value === "Other" ? "default" : "pointer",
            )
            .on("click", (_event, d) => toggle(d.data.value))
            .on("pointerenter", (event, d) => {
                tooltip.label = format(d.data.value);
                tooltip.value = formatMinutes(d.data.minutes);
                tooltip.visible = true;
                positionTooltip(event as PointerEvent);
            })
            .on("pointermove", (event) =>
                positionTooltip(event as PointerEvent),
            )
            .on("pointerleave", () => (tooltip.visible = false));
    }

    $effect(() => {
        const _slices = slices;
        const _filters = spotifyExplorerFilters.activeFilters;
        const _size = size;
        render();
    });
</script>

<div class="pie" bind:this={hostEl}>
    <svg bind:this={svgEl}></svg>
    {#if colorByEnabled}
        <button
            class="pie-label pie-label-btn"
            class:active={colorByActive}
            type="button"
            role="radio"
            aria-checked={colorByActive}
            aria-label="Color the constellation by {title}"
            title="Color the constellation by this dimension"
            onclick={() => onToggleColorBy?.()}
        >
            <span class="color-by-btn"></span>
            <span class="pie-title">{title}</span>
        </button>
    {:else}
        <div class="pie-label">
            <span class="pie-title">{title}</span>
        </div>
    {/if}
    {#if tooltip.visible}
        <div class="tooltip" style={`left:${tooltip.x}px; top:${tooltip.y}px;`}>
            <strong>{tooltip.label}</strong>
            <span>{tooltip.value}</span>
        </div>
    {/if}
</div>

<style>
    .pie {
        position: relative;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.35rem;
    }

    .pie-title {
        font-size: 0.72rem;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: hsl(var(--muted-foreground));
        white-space: nowrap;
    }

    .pie-label {
        display: flex;
        align-items: center;
        gap: 0.4rem;
    }

    .pie-label-btn {
        border: none;
        background: transparent;
        padding: 0;
        margin: 0;
        font: inherit;
        cursor: pointer;
    }

    .pie-label-btn .pie-title {
        transition: color 0.16s ease;
    }

    .pie-label-btn:hover .pie-title,
    .pie-label-btn.active .pie-title {
        color: var(--accent-spotify, #1db954);
    }

    .color-by-btn {
        flex: none;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 16px;
        height: 16px;
        padding: 0;
        border: 1.5px solid hsl(var(--muted-foreground));
        border-radius: 50%;
        background: color-mix(in srgb, hsl(var(--card)) 86%, black 14%);
        cursor: pointer;
        transition:
            border-color 0.16s ease,
            background-color 0.16s ease;
    }

    .color-by-btn::after {
        content: "";
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: color-mix(
            in srgb,
            hsl(var(--muted-foreground)) 55%,
            transparent
        );
        transition:
            background-color 0.16s ease,
            transform 0.16s ease;
    }

    .pie-label-btn:hover .color-by-btn {
        border-color: var(--accent-spotify, #1db954);
    }

    .pie-label-btn:hover .color-by-btn::after {
        background: color-mix(
            in srgb,
            var(--accent-spotify, #1db954) 70%,
            transparent
        );
    }

    .pie-label-btn.active .color-by-btn {
        border-color: var(--accent-spotify, #1db954);
    }

    .pie-label-btn.active .color-by-btn::after {
        background: var(--accent-spotify, #1db954);
        transform: scale(1.05);
    }

    .tooltip {
        position: absolute;
        pointer-events: none;
        z-index: 3;
        display: flex;
        flex-direction: column;
        gap: 2px;
        max-width: 13rem;
        border-radius: 7px;
        border: 1px solid hsl(var(--border));
        padding: 0.38rem 0.5rem;
        font-size: 0.72rem;
        line-height: 1.25;
        color: hsl(var(--foreground));
        background: color-mix(in srgb, hsl(var(--card)) 92%, black 8%);
    }

    .tooltip strong {
        font-weight: 600;
        word-break: break-word;
    }

    .tooltip span {
        opacity: 0.7;
    }
</style>
