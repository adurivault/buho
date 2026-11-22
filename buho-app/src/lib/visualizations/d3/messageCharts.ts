import * as d3 from 'd3';
import type {
    ContactBalance,
    ContactReplyTimes,
    MonthlyContactCount,
    ReactionCount,
} from '#lib/data/queries/messageQueries.ts';
import {
    CHART,
    MARK,
    THEM_COLOR,
    YOU_COLOR,
    bottomAxis,
    createChart,
    emptyChart,
    fillVar,
    formatTick,
    haloText,
    horizontalBar,
    hoverNearest,
    leftAxis,
    logTicks,
    peakVar,
    swatchLegend,
    verticalBar,
} from './chart';
import { ridgelineChart } from './ridgeline';

/**
 * Group threads sit out of every per-contact comparison.
 *
 * "You against them" has no answer in a thread where "them" is nine people:
 * you are one voice among many, so the split measures the size of the group
 * rather than anything about the friendship. They stay in the charts that only
 * count volume — the race, the ridgeline — where being loud is the point.
 */
const oneToOne = <T extends { isGroup: boolean }>(rows: T[]) => rows.filter((row) => !row.isGroup);

/** Past this many dots, naming every contact makes the quadrant unreadable. */
const LABELLED_CONTACTS = 12;

/** "2 min", "1 h 20", "3.0 d": compact durations for axes and tooltips. */
export function formatDuration(seconds: number): string {
    if (!Number.isFinite(seconds) || seconds < 0) return '—';
    if (seconds < 60) return `${Math.round(seconds)} s`;
    if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
    if (seconds < 86400) {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.round((seconds % 3600) / 60);
        return minutes === 0 ? `${hours} h` : `${hours} h ${minutes}`;
    }
    return `${(seconds / 86400).toFixed(1)} d`;
}

/** One dot in a quadrant: two comparable numbers about the same contact. */
interface QuadrantRow {
    contact: string;
    x: number;
    y: number;
    /** Sets the radius, and decides which contacts are worth naming. */
    size: number;
    /** Tooltip lines under the name: each chart has something different to say. */
    lines: string[];
    /** The dot's colour: which side of the conversation it leans to. */
    color: string;
}

/**
 * The frame the two "you against them" charts share: one dot per contact on two
 * log axes over the same domain, a dashed diagonal where the two sides come out
 * even, and a caption in each half so the diagonal doesn't need decoding.
 */
