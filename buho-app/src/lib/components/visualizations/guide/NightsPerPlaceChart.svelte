<script lang="ts">
    import * as d3 from "d3";
    import type { NightsPerPlace } from "$lib/data/queries/googleMapsQueries";

    let { data, width = 720 }: { data: NightsPerPlace[]; width?: number } =
        $props();

    let svgEl: SVGSVGElement;

    const ACCENT = "#EA4335";
    const rowH = 30;
    const margin = { top: 8, right: 56, bottom: 8, left: 200 };

    function label(d: NightsPerPlace): string {
        if (d.semanticType === "Home") return `Home · ${d.city}`;
        if (d.semanticType === "Work") return `Work · ${d.city}`;
        return `${d.city}${d.department !== "Unknown" ? " · " + d.department : ""}`;
    }

    $effect(() => {
        const rows = data;
        const height = margin.top + margin.bottom + rows.length * rowH;
        const innerW = width - margin.left - margin.right;

        const svg = d3
            .select(svgEl)
            .attr("viewBox", `0 0 ${width} ${height}`)
            .attr("width", "100%")
            .attr("height", height);
        svg.selectAll("*").remove();

        const g = svg
            .append("g")
            .attr("transform", `translate(${margin.left},${margin.top})`);

        const x = d3
            .scaleLinear()
            .domain([0, d3.max(rows, (d) => d.nights) ?? 1])
            .range([0, innerW]);

        const y = d3
            .scaleBand<number>()
            .domain(rows.map((_, i) => i))
            .range([0, rows.length * rowH])
            .padding(0.22);

        const row = g
            .selectAll("g.row")
            .data(rows)
            .join("g")
            .attr("class", "row")
            .attr("transform", (_, i) => `translate(0,${y(i)})`);

        row.append("rect")
            .attr("x", 0)
            .attr("height", y.bandwidth())
            .attr("rx", 3)
            .attr("fill", ACCENT)
            .attr("fill-opacity", 0.85)
            .attr("width", 0)
            .transition()
            .duration(600)
            .delay((_, i) => i * 25)
            .attr("width", (d) => Math.max(1, x(d.nights)));

        row.append("text")
            .attr("x", -10)
            .attr("y", y.bandwidth() / 2)
            .attr("dy", "0.35em")
            .attr("text-anchor", "end")
            .attr("fill", "currentColor")
            .attr("font-size", 12)
            .text((d) => label(d));

        row.append("text")
            .attr("x", (d) => x(d.nights) + 8)
            .attr("y", y.bandwidth() / 2)
            .attr("dy", "0.35em")
            .attr("fill", "currentColor")
            .attr("font-size", 12)
            .attr("font-variant-numeric", "tabular-nums")
            .attr("opacity", 0.7)
            .text((d) => d.nights);
    });
</script>

<svg bind:this={svgEl} class="nights-chart" aria-label="Nights spent per place"
></svg>

<style>
    .nights-chart {
        display: block;
        color: hsl(var(--foreground));
    }
</style>
