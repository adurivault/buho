<script lang="ts">
    import * as d3 from "d3";

    // bins[i] = count in [i, i+1) km/h; the last index (maxKmh) is the '300+'
    // overflow bin.
    let {
        bins,
        maxKmh,
        medianKmh,
        width = 720,
    }: {
        bins: number[];
        maxKmh: number;
        medianKmh: number;
        width?: number;
    } = $props();

    let svgEl: SVGSVGElement;

    const ACCENT = "#EA4335";
    const height = 320;
    const margin = { top: 16, right: 16, bottom: 44, left: 52 };

    $effect(() => {
        const data = bins;
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

        // x is continuous over km/h; the overflow bin sits in [maxKmh, maxKmh+1).
        const x = d3
            .scaleLinear()
            .domain([0, maxKmh + 1])
            .range([0, innerW]);

        const y = d3
            .scaleLinear()
            .domain([0, d3.max(data) ?? 1])
            .nice()
            .range([innerH, 0]);

        // Y grid + axis (segment counts).
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

        // 1-km/h bars.
        const bw = x(1) - x(0);
        g.selectAll("rect.bar")
            .data(data)
            .join("rect")
            .attr("class", "bar")
            .attr("x", (_, i) => x(i))
            .attr("width", Math.max(0.6, bw - 0.4))
            .attr("y", (d) => y(d))
            .attr("height", (d) => innerH - y(d))
            .attr("fill", ACCENT)
            // The overflow bin (last index) is dimmed to read as "and above".
            .attr("fill-opacity", (_, i) => (i === maxKmh ? 0.45 : 0.85));

        // X axis (km/h) with a labelled overflow tick.
        const ticks = d3.range(0, maxKmh + 1, 50);
        g.append("g")
            .attr("transform", `translate(0,${innerH})`)
            .call(
                d3
                    .axisBottom(x)
                    .tickValues([...ticks, maxKmh + 0.5])
                    .tickFormat((v) =>
                        (v as number) > maxKmh ? `${maxKmh}+` : `${v}`,
                    )
                    .tickSizeOuter(0),
            )
            .call((sel) =>
                sel
                    .selectAll("text")
                    .attr("fill", "currentColor")
                    .attr("opacity", 0.7)
                    .attr("font-size", 11),
            )
            .call((sel) =>
                sel
                    .selectAll(".tick line, .domain")
                    .attr("stroke", "currentColor")
                    .attr("stroke-opacity", 0.25),
            );

        g.append("text")
            .attr("x", innerW)
            .attr("y", innerH + 40)
            .attr("text-anchor", "end")
            .attr("fill", "currentColor")
            .attr("opacity", 0.5)
            .attr("font-size", 11)
            .text("km/h");

        // Median marker.
        if (medianKmh > 0 && medianKmh <= maxKmh) {
            const mx = x(medianKmh);
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
    aria-label="Distribution of derived travel speed, in 1 km/h bins"
></svg>

<style>
    .speed-chart {
        display: block;
        color: hsl(var(--foreground));
    }
</style>