function contactQuadrantChart(
    rows: QuadrantRow[],
    options: {
        domain: [number, number];
        xLabel: string;
        yLabel: string;
        tickFormat: (value: number) => string;
        /** Captions for the top-left and bottom-right halves. */
        aboveLabel: string;
        belowLabel: string;
        /** Tick values; 1-3-10 steps unless the unit has rounder ones of its own. */
        ticks?: number[];
        legend?: HTMLElement;
        label: string;
        width?: number;
    }
): HTMLElement {
    const { domain, xLabel, yLabel, tickFormat, aboveLabel, belowLabel, legend, label } = options;
    const chart = createChart({
        width: options.width ?? 760,
        height: 520,
        margin: { top: 28, right: 20, bottom: 46, left: 64 },
        label,
        legend,
    });

    const x = d3.scaleLog().domain(domain).range([0, chart.innerWidth]);
    const y = d3.scaleLog().domain(domain).range([chart.innerHeight, 0]);
    const ticks = (options.ticks ?? logTicks(domain)).filter(
        (v) => v >= domain[0] && v <= domain[1]
    );
    const r = d3
        .scaleSqrt()
        .domain([0, d3.max(rows, (d) => d.size) ?? 1])
        .range([0, 16]);
    const radius = (d: QuadrantRow) => Math.max(MARK.dotRadius, r(d.size));

    bottomAxis(
        chart,
        d3
            .axisBottom(x)
            .tickValues(ticks)
            .tickFormat((v) => tickFormat(Number(v))),
        { grid: true, label: xLabel }
    );
    leftAxis(
        chart,
        d3
            .axisLeft(y)
            .tickValues(ticks)
            .tickFormat((v) => tickFormat(Number(v))),
        { grid: true, label: yLabel }
    );

    chart.plot
        .append('line')
        .attr('x1', x(domain[0]))
        .attr('y1', y(domain[0]))
        .attr('x2', x(domain[1]))
        .attr('y2', y(domain[1]))
        .attr('stroke', CHART.axis)
        .attr('stroke-dasharray', MARK.referenceDash);

    // Naming the two halves saves the reader from decoding the diagonal.
    chart.plot
        .append('text')
        .attr('x', 8)
        .attr('y', 16)
        .attr('fill', 'currentColor')
        .text(aboveLabel);
    chart.plot
        .append('text')
        .attr('x', chart.innerWidth - 8)
        .attr('y', chart.innerHeight - 10)
        .attr('text-anchor', 'end')
        .attr('fill', 'currentColor')
        .text(belowLabel);

    const ordered = [...rows].sort((a, b) => b.size - a.size);
    chart.plot
        .append('g')
        .selectAll('circle')
        .data(ordered)
        .join('circle')
        .attr('cx', (d) => x(d.x))
        .attr('cy', (d) => y(d.y))
        .attr('r', radius)
        .attr('fill', (d) => d.color)
        .attr('fill-opacity', 0.85)
        .attr('stroke', CHART.surface)
        .attr('stroke-width', MARK.ring);

    // Only the busiest threads get a name, and only where it fits: labelling
    // every dot turns the cloud into a pile of overlapping text.
    chart.plot
        .append('g')
        .selectAll('text')
        .data(
            placeLabels(ordered.slice(0, LABELLED_CONTACTS), (d) => [
                x(d.x),
                y(d.y) - radius(d) - 4,
            ])
        )
        .join('text')
        .attr('x', (d) => x(d.x))
        .attr('y', (d) => y(d.y) - radius(d) - 4)
        .attr('text-anchor', 'middle')
        .text((d) => d.contact)
        .call(haloText);

    hoverNearest(
        chart,
        ordered,
        (d) => [x(d.x), y(d.y)],
        radius,
        (d) => ({ title: d.contact, lines: d.lines })
    );

    return chart.root;
}

/**
 * Keeps the labels that don't collide with one already placed, biggest first.
 * The width is estimated from the length of the name: close enough at the label
 * size to tell two overlapping names apart, without measuring text.
 */
function placeLabels<T extends { contact: string }>(
    rows: T[],
    anchor: (row: T) => [number, number]
): T[] {
    const CHAR = 6.2;
    const HEIGHT = 13;
    const placed: Array<{ x0: number; x1: number; y0: number; y1: number }> = [];
    return rows.filter((row) => {
        const [cx, by] = anchor(row);
        const half = (row.contact.length * CHAR) / 2;
        const box = { x0: cx - half, x1: cx + half, y0: by - HEIGHT, y1: by };
        const clash = placed.some(
            (p) => box.x0 < p.x1 && box.x1 > p.x0 && box.y0 < p.y1 && box.y1 > p.y0
        );
        if (!clash) placed.push(box);
        return !clash;
    });
}

/** Round durations for the reply-time axes: a minute, a quarter hour, a day. */
const DURATION_TICKS = [10, 60, 5 * 60, 15 * 60, 3600, 6 * 3600, 86400, 7 * 86400];

const MINE_SIDE = 'You write more';
const THEIRS_SIDE = 'They write more';

/**
 * Balance quadrant: the messages I sent someone against the ones they sent me,
 * one dot per contact sized by the size of the thread. The diagonal is an even
 * split — above it they carry the conversation, below it I do.
 */
