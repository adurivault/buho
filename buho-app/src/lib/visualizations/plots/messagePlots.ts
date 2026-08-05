import * as Plot from "@observablehq/plot";
import * as d3 from "d3";
import {
    DARK_THEME,
    MESSAGES_COLOR,
    MESSAGES_SECONDARY,
    RULE_OPACITY,
    RULE_STROKE,
    emptyPlot,
    ridgelinePlot,
} from "./common";
import type {
    ContactBalance,
    ContactReplyTimes,
    DailyMessageCount,
    HourWeekdayCell,
    MonthlyContactCount,
    ReactionCount,
} from "$lib/data/queries/messageQueries";

/** DuckDB's DAYOFWEEK: 0 = Sunday. Displayed Monday-first. */
const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

/** Past this many dots, naming every contact makes the quadrant unreadable. */
const LABELLED_CONTACTS = 12;

/** Colors for the two sides of a conversation, used consistently across the guide. */
export const SENT_COLOR = MESSAGES_COLOR;
export const RECEIVED_COLOR = "#f59e0b";

/** "2 min", "1 h 20", "3 j" — compact durations for axes and tooltips. */
export function formatDuration(seconds: number): string {
    if (!Number.isFinite(seconds) || seconds < 0) return "—";
    if (seconds < 60) return `${Math.round(seconds)} s`;
    if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
    if (seconds < 86400) {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.round((seconds % 3600) / 60);
        return minutes === 0 ? `${hours} h` : `${hours} h ${minutes}`;
    }
    return `${(seconds / 86400).toFixed(1)} d`;
}

/**
 * Weekday × hour heatmap of message volume. `direction` narrows to one side of
 * the conversation; "both" sums them.
 */
export function hourWeekdayHeatmapPlot(
    data: HourWeekdayCell[],
    options: { width?: number; direction?: "sent" | "received" | "both" } & Record<string, any> = {}
) {
    const { width = 900, direction = "both", ...rest } = options;
    const filtered = direction === "both" ? data : data.filter((c) => c.direction === direction);

    if (filtered.length === 0) return emptyPlot("No messages in this range.");

    // Sum the two directions into one cell per (weekday, hour) when showing both.
    const cells = Array.from(
        d3.rollup(
            filtered,
            (rows) => d3.sum(rows, (r) => r.messages),
            (r) => r.dow,
            (r) => r.hour
        ),
        ([dow, byHour]) =>
            Array.from(byHour, ([hour, messages]) => ({ dow, hour, messages }))
    ).flat();

    return Plot.plot({
        width,
        height: 260,
        marginLeft: 44,
        marginBottom: 34,
        padding: 0,
        x: {
            label: "Hour of day",
            domain: d3.range(24),
            tickFormat: (h: number) => (h % 3 === 0 ? String(h) : ""),
            tickSize: 0,
        },
        y: {
            label: null,
            domain: WEEK_ORDER,
            tickFormat: (d: number) => DAY_LABELS[d] ?? "",
            tickSize: 0,
        },
        color: {
            type: "sqrt",
            scheme: "blues",
            label: "Messages",
            legend: true,
        },
        marks: [
            Plot.cell(cells, {
                x: "hour",
                y: "dow",
                fill: "messages",
                inset: 0.5,
                rx: 2,
                tip: true,
                title: (d: any) =>
                    `${DAY_LABELS[d.dow]} ${String(d.hour).padStart(2, "0")}:00\n${d.messages.toLocaleString()} messages`,
            }),
        ],
        ...DARK_THEME,
        ...rest,
    }) as HTMLElement | SVGElement;
}

/**
 * Calendar heatmap of daily message volume, one facet per year (GitHub-style).
 */
export function messageCalendarPlot(
    data: DailyMessageCount[],
    options: { width?: number } & Record<string, any> = {}
) {
    const { width = 1100, ...rest } = options;
    const days = data
        .filter((d) => d.messages > 0)
        .map((d) => ({ date: new Date(`${d.date}T00:00:00Z`), messages: d.messages }));

    if (days.length === 0) return emptyPlot("No messages in this range.", 240);

    const years = Array.from(new Set(days.map((d) => d.date.getUTCFullYear()))).sort((a, b) => a - b);

    return Plot.plot({
        width,
        height: years.length * 148 + 40,
        marginLeft: 34,
        marginRight: 12,
        padding: 0,
        x: { axis: null },
        y: {
            tickFormat: (d: number) => DAY_LABELS[d]?.[0] ?? "",
            domain: WEEK_ORDER,
            tickSize: 0,
            label: null,
        },
        fy: { tickFormat: (y: number) => String(y), label: null },
        color: { type: "sqrt", scheme: "blues", label: "Messages / day", legend: true },
        marks: [
            Plot.cell(days, {
                x: (d) => d3.utcWeek.count(d3.utcYear(d.date), d.date),
                y: (d) => d.date.getUTCDay(),
                fy: (d) => d.date.getUTCFullYear(),
                fill: "messages",
                inset: 0.5,
                rx: 2,
                tip: true,
                title: (d) =>
                    `${d.date.toLocaleDateString(undefined, {
                        weekday: "short",
                        year: "numeric",
                        month: "long",
                        day: "numeric",
                        timeZone: "UTC",
                    })}\n${d.messages.toLocaleString()} messages`,
            }),
        ],
        ...DARK_THEME,
        ...rest,
    }) as HTMLElement | SVGElement;
}

