import * as d3 from 'd3';
import type { ArtistMonthlyPoint } from '#lib/data/queries/artistQueries.ts';
import type { ArtistDiscoveryRecencyData } from '#lib/data/queries/discoveryQueries.ts';
import type { DailyCalendarPoint, HourWeekdayCell } from '#lib/data/queries/temporalQueries.ts';
import type { Measure } from '#lib/data/sql/measure.ts';
import { formatMeasure, measureAxisLabel } from '#lib/utils/measure.ts';
import {
    CHART,
    MARK,
    bottomAxis,
    createChart,
    emptyChart,
    fillVar,
    hoverNearest,
    leftAxis,
    peakVar,
    rampLegend,
    sequentialRamp,
} from './chart';
import { ridgelineChart } from './ridgeline';

/** Indexed by DuckDB's DAYOFWEEK, where 0 is Sunday. */
const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
/** Monday-first, the way a week reads. */
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
const HOURS = d3.range(24);

/**
 * A stepped colour scale over the values actually drawn: quantiles, so each
 * step holds as many cells as the next and a single huge day doesn't wash the
 * rest of the chart into the first step.
 */
function quantileFill(values: number[], ramp: string[]) {
    return d3.scaleQuantile<string>().domain(values).range(ramp);
}

/**
 * Weekday × hour heatmap: the constellation with its calendar axis folded away,
 * so a habit that repeats every week piles into one cell instead of spreading
 * across years.
 */
export function listeningClockChart(
    data: HourWeekdayCell[],
    options: { width?: number; measure?: Measure } = {}
): HTMLElement {
    if (data.length === 0) return emptyChart('No listening in this range.', 260);

    const { width = 900, measure = 'minutes' } = options;
    // Both numbers are on every cell — the query counts them in one pass — so
    // the measure only picks which one the colour is scaled by.
    const valueOf = (d: HourWeekdayCell) => (measure === 'plays' ? d.plays : d.minutes);
    const ramp = sequentialRamp('listening');
    const positive = data.map(valueOf).filter((v) => v > 0);
    const fill = quantileFill(positive, ramp);

    const chart = createChart({
        width,
        height: 280,
        margin: { top: 4, right: 8, bottom: 40, left: 40 },
        label: 'Listening by weekday and hour',
        legend: rampLegend({
            title: measureAxisLabel(measure),
            colors: ramp,
            thresholds: fill.quantiles(),
        }),
    });

    const x = d3.scaleBand<number>().domain(HOURS).range([0, chart.innerWidth]);
    const y = d3.scaleBand<number>().domain(WEEK_ORDER).range([0, chart.innerHeight]);

    bottomAxis(
        chart,
        d3
            .axisBottom(x)
            .tickValues(HOURS.filter((h) => h % 3 === 0))
            .tickFormat((h) => String(h)),
        { label: 'Hour of day' }
    );
    leftAxis(
        chart,
        d3.axisLeft(y).tickFormat((d) => DAY_LABELS[d] ?? '')
    );

    const byCell = new Map(data.map((d) => [`${d.dow}:${d.hour}`, d]));
    const slots = WEEK_ORDER.flatMap((dow) => HOURS.map((hour) => ({ dow, hour })));

    chart.plot
        .append('g')
        .selectAll('rect')
        .data(slots)
        .join('rect')
        .attr('x', (d) => (x(d.hour) ?? 0) + 1)
        .attr('y', (d) => (y(d.dow) ?? 0) + 1)
        .attr('width', Math.max(0, x.bandwidth() - MARK.gap))
        .attr('height', Math.max(0, y.bandwidth() - MARK.gap))
        .attr('rx', 3)
        .attr('fill', (d) => {
            const cell = byCell.get(`${d.dow}:${d.hour}`);
            const value = cell ? valueOf(cell) : 0;
            return value > 0 ? fill(value) : CHART.grid;
        })
        .on('pointermove', (event: PointerEvent, d) => {
            const cell = byCell.get(`${d.dow}:${d.hour}`);
            chart.tooltip.show(
                event,
                `${DAY_LABELS[d.dow] ?? ''} ${String(d.hour).padStart(2, '0')}:00`,
                [formatMeasure(measure, cell ? valueOf(cell) : 0)]
            );
        })
        .on('pointerleave', () => chart.tooltip.hide());

    return chart.root;
}