export function conversationBalanceChart(
    data: ContactBalance[],
    options: { width?: number; topN?: number } = {}
): HTMLElement {
    const { topN = 40, width } = options;
    const rows: QuadrantRow[] = oneToOne(data)
        .filter((d) => d.messages > 0)
        .slice(0, topN)
        .map((d) => ({
            contact: d.contact,
            // A log axis has no room for a zero: someone who never answered
            // still belongs on the chart, at the edge of it.
            x: Math.max(1, d.sent),
            y: Math.max(1, d.received),
            size: d.messages,
            color: d.sent >= d.received ? YOU_COLOR : THEM_COLOR,
            lines: [
                `I sent ${d.sent.toLocaleString()} · they sent ${d.received.toLocaleString()}`,
                `${Math.round((d.sent / d.messages) * 100)}% of the thread is mine`,
            ],
        }));

    if (rows.length === 0) return emptyChart('No conversations to compare.');

    const domain: [number, number] = [
        (d3.min(rows, (r) => Math.min(r.x, r.y)) ?? 1) * 0.7,
        (d3.max(rows, (r) => Math.max(r.x, r.y)) ?? 10) * 1.5,
    ];

    return contactQuadrantChart(rows, {
        domain,
        xLabel: 'Messages I sent them',
        yLabel: 'Messages they sent me',
        tickFormat: formatTick,
        aboveLabel: 'They carry the thread',
        belowLabel: 'You carry the thread',
        legend: swatchLegend([
            { label: MINE_SIDE, color: YOU_COLOR },
            { label: THEIRS_SIDE, color: THEM_COLOR },
        ]),
        label: 'Messages sent against messages received, one dot per contact',
        width,
    });
}

/**
 * Reply-time quadrant: my median turn-around against theirs, both on log scales,
 * one dot per contact sized by volume. The diagonal separates the contacts I
 * answer faster than they answer me from the reverse.
 */
export function replyTimeQuadrantChart(
    data: ContactReplyTimes[],
    options: { width?: number } = {}
): HTMLElement {
    const rows: QuadrantRow[] = oneToOne(data)
        .filter((d) => d.myMedianSeconds !== null && d.theirMedianSeconds !== null)
        .map((d) => {
            const mine = Math.max(1, d.myMedianSeconds as number);
            const theirs = Math.max(1, d.theirMedianSeconds as number);
            return {
                contact: d.contact,
                x: mine,
                y: theirs,
                size: d.messages,
                color: peakVar('messages'),
                lines: [
                    `I answer in ${formatDuration(mine)}`,
                    `They answer in ${formatDuration(theirs)}`,
                    `${d.messages.toLocaleString()} messages`,
                ],
            };
        });

    if (rows.length === 0) return emptyChart('Not enough back-and-forth to measure reply times.');

    // The floor keeps a minute on the axis even when every median is faster:
    // a chart whose whole domain is seconds reads as a much bigger spread.
    const domain: [number, number] = [
        Math.min(d3.min(rows, (r) => Math.min(r.x, r.y)) ?? 1, 60) * 0.7,
        (d3.max(rows, (r) => Math.max(r.x, r.y)) ?? 3600) * 1.4,
    ];

    return contactQuadrantChart(rows, {
        domain,
        xLabel: 'My median reply time',
        yLabel: 'Their median reply time',
        tickFormat: formatDuration,
        ticks: DURATION_TICKS,
        aboveLabel: 'They keep you waiting',
        belowLabel: 'You keep them waiting',
        label: 'My median reply time against theirs, one dot per contact',
        width: options.width,
    });
}

/**
 * Diverging bars, one row per contact: the share of conversations I opened to
 * the left of the axis, the share they opened to the right. Sorted by that
 * share, so the people you reach out to and the people who come to you sit at
 * the two ends. The number on the right is how many conversations there were.
 */