/**
 * Diverging bars, one row per contact: messages I sent to the left of the axis,
 * messages they sent to the right. Sorted by imbalance, so the people you chase
 * and the people who chase you sit at the two ends.
 */
export function conversationBalancePlot(
    data: ContactBalance[],
    options: { width?: number; topN?: number } & Record<string, any> = {}
) {
    const { width = 900, topN = 20, ...rest } = options;
    const rows = data
        .filter((d) => d.messages > 0)
        .slice(0, topN)
        .map((d) => ({
            contact: d.contact,
            messages: d.messages,
            share: d.sent / d.messages,
            sent: d.sent,
            received: d.received,
        }))
        .sort((a, b) => b.share - a.share);

    if (rows.length === 0) return emptyPlot("No conversations to compare.");

    // One bar per side of the axis: the share I sent, mirrored by the share they did.
    const bars = rows.flatMap((r) => [
        { ...r, side: "Me", value: -r.share },
        { ...r, side: "Them", value: 1 - r.share },
    ]);

    return Plot.plot({
        width,
        height: rows.length * 22 + 60,
        marginLeft: 160,
        marginRight: 60,
        x: {
            label: "← I write more · they write more →",
            domain: [-1, 1],
            tickFormat: (v: number) => `${Math.abs(Math.round(v * 100))}%`,
            grid: true,
        },
        y: { label: null, domain: rows.map((r) => r.contact), tickSize: 0 },
        color: {
            domain: ["Me", "Them"],
            range: [SENT_COLOR, RECEIVED_COLOR],
            legend: true,
            label: null,
        },
        marks: [
            Plot.barX(bars, {
                x: "value",
                y: "contact",
                fill: "side",
                insetTop: 2,
                insetBottom: 2,
                tip: true,
                title: (d: any) =>
                    `${d.contact}\nI sent ${d.sent.toLocaleString()} · they sent ${d.received.toLocaleString()}\n${Math.round(d.share * 100)}% of the thread is mine`,
            }),
            Plot.ruleX([0], { stroke: RULE_STROKE, strokeOpacity: 0.5 }),
            Plot.text(rows, {
                y: "contact",
                x: 1,
                dx: 6,
                text: (d: any) => d.messages.toLocaleString(),
                textAnchor: "start",
                fontSize: 11,
                fillOpacity: 0.6,
            }),
        ],
        ...DARK_THEME,
        ...rest,
    }) as HTMLElement | SVGElement;
}

/**
 * Reply-time quadrant: my median turn-around against theirs, both on log scales,
 * one dot per contact sized by volume. The diagonal separates the contacts I
 * answer faster than they answer me from the reverse.
 */
