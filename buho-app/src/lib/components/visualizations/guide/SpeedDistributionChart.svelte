<script lang="ts">
    import * as d3 from 'd3';
    import { CHART, MARK, styleAxis, verticalBar } from '#lib/visualizations/d3/chart.ts';

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

    const FILL = 'var(--module-fill)';
    const height = 320;
    const margin = { top: 16, right: 16, bottom: 44, left: 52 };

    $effect(() => {
        const data = bins;
        const innerW = width - margin.left - margin.right;
        const innerH = height - margin.top - margin.bottom;

        const svg = d3
            .select(svgEl)
            .attr('viewBox', `0 0 ${width} ${height}`)
            .attr('width', '100%')
            .attr('height', height);
        svg.selectAll('*').remove();

        const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

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
        g.append('g')
            .call(d3.axisLeft(y).ticks(4).tickSize(-innerW).tickPadding(8))
            .call((sel) => styleAxis(sel, true));

        // 1-km/h bars, a hairline of surface between neighbours, rounded at the top.
        const bw = x(1) - x(0);
        const gap = Math.min(MARK.gap, bw * 0.3);
        g.selectAll('path.bar')
            .data(data)
            .join('path')
            .attr('class', 'bar')
            .attr('d', (d, i) => verticalBar(x(i) + gap / 2, Math.max(0.6, bw - gap), y(0), y(d)))
            .attr('fill', FILL)
            // The overflow bin (last index) is dimmed to read as "and above".
            .attr('fill-opacity', (_, i) => (i === maxKmh ? 0.45 : 1));

        // X axis (km/h) with a labelled overflow tick.
        const ticks = d3.range(0, maxKmh + 1, 50);
        g.append('g')
            .attr('transform', `translate(0,${innerH})`)
            .call(
                d3
                    .axisBottom(x)
                    .tickValues([...ticks, maxKmh + 0.5])
                    .tickFormat((v) => ((v as number) > maxKmh ? `${maxKmh}+` : `${v}`))
                    .tickSize(0)
                    .tickPadding(8)
            )
            .call((sel) => styleAxis(sel));
        g.append('line')
            .attr('x2', innerW)
            .attr('y1', innerH)
            .attr('y2', innerH)
            .attr('stroke', CHART.axis);

        g.append('text')
            .attr('x', innerW)
            .attr('y', innerH + 38)
            .attr('text-anchor', 'end')
            .attr('fill', 'currentColor')
            .text('km/h');

        // Median marker: the one dashed line on the chart.
        if (medianKmh > 0 && medianKmh <= maxKmh) {
            const mx = x(medianKmh);
            g.append('line')
                .attr('x1', mx)
                .attr('x2', mx)
                .attr('y1', 0)
                .attr('y2', innerH)
                .attr('stroke', CHART.ink)
                .attr('stroke-dasharray', MARK.referenceDash);
            g.append('text')
                .attr('x', mx + 6)
                .attr('y', 10)
                .attr('fill', CHART.ink)
                .text(`median ${medianKmh.toFixed(0)} km/h`);
        }
    });
</script>

<svg
    bind:this={svgEl}
    class="chart-svg"
    aria-label="Distribution of derived travel speed, in 1 km/h bins"
></svg>
