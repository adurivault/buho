<script lang="ts">
    import * as d3 from "d3";
    import type { SpeedBucket } from "$lib/data/queries/googleMapsQueries";

    let {
        data,
        medianKmh,
        width = 720,
    }: { data: SpeedBucket[]; medianKmh: number; width?: number } = $props();

    let svgEl: SVGSVGElement;

    const ACCENT = "#EA4335";
    const height = 300;
    const margin = { top: 16, right: 16, bottom: 44, left: 48 };

    // Where the median line sits: bucket index + fraction across that bucket.
    function medianX(x: d3.ScaleBand<string>): number | null {
        const i = data.findIndex(
            (b) => medianKmh >= b.lo && (b.hi === null || medianKmh < b.hi),
        );
        if (i < 0) return null;
        const b = data[i];
        const band = x(b.label);
        if (band === undefined) return null;
        const span = b.hi === null ? 1 : (medianKmh - b.lo) / (b.hi - b.lo);
        return band + x.bandwidth() * Math.min(1, Math.max(0, span));
    }

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

        const g = svg
            .append("g")
            .attr("transform", `translate(${margin.left},${margin.top})`);

        const x = d3
            .scaleBand<string>()
            .domain(rows.map((d) => d.label))
            .range([0, innerW])
            .padding(0.2);

        const y = d3
            .scaleLinear()
            .domain([0, d3.max(rows, (d) => d.count) ?? 1])
            .nice()
            .range([innerH, 0]);

        // Y grid + axis (leg counts).
        g.append("g")
            .call(d3.axisLeft(y).ticks(4).tickSize(-innerW))
            .call((sel) => sel.select(".domain").remove())
            .call((sel) =>
                sel
                    .selectAll(".tick line")
                    .attr("stroke", "currentColor")
                    .attr("stroke-opacity", 0.12),
            )
            .call((sel) =>
                sel
                    .selectAll("text")
                    .attr("fill", "currentColor")
                    .attr("opacity", 0.6)
                    .attr("font-size", 11),
            );

        // Bars.
        g.selectAll("rect.bar")
            .data(rows)
            .join("rect")
            .attr("class", "bar")
            .attr("x", (d) => x(d.label) ?? 0)
            .attr("width", x.bandwidth())
            .attr("rx", 3)
            .attr("fill", ACCENT)
            .attr("fill-opacity", 0.85)
            .attr("y", innerH)
            .attr("height", 0)
            .transition()
            .duration(600)
            .delay((_, i) => i * 30)
            .attr("y", (d) => y(d.count))
            .attr("height", (d) => innerH - y(d.count));

        // X axis: speed buckets (km/h).
        g.append("g")
            .attr("transform", `translate(0,${innerH})`)
            .call(d3.axisBottom(x).tickSize(0))
            .call((sel) => sel.select(".domain").remove())
            .call((sel) =>
                sel
                    .selectAll("text")
                    .attr("fill", "currentColor")
                    .attr("opacity", 0.7)
                    .attr("font-size", 11),
            );

        g.append("text")
            .attr("x", innerW)
            .attr("y", innerH + 38)
            .attr("text-anchor", "end")
            .attr("fill", "currentColor")
            .attr("opacity", 0.5)
            .attr("font-size", 11)
            .text("km/h");

        // Median marker.
        const mx = medianX(x);
        if (mx !== null) {
            g.append("line")
                .attr("x1", mx)
                .attr("x2", mx)
                .attr("y1", 0)
                .attr("y2", innerH)
                .attr("stroke", "currentColor")
                .attr("stroke-width", 1.5)
                .attr("stroke-dasharray", "4 3")
                .attr("opacity", 0.55);
            g.append("text")
                .attr("x", mx + 5)
                .attr("y", 12)
                .attr("fill", "currentColor")
                .attr("opacity", 0.7)
                .attr("font-size", 11)
                .text(`median ${medianKmh.toFixed(0)} km/h`);
        }
    });
</script>

<svg
    bind:this={svgEl}
    class="speed-chart"
    aria-label="Distribution of derived travel speed"
></svg>

<style>
    .speed-chart {
        display: block;
        color: hsl(var(--foreground));
    }
</style>