export function replyTimeQuadrantPlot(
    data: ContactReplyTimes[],
    options: { width?: number } & Record<string, any> = {}
) {
    const { width = 760, ...rest } = options;
    const rows = data
        .filter((d) => d.myMedianSeconds !== null && d.theirMedianSeconds !== null)
        .map((d) => ({
            contact: d.contact,
            mine: Math.max(1, d.myMedianSeconds as number),
            theirs: Math.max(1, d.theirMedianSeconds as number),
            messages: d.messages,
        }));

    if (rows.length === 0) return emptyPlot("Not enough back-and-forth to measure reply times.");

    const extent = [
        Math.min(d3.min(rows, (r) => Math.min(r.mine, r.theirs)) ?? 1, 60) * 0.7,
        (d3.max(rows, (r) => Math.max(r.mine, r.theirs)) ?? 3600) * 1.4,
    ];

    const labelled = [...rows]
        .sort((a, b) => b.messages - a.messages)
        .slice(0, LABELLED_CONTACTS);

    return Plot.plot({
        width,
        height: 520,
        marginLeft: 64,
        marginBottom: 46,
        x: {
            type: "log",
            domain: extent,
            label: "My median reply time →",
            tickFormat: formatDuration,
            grid: true,
        },
        y: {
            type: "log",
            domain: extent,
            label: "↑ Their median reply time",
            tickFormat: formatDuration,
            grid: true,
        },
        r: { range: [3, 16] },
        marks: [
            Plot.link([{ a: extent[0], b: extent[1] }], {
                x1: "a",
                y1: "a",
                x2: "b",
                y2: "b",
                stroke: RULE_STROKE,
                strokeOpacity: RULE_OPACITY,
                strokeDasharray: "4 4",
            }),
            // Naming the two halves saves the reader from decoding the
            // diagonal. Two marks rather than one: `dx`/`dy`/`textAnchor` are
            // constants in Plot, not channels, so each corner needs its own.
            Plot.text([{ x: extent[0], y: extent[1] }], {
                x: "x",
                y: "y",
                text: () => "They keep you waiting",
                textAnchor: "start",
                dx: 8,
                dy: 14,
                fontSize: 11,
                fillOpacity: 0.45,
            }),
            Plot.text([{ x: extent[1], y: extent[0] }], {
                x: "x",
                y: "y",
                text: () => "You keep them waiting",
                textAnchor: "end",
                dx: -8,
                dy: -8,
                fontSize: 11,
                fillOpacity: 0.45,
            }),
            Plot.dot(rows, {
                x: "mine",
                y: "theirs",
                r: "messages",
                fill: MESSAGES_COLOR,
                fillOpacity: 0.7,
                // A background-coloured halo separates overlapping contacts in
                // either theme, which a fixed pale blue only managed on dark.
                stroke: "var(--plot-background)",
                strokeWidth: 1,
                tip: true,
                title: (d: any) =>
                    `${d.contact}\nI answer in ${formatDuration(d.mine)}\nThey answer in ${formatDuration(d.theirs)}\n${d.messages.toLocaleString()} messages`,
            }),
            // Only the busiest threads get a name: labelling every dot turns the
            // cloud into an unreadable pile of overlapping text.
            Plot.text(labelled, {
                x: "mine",
                y: "theirs",
                text: "contact",
                dy: -12,
                fontSize: 10,
                fill: "currentColor",
                stroke: "var(--plot-background)",
                strokeWidth: 3,
                paintOrder: "stroke",
            }),
        ],
        ...DARK_THEME,
        ...rest,
    }) as HTMLElement | SVGElement;
}

/** Contact ridgeline: monthly volume per contact, in the order they arrive. */
export function contactRidgelinePlot(
    data: MonthlyContactCount[],
    options: Record<string, any> = {}
) {
    return ridgelinePlot(
        data.map((d) => ({ key: d.name, month: d.month, value: d.messages })),
        {
            fill: MESSAGES_COLOR,
            stroke: MESSAGES_SECONDARY,
            emptyMessage: "No conversations in this range.",
            title: (row) => `${row.key} · ${row.month.slice(0, 7)} · ${row.value.toLocaleString()} messages`,
            ...options,
        }
    );
}

/**
 * Reaction emojis, given against received. Grouped bars keep the asymmetry
 * visible: the emojis people send you are rarely the ones you send back.
 */
export function reactionBreakdownPlot(
    data: ReactionCount[],
    options: { width?: number; topN?: number } & Record<string, any> = {}
) {
    const { width = 760, topN = 10, ...rest } = options;
    const rows = data
        .slice(0, topN)
        .flatMap((r) => [
            { emoji: r.emoji, side: "Received", count: r.received },
            { emoji: r.emoji, side: "Given", count: r.given },
        ])
        .filter((r) => r.count > 0);

    if (rows.length === 0) return emptyPlot("No reactions in this export.", 240);

    const order = data.slice(0, topN).map((r) => r.emoji);

    return Plot.plot({
        width,
        height: 320,
        marginLeft: 48,
        marginBottom: 40,
        // One facet per emoji, two bars inside it: grouped, not stacked, so the
        // given/received asymmetry is readable at a glance.
        fx: { label: null, domain: order, tickSize: 0 },
        x: { axis: null, domain: ["Received", "Given"], padding: 0.15 },
        y: { label: "Reactions", grid: true },
        color: {
            domain: ["Received", "Given"],
            range: [MESSAGES_COLOR, RECEIVED_COLOR],
            legend: true,
            label: null,
        },
        marks: [
            Plot.barY(rows, {
                fx: "emoji",
                x: "side",
                y: "count",
                fill: "side",
                tip: true,
                title: (d: any) => `${d.emoji} ${d.side.toLowerCase()}: ${d.count.toLocaleString()}`,
            }),
            Plot.ruleY([0], { stroke: RULE_STROKE, strokeOpacity: 0.4 }),
        ],
        ...DARK_THEME,
        ...rest,
    }) as HTMLElement | SVGElement;
}