export function conversationStartersChart(
    data: ContactBalance[],
    options: { width?: number; topN?: number; minSessions?: number } = {}
): HTMLElement {
    const { width = 900, topN = 20, minSessions = 5 } = options;
    // Under a handful of conversations a contact is only ever 0% or 100%, which
    // would take both ends of the ranking and say nothing.
    const rows = oneToOne(data)
        .filter((d) => d.sessions >= minSessions)
        .slice(0, topN)
        .map((d) => ({
            contact: d.contact,
            sessions: d.sessions,
            mine: d.sessionsIStarted,
            theirs: d.sessions - d.sessionsIStarted,
            share: d.sessionsIStarted / d.sessions,
        }))
        .sort((a, b) => b.share - a.share);

    if (rows.length === 0) return emptyChart('No conversations to compare.');

    const chart = createChart({
        width,
        height: rows.length * 24 + 52,
        margin: { top: 4, right: 56, bottom: 48, left: 140 },
        label: 'Share of conversations each side opened, one row per contact',
        legend: swatchLegend([
            { label: 'Me', color: YOU_COLOR },
            { label: 'Them', color: THEM_COLOR },
        ]),
    });

    const x = d3.scaleLinear().domain([-1, 1]).range([0, chart.innerWidth]);
    const y = d3
        .scaleBand()
        .domain(rows.map((r) => r.contact))
        .range([0, chart.innerHeight])
        .padding(0.25);
    const thickness = Math.min(y.bandwidth(), MARK.barMax);
    const top = (contact: string) => (y(contact) ?? 0) + (y.bandwidth() - thickness) / 2;
    const zero = x(0);
    const half = MARK.gap / 2;

    bottomAxis(
        chart,
        d3
            .axisBottom(x)
            .tickValues([-1, -0.5, 0, 0.5, 1])
            .tickFormat((v) => `${Math.abs(Math.round(Number(v) * 100))}%`),
        { grid: true }
    );
    const yAxis = leftAxis(chart, d3.axisLeft(y));
    yAxis.selectAll('.tick text').attr('fill', CHART.ink);

    // The two halves of the axis named under each side, instead of arrows.
    chart.plot
        .append('text')
        .attr('x', zero - 8)
        .attr('y', chart.innerHeight + chart.margin.bottom - 8)
        .attr('text-anchor', 'end')
        .attr('fill', 'currentColor')
        .text('I reach out');
    chart.plot
        .append('text')
        .attr('x', zero + 8)
        .attr('y', chart.innerHeight + chart.margin.bottom - 8)
        .attr('fill', 'currentColor')
        .text('They reach out');

    const bars = chart.plot.append('g');
    bars.selectAll('path.mine')
        .data(rows.filter((r) => r.share > 0))
        .join('path')
        .attr('class', 'mine')
        .attr('fill', YOU_COLOR)
        .attr('d', (r) =>
            horizontalBar(x(-r.share), zero - half, top(r.contact), thickness, { left: true })
        );
    bars.selectAll('path.theirs')
        .data(rows.filter((r) => r.share < 1))
        .join('path')
        .attr('class', 'theirs')
        .attr('fill', THEM_COLOR)
        .attr('d', (r) =>
            horizontalBar(zero + half, x(1 - r.share), top(r.contact), thickness, { right: true })
        );

    chart.plot
        .append('g')
        .selectAll('text')
        .data(rows)
        .join('text')
        .attr('x', chart.innerWidth + 8)
        .attr('y', (r) => (y(r.contact) ?? 0) + y.bandwidth() / 2)
        .attr('dy', '0.32em')
        .attr('fill', 'currentColor')
        .text((r) => r.sessions.toLocaleString());

    // The whole row answers the pointer, not just the painted bar.
    chart.plot
        .append('g')
        .selectAll('rect')
        .data(rows)
        .join('rect')
        .attr('x', 0)
        .attr('y', (r) => y(r.contact) ?? 0)
        .attr('width', chart.innerWidth)
        .attr('height', y.step())
        .attr('fill', 'transparent')
        .on('pointermove', (event: PointerEvent, r) =>
            chart.tooltip.show(event, r.contact, [
                `I opened ${r.mine.toLocaleString()} · they opened ${r.theirs.toLocaleString()}`,
                `${Math.round(r.share * 100)}% of the conversations are mine`,
            ])
        )
        .on('pointerleave', () => chart.tooltip.hide());

    return chart.root;
}

