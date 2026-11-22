import * as d3 from 'd3';
import { CHART, MARK, bottomAxis, createChart, emptyChart, hoverNearest } from './chart';

/** One (series, month) bucket of a ridgeline. */
export type RidgeRow = {
    key: string;
    month: string; // 'YYYY-MM-DD'
    value: number;
};

export interface RidgelineOptions {
    width?: number;
    /** Ridge fill, and its outline unless `outline` is given. */
    color: string;
    /** Ridge outline. */
    outline?: string;
    emptyMessage?: string;
    /** Tooltip lines for a bucket, under the series name. */
    describe?: (row: RidgeRow) => string[];
}

/**
 * Curve shared by a ridge's fill and its outline. `basis` smooths hard enough
 * to read as a density without inventing peaks the data doesn't have.
 */
const CURVE = d3.curveBasis;

const STEP = 20; // vertical px per row
const AMPLITUDE = STEP * 2.5; // ridge height (> STEP, so a ridge overlaps the row above)
const MARGIN = { top: 56, right: 16, bottom: 40, left: 160 };

/**
 * Ridgeline: each series gets an overlapping ridge of its monthly value, ordered
 * top to bottom by the month it first appears, so the chart reads as an arrival
 * order (artists discovered, people met). Shared by the listening and messages
 * guides; only the colour and the measure differ.
 */
export function ridgelineChart(
    data: RidgeRow[],
    {
        width = 1100,
        color,
        outline = color,
        emptyMessage = 'No data in this range.',
        describe = (row) => [`${row.month} · ${row.value.toLocaleString()}`],
    }: RidgelineOptions
): HTMLElement {
    if (data.length === 0) return emptyChart(emptyMessage, 320);

    // First active month per series → arrival order (earliest at the top).
    const firstMonth = new Map<string, string>();
    for (const d of data) {
        if (d.value <= 0) continue;
        const current = firstMonth.get(d.key);
        if (current === undefined || d.month < current) firstMonth.set(d.key, d.month);
    }
    const order = [...firstMonth.keys()].sort((a, b) => {
        const fa = firstMonth.get(a) as string;
        const fb = firstMonth.get(b) as string;
        return fa < fb ? -1 : fa > fb ? 1 : a.localeCompare(b);
    });
    if (order.length === 0) return emptyChart(emptyMessage, 320);

    const indexOf = new Map(order.map((key, i) => [key, i]));
    const maxValue = d3.max(data, (d) => d.value) || 1;
    const baselineOf = (i: number) => i * STEP + STEP / 2;

    const chart = createChart({
        width,
        height: MARGIN.top + MARGIN.bottom + order.length * STEP,
        margin: MARGIN,
        label: 'Ridgeline, one row per series in order of first appearance',
    });

    const rows = data
        .filter((d) => indexOf.has(d.key))
        .map((d) => {
            const base = baselineOf(indexOf.get(d.key) as number);
            return {
                ...d,
                date: new Date(`${d.month}T00:00:00`),
                base,
                top: base - (d.value / maxValue) * AMPLITUDE,
            };
        });

    const x = d3
        .scaleTime()
        .domain(d3.extent(rows, (d) => d.date) as [Date, Date])
        .range([0, chart.innerWidth]);

    bottomAxis(chart, d3.axisBottom(x).ticks(Math.max(2, Math.floor(chart.innerWidth / 90))), {
        grid: true,
    });

    // Baselines, one hairline per row, so each ridge sits on its name.
    chart.plot
        .append('g')
        .selectAll('line')
        .data(order)
        .join('line')
        .attr('x1', 0)
        .attr('x2', chart.innerWidth)
        .attr('y1', (_, i) => baselineOf(i))
        .attr('y2', (_, i) => baselineOf(i))
        .attr('stroke', CHART.grid);

    // Fill and outline trace the same points with the same curve: the outline is
    // exactly the top edge of the fill.
    const area = d3
        .area<(typeof rows)[number]>()
        .x((d) => x(d.date))
        .y0((d) => d.base)
        .y1((d) => d.top)
        .curve(CURVE);
    const line = d3
        .line<(typeof rows)[number]>()
        .x((d) => x(d.date))
        .y((d) => d.top)
        .curve(CURVE);

    const series = d3.group(rows, (d) => d.key);
    // Drawn top row first, so each ridge overlaps the one above it.
    const ridges = chart.plot
        .append('g')
        .selectAll('g')
        .data(order.map((key) => (series.get(key) ?? []).sort((a, b) => +a.date - +b.date)))
        .join('g');
    ridges
        .append('path')
        .attr('class', 'ridge-area')
        .attr('d', area)
        .attr('fill', color)
        .attr('fill-opacity', 0.45);
    ridges
        .append('path')
        .attr('class', 'ridge-line')
        .attr('d', line)
        .attr('fill', 'none')
        .attr('stroke', outline)
        .attr('stroke-width', MARK.line - 0.5)
        .attr('stroke-linejoin', 'round');

    chart.plot
        .append('g')
        .selectAll('text')
        .data(order)
        .join('text')
        .attr('x', -10)
        .attr('y', (_, i) => baselineOf(i))
        .attr('dy', '0.32em')
        .attr('text-anchor', 'end')
        .attr('fill', CHART.ink)
        .text((d) => d);

    hoverNearest(
        chart,
        rows,
        (d) => [x(d.date), d.top],
        () => 3,
        (d) => ({ title: d.key, lines: describe(d) }),
        12
    );

    return chart.root;
}
