import * as d3 from 'd3';
import type { ArtistAnalysisData } from '#lib/data/queries/artistQueries.ts';
import type { DailyAnalysisData } from '#lib/data/queries/temporalQueries.ts';
import type { TrackAnalysisData } from '#lib/data/queries/trackQueries.ts';
import {
    CHART,
    MARK,
    bottomAxis,
    createChart,
    emptyChart,
    hoverNearest,
    leftAxis,
    peakVar,
} from './chart';

type Scale = d3.ScaleLinear<number, number> | d3.ScaleTime<number, number>;

interface MetricAxis<T> {
    value: (row: T) => number;
    label: string;
    /** Epoch milliseconds, drawn on a time axis. */
    isDate: boolean;
    format: (value: number) => string;
}

/**
 * One dot per row on two picked metrics. A numeric axis always reaches zero, so
 * the distance from the axis means what it looks like it means.
 */
function metricScatter<T>(options: {
    data: T[];
    x: MetricAxis<T>;
    y: MetricAxis<T>;
    name: (row: T) => string;
    width: number;
    height: number;
}): HTMLElement {
    const { data, x: xm, y: ym, name, width, height } = options;
    const rows = data.filter((d) => Number.isFinite(xm.value(d)) && Number.isFinite(ym.value(d)));
    if (rows.length === 0) return emptyChart('Nothing to place on these two axes.', 320);

    const chart = createChart({
        width,
        height,
        margin: { top: 28, right: 20, bottom: 48, left: 64 },
        label: `${ym.label} against ${xm.label}`,
    });

    const scaleFor = (axis: MetricAxis<T>, range: [number, number]): Scale => {
        const [lo, hi] = d3.extent(rows, axis.value) as [number, number];
        if (axis.isDate) return d3.scaleTime().domain([lo, hi]).nice().range(range);
        return d3
            .scaleLinear()
            .domain([Math.min(0, lo), Math.max(0, hi)])
            .nice()
            .range(range);
    };
    const x = scaleFor(xm, [0, chart.innerWidth]);
    const y = scaleFor(ym, [chart.innerHeight, 0]);

    const xAxis = d3.axisBottom(x as d3.AxisScale<d3.AxisDomain>);
    if (!xm.isDate) xAxis.tickFormat((v) => xm.format(Number(v)));
    const yAxis = d3.axisLeft(y as d3.AxisScale<d3.AxisDomain>);
    if (!ym.isDate) yAxis.tickFormat((v) => ym.format(Number(v)));
    bottomAxis(chart, xAxis, { grid: true, label: xm.label });
    leftAxis(chart, yAxis, { grid: true, label: ym.label });

    // Zero lines on the numeric axes, a step stronger than the grid.
    if (!xm.isDate) {
        chart.plot
            .append('line')
            .attr('x1', x(0))
            .attr('x2', x(0))
            .attr('y2', chart.innerHeight)
            .attr('stroke', CHART.axis);
    }
    if (!ym.isDate) {
        chart.plot
            .append('line')
            .attr('y1', y(0))
            .attr('y2', y(0))
            .attr('x2', chart.innerWidth)
            .attr('stroke', CHART.axis);
    }

    const position = (d: T): [number, number] => [x(xm.value(d)), y(ym.value(d))];
    chart.plot
        .append('g')
        .selectAll('circle')
        .data(rows)
        .join('circle')
        .attr('cx', (d) => position(d)[0])
        .attr('cy', (d) => position(d)[1])
        .attr('r', MARK.dotRadius)
        .attr('fill', peakVar('listening'))
        .attr('fill-opacity', 0.75)
        .attr('stroke', CHART.surface)
        .attr('stroke-width', 1);

    hoverNearest(
        chart,
        rows,
        position,
        () => MARK.dotRadius,
        (d) => ({
            title: name(d),
            lines: [
                `${xm.label}: ${xm.format(xm.value(d))}`,
                `${ym.label}: ${ym.format(ym.value(d))}`,
            ],
        })
    );

    return chart.root;
}

interface ScatterOptions<T> {
    data: T[];
    xMetric: keyof T;
    yMetric: keyof T;
    xLabel?: string;
    yLabel?: string;
    width?: number;
    height?: number;
}

const formatDate = (value: number) => new Date(value).toLocaleDateString();

function axisOf<T>(
    metric: keyof T,
    label: string | undefined,
    dateKey: keyof T,
    format: (value: number) => string
): MetricAxis<T> {
    const isDate = metric === dateKey;
    return {
        value: (row) => Number(row[metric]),
        label: label ?? String(metric),
        isDate,
        format: isDate ? formatDate : format,
    };
}

export function artistAnalysisScatterChart(options: ScatterOptions<ArtistAnalysisData>) {
    const { data, xMetric, yMetric, xLabel, yLabel, width = 1400, height = 760 } = options;
    const formatFor = (metric: keyof ArtistAnalysisData) => (value: number) =>
        metric === 'listenDateVarianceDays2' ? value.toFixed(3) : value.toLocaleString();
    return metricScatter({
        data,
        x: axisOf(xMetric, xLabel, 'meanListenDateEpochMs', formatFor(xMetric)),
        y: axisOf(yMetric, yLabel, 'meanListenDateEpochMs', formatFor(yMetric)),
        name: (d) => d.artist,
        width,
        height,
    });
}

export function trackAnalysisScatterChart(options: ScatterOptions<TrackAnalysisData>) {
    const { data, xMetric, yMetric, xLabel, yLabel, width = 1400, height = 760 } = options;
    const formatFor = (metric: keyof TrackAnalysisData) => (value: number) => {
        if (
            metric === 'artistPrevalenceRate' ||
            metric === 'intentionalityRate' ||
            metric === 'skipRate'
        ) {
            return `${value.toFixed(1)}%`;
        }
        if (metric === 'recencyDays') return `${value.toFixed(1)} d`;
        return value.toLocaleString();
    };
    // No track metric is a date; the key below never matches.
    const noDate = '' as keyof TrackAnalysisData;
    return metricScatter({
        data,
        x: axisOf(xMetric, xLabel, noDate, formatFor(xMetric)),
        y: axisOf(yMetric, yLabel, noDate, formatFor(yMetric)),
        name: (d) => `${d.track} — ${d.artist}`,
        width,
        height,
    });
}

export function dailyAnalysisScatterChart(options: ScatterOptions<DailyAnalysisData>) {
    const { data, xMetric, yMetric, xLabel, yLabel, width = 1400, height = 760 } = options;
    const formatFor = (metric: keyof DailyAnalysisData) => (value: number) => {
        if (metric === 'meanListenHour') return `${value.toFixed(2)}h`;
        if (metric === 'repeatIntensity') return value.toFixed(3);
        return value.toLocaleString();
    };
    return metricScatter({
        data,
        x: axisOf(xMetric, xLabel, 'dateEpochMs', formatFor(xMetric)),
        y: axisOf(yMetric, yLabel, 'dateEpochMs', formatFor(yMetric)),
        name: (d) => d.date,
        width,
        height,
    });
}