/**
 * Calendar heatmap: one square per day, a row of weeks per year, coloured by
 * whatever the active measure counts.
 */
export function calendarHeatmapChart(
    data: DailyCalendarPoint[],
    options: { width?: number; measure?: Measure } = {}
): HTMLElement {
    const { width = 1100, measure = 'minutes' } = options;
    const days = data
        .filter((d) => d.value > 0)
        .map((d) => ({ date: new Date(`${d.date}T00:00:00Z`), value: d.value }));
    if (days.length === 0) return emptyChart('No data in this date range.', 240);

    const years = [...new Set(days.map((d) => d.date.getUTCFullYear()))].sort((a, b) => a - b);
    const ramp = sequentialRamp('listening');
    const fill = quantileFill(
        days.map((d) => d.value),
        ramp
    );

    const margin = { top: 8, right: 8, bottom: 4, left: 32 };
    const cell = Math.max(8, Math.min(18, Math.floor((width - margin.left - margin.right) / 54)));
    const yearHeader = 36;
    const yearGap = 18;
    const yearHeight = yearHeader + 7 * cell;

    const chart = createChart({
        width,
        height: margin.top + margin.bottom + years.length * (yearHeight + yearGap) - yearGap,
        margin,
        label: 'Listening by day, one row of weeks per year',
        legend: rampLegend({
            title: `${measureAxisLabel(measure)} / day`,
            colors: ramp,
            thresholds: fill.quantiles(),
        }),
    });

    const byYear = d3.group(days, (d) => d.date.getUTCFullYear());
    const monthFormat = d3.utcFormat('%b');
    const dayFormat = (date: Date) =>
        date.toLocaleDateString(undefined, {
            weekday: 'short',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            timeZone: 'UTC',
        });

    years.forEach((year, yi) => {
        const yearStart = new Date(Date.UTC(year, 0, 1));
        const weekOf = (date: Date) => d3.utcMonday.count(d3.utcYear(date), date);
        const rowOf = (date: Date) => (date.getUTCDay() + 6) % 7; // Monday first
        const g = chart.plot
            .append('g')
            .attr('transform', `translate(0,${yi * (yearHeight + yearGap)})`);

        g.append('text')
            .attr('x', 0)
            .attr('y', 10)
            .attr('fill', CHART.ink)
            .attr('font-weight', 600)
            .text(year);

        // Month initials over the week each month starts in.
        g.append('g')
            .selectAll('text')
            .data(d3.utcMonths(yearStart, new Date(Date.UTC(year + 1, 0, 1))))
            .join('text')
            .attr('x', (d) => weekOf(d) * cell)
            .attr('y', yearHeader - 6)
            .attr('fill', 'currentColor')
            .text((d) => monthFormat(d));

        // Every other weekday down the side, enough to find a Monday.
        g.append('g')
            .selectAll('text')
            .data([0, 2, 4])
            .join('text')
            .attr('x', -6)
            .attr('y', (row) => yearHeader + row * cell + cell / 2)
            .attr('dy', '0.32em')
            .attr('text-anchor', 'end')
            .attr('fill', 'currentColor')
            .text((row) => DAY_LABELS[(row + 1) % 7]);

        g.append('g')
            .attr('transform', `translate(0,${yearHeader})`)
            .selectAll('rect')
            .data(byYear.get(year) ?? [])
            .join('rect')
            .attr('x', (d) => weekOf(d.date) * cell + 1)
            .attr('y', (d) => rowOf(d.date) * cell + 1)
            .attr('width', cell - MARK.gap)
            .attr('height', cell - MARK.gap)
            .attr('rx', 2)
            .attr('fill', (d) => fill(d.value))
            .on('pointermove', (event: PointerEvent, d) =>
                chart.tooltip.show(event, dayFormat(d.date), [formatMeasure(measure, d.value)])
            )
            .on('pointerleave', () => chart.tooltip.hide());
    });

    return chart.root;
}

