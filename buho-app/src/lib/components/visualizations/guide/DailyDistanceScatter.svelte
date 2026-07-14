<script lang="ts">
    import * as d3 from "d3";
    import type { DayRecord } from "$lib/data/queries/googleMapsQueries";
    import { RACE_PALETTE } from "$lib/visualizations/racePalette";

    let { data, width = 720 }: { data: DayRecord[]; width?: number } = $props();

    let svgEl: SVGSVGElement;
    let tooltipEl: HTMLDivElement;

    const OTHER = "#9ca3af"; // gray-400 — the folded "Other" bucket
    const TOP_N = 8;
    const height = 460;
    const margin = { top: 16, right: 16, bottom: 46, left: 52 };

    // Top starting cities by day count; everything else folds into "Other".
    const cityColor = $derived.by(() => {
        const counts = d3.rollup(
            data.filter((d) => d.startCity && d.startCity !== "Unknown"),
            (v) => v.length,
            (d) => d.startCity,
        );
        const top = [...counts.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, TOP_N)
            .map(([c]) => c);
        const scale = d3
            .scaleOrdinal<string, string>()
            .domain(top)
            .range(RACE_PALETTE)
            .unknown(OTHER);
        return { top, scale };
    });

    const legend = $derived([
        ...cityColor.top.map((c) => ({ label: c, color: cityColor.scale(c) })),
        { label: "Other", color: OTHER },
    ]);

    const colorOf = (d: DayRecord) =>
        cityColor.top.includes(d.startCity) ? cityColor.scale(d.startCity) : OTHER;

    $effect(() => {
        const rows = data;
        const innerW = width - margin.left - margin.right;
        const innerH = height - margin.top - margin.bottom;

        const svg = d3
            .select(svgEl)
            .attr("viewBox", `0 0 ${width} ${height}`)
            .attr("width", "100%")
            .attr("height", height);
        svg.selectAll("*").remove();
        if (!rows.length) return;

        const g = svg
            .append("g")
            .attr("transform", `translate(${margin.left},${margin.top})`);

        // Both measures are heavily right-skewed → sqrt keeps the cloud legible.
        const x = d3
            .scaleSqrt()
            .domain([0, d3.max(rows, (d) => d.kmTraveled) ?? 1])
            .nice()
            .range([0, innerW]);
        const y = d3
            .scaleSqrt()
            .domain([0, d3.max(rows, (d) => d.maxDistFromStartKm) ?? 1])
            .nice()
            .range([innerH, 0]);

        // Y grid + axis.
        g.append("g")
            .call(d3.axisLeft(y).ticks(5).tickSize(-innerW))
            .call((s) => s.select(".domain").remove())
            .call((s) =>
                s
                    .selectAll(".tick line")
                    .attr("stroke", "currentColor")
                    .attr("stroke-opacity", 0.12),
            )
            .call((s) =>
                s
                    .selectAll("text")
                    .attr("fill", "currentColor")
                    .attr("opacity", 0.6)
                    .attr("font-size", 11),
            );

        // X axis.
        g.append("g")
            .attr("transform", `translate(0,${innerH})`)
            .call(d3.axisBottom(x).ticks(6).tickSize(0))
            .call((s) => s.select(".domain").remove())
            .call((s) =>
                s
                    .selectAll("text")
                    .attr("fill", "currentColor")
                    .attr("opacity", 0.7)
                    .attr("font-size", 11),
            );

        // Axis titles.
        g.append("text")
            .attr("x", innerW)
            .attr("y", innerH + 38)
            .attr("text-anchor", "end")
            .attr("fill", "currentColor")
            .attr("opacity", 0.5)
            .attr("font-size", 11)
            .text("km travelled →");
        g.append("text")
            .attr("transform", "rotate(-90)")
            .attr("x", 0)
            .attr("y", -40)
            .attr("text-anchor", "end")
            .attr("fill", "currentColor")
            .attr("opacity", 0.5)
            .attr("font-size", 11)
            .text("max km from start →");

        const tip = d3.select(tooltipEl);
        const fmt = (n: number) => Math.round(n).toLocaleString();

        g.selectAll("circle")
            .data(rows)
            .join("circle")
            .attr("cx", (d) => x(d.kmTraveled))
            .attr("cy", (d) => y(d.maxDistFromStartKm))
            .attr("r", 4)
            .attr("fill", (d) => colorOf(d))
            .attr("fill-opacity", 0.78)
            .attr("stroke", "hsl(var(--background))")
            .attr("stroke-width", 0.75)
            .on("mouseenter", (_, d) => {
                tip.style("opacity", "1").html(
                    `<b>${d.day}</b><br>${
                        d.startCity !== "Unknown" ? d.startCity : "unknown start"
                    }<br>${fmt(d.kmTraveled)} km travelled<br>${fmt(
                        d.maxDistFromStartKm,
                    )} km from start`,
                );
            })
            .on("mousemove", (event) => {
                tip.style("left", `${event.offsetX + 12}px`).style(
                    "top",
                    `${event.offsetY + 12}px`,
                );
            })
            .on("mouseleave", () => tip.style("opacity", "0"));
    });
</script>

<div class="scatter-wrap">
    <svg
        bind:this={svgEl}
        class="scatter"
        aria-label="Daily kilometres travelled versus maximum distance from the start point"
    ></svg>
    <div bind:this={tooltipEl} class="tip"></div>
    <div class="legend">
        {#each legend as item (item.label)}
            <span class="item">
                <span class="dot" style:background={item.color}></span>
                {item.label}
            </span>
        {/each}
    </div>
</div>

<style>
    .scatter-wrap {
        position: relative;
        color: hsl(var(--foreground));
    }
    .scatter {
        display: block;
    }
    .tip {
        position: absolute;
        pointer-events: none;
        opacity: 0;
        background: hsl(var(--popover, var(--background)));
        color: hsl(var(--foreground));
        border: 1px solid hsl(var(--border));
        border-radius: 0.35rem;
        padding: 0.35rem 0.5rem;
        font-size: 0.75rem;
        line-height: 1.35;
        white-space: nowrap;
        box-shadow: 0 2px 8px rgb(0 0 0 / 0.25);
        z-index: 10;
    }
    .legend {
        display: flex;
        flex-wrap: wrap;
        gap: 0.35rem 0.9rem;
        margin-top: 0.75rem;
        font-size: 0.75rem;
        color: hsl(var(--muted-foreground));
    }
    .legend .item {
        display: inline-flex;
        align-items: center;
        gap: 0.35rem;
    }
    .legend .dot {
        width: 10px;
        height: 10px;
        border-radius: 50%;
        display: inline-block;
    }
</style>