/** Contact ridgeline: monthly volume per contact, in the order they arrive. */
export function contactRidgelineChart(
    data: MonthlyContactCount[],
    options: { width?: number } = {}
): HTMLElement {
    return ridgelineChart(
        data.map((d) => ({ key: d.name, month: d.month, value: d.messages })),
        {
            width: options.width,
            color: fillVar('messages'),
            outline: peakVar('messages'),
            emptyMessage: 'No conversations in this range.',
            describe: (row) => [
                `${row.month.slice(0, 7)} · ${row.value.toLocaleString()} messages`,
            ],
        }
    );
}

/**
 * Reaction emojis, received against given. Grouped bars keep the asymmetry
 * visible: the emojis people send you are rarely the ones you send back. What
 * you give is "you"; what lands on your messages is "them".
 */
export function reactionBreakdownChart(
    data: ReactionCount[],
    options: { width?: number; topN?: number } = {}
): HTMLElement {
    const { width = 760, topN = 10 } = options;
    const top = data.slice(0, topN);
    const SIDES = [
        { key: 'Received', color: THEM_COLOR, count: (r: ReactionCount) => r.received },
        { key: 'Given', color: YOU_COLOR, count: (r: ReactionCount) => r.given },
    ] as const;
    const bars = top
        .flatMap((r) => SIDES.map((side) => ({ emoji: r.emoji, side, count: side.count(r) })))
        .filter((b) => b.count > 0);

    if (bars.length === 0) return emptyChart('No reactions in this export.');

    const chart = createChart({
        width,
        height: 320,
        margin: { top: 28, right: 12, bottom: 40, left: 48 },
        label: 'Reactions received and given, per emoji',
        legend: swatchLegend(SIDES.map((s) => ({ label: s.key, color: s.color }))),
    });

    const x = d3
        .scaleBand()
        .domain(top.map((r) => r.emoji))
        .range([0, chart.innerWidth])
        .padding(0.25);
    const inner = d3
        .scaleBand()
        .domain(SIDES.map((s) => s.key))
        .range([0, x.bandwidth()])
        .paddingInner(0.12);
    const y = d3
        .scaleLinear()
        .domain([0, d3.max(bars, (b) => b.count) ?? 1])
        .nice()
        .range([chart.innerHeight, 0]);
    const thickness = Math.min(inner.bandwidth(), MARK.barMax);

    const xAxis = bottomAxis(chart, d3.axisBottom(x));
    // An emoji at tick size is a smudge; give it the body size.
    xAxis.selectAll('.tick text').style('font-size', 'var(--text-body)');
    leftAxis(
        chart,
        d3
            .axisLeft(y)
            .ticks(5)
            .tickFormat((v) => formatTick(Number(v))),
        { grid: true, label: 'Reactions' }
    );

    chart.plot
        .append('g')
        .selectAll('path')
        .data(bars)
        .join('path')
        .attr('fill', (b) => b.side.color)
        .attr('d', (b) => {
            const left =
                (x(b.emoji) ?? 0) + (inner(b.side.key) ?? 0) + (inner.bandwidth() - thickness) / 2;
            return verticalBar(left, thickness, y(0), y(b.count));
        })
        .on('pointermove', (event: PointerEvent, b) =>
            chart.tooltip.show(event, `${b.emoji} ${b.side.key.toLowerCase()}`, [
                b.count.toLocaleString(),
            ])
        )
        .on('pointerleave', () => chart.tooltip.hide());

    chart.plot
        .append('line')
        .attr('x2', chart.innerWidth)
        .attr('y1', y(0))
        .attr('y2', y(0))
        .attr('stroke', CHART.axis);

    return chart.root;
}