/**
 * Ridgeline: each top artist gets an overlapping ridge of their months, ordered
 * top to bottom by when you first played them.
 */
export function artistRidgelineChart(
    data: ArtistMonthlyPoint[],
    options: { width?: number; measure?: Measure } = {}
): HTMLElement {
    const { measure = 'minutes', width } = options;
    return ridgelineChart(
        data.map((d) => ({ key: d.artist, month: d.month, value: d.value })),
        {
            width,
            color: fillVar('listening'),
            outline: peakVar('listening'),
            emptyMessage: 'No artist data in this range.',
            describe: (row) => [`${row.month.slice(0, 7)} · ${formatMeasure(measure, row.value)}`],
        }
    );
}

/**
 * Per-artist first play (x) against last play (y), bubble size = total plays.
 * Both axes share one time scale, so the dashed diagonal is "first and last
 * play on the same day" and the height above it is how long the artist lasted.
 */
export function discoveryRecencyChart(options: {
    data: ArtistDiscoveryRecencyData[];
    width?: number;
    height?: number;
}): HTMLElement {
    const { data, width = 1200, height = 720 } = options;
    if (data.length === 0) return emptyChart('Not enough artists in this range.', 320);

    const points = data
        .map((d) => ({
            ...d,
            first: new Date(`${d.firstDate}T00:00:00`),
            last: new Date(`${d.lastDate}T00:00:00`),
        }))
        // Big bubbles first, so the small ones stay on top and reachable.
        .sort((a, b) => b.plays - a.plays);

    const chart = createChart({
        width,
        height,
        margin: { top: 28, right: 20, bottom: 44, left: 56 },
        label: 'Each artist by first play and last play, sized by plays',
    });

    const [min, max] = d3.extent(points.flatMap((d) => [d.first, d.last])) as [Date, Date];
    const x = d3.scaleTime().domain([min, max]).nice().range([0, chart.innerWidth]);
    const y = d3.scaleTime().domain(x.domain()).range([chart.innerHeight, 0]);
    const r = d3
        .scaleSqrt()
        .domain([0, d3.max(points, (d) => d.plays) ?? 1])
        .range([0, 22]);
    const radius = (d: (typeof points)[number]) => Math.max(2.5, r(d.plays));

    bottomAxis(chart, d3.axisBottom(x), {
        grid: true,
        label: 'First play',
    });
    leftAxis(chart, d3.axisLeft(y), {
        grid: true,
        label: 'Last play',
    });

    const [d0, d1] = x.domain();
    chart.plot
        .append('line')
        .attr('x1', x(d0))
        .attr('y1', y(d0))
        .attr('x2', x(d1))
        .attr('y2', y(d1))
        .attr('stroke', CHART.axis)
        .attr('stroke-dasharray', MARK.referenceDash);

    chart.plot
        .append('g')
        .selectAll('circle')
        .data(points)
        .join('circle')
        .attr('cx', (d) => x(d.first))
        .attr('cy', (d) => y(d.last))
        .attr('r', radius)
        .attr('fill', peakVar('listening'))
        .attr('fill-opacity', 0.6)
        .attr('stroke', CHART.surface)
        .attr('stroke-width', 1);

    hoverNearest(
        chart,
        points,
        (d) => [x(d.first), y(d.last)],
        radius,
        (d) => ({
            title: d.artist,
            lines: [
                `First play: ${d.firstDate}`,
                `Last play: ${d.lastDate}`,
                // The minutes are dropped rather than shown as zero when the
                // artist was only ever scrobbled: the bubble is sized by plays
                // either way.
                `${d.plays.toLocaleString()} plays` +
                    (d.minutes > 0 ? ` · ${Math.round(d.minutes).toLocaleString()} min` : ''),
            ],
        })
    );

    return chart.root;
}
