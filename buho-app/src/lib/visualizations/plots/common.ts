import * as d3 from "d3";
import * as Plot from "@observablehq/plot";

// Spotify brand-like greens
export const ACCENT_COLOR = "#1DB954";
export const ACCENT_SECONDARY = "#1ED760";

/** Messages "universe" accent, mirroring --accent-messages in app.css. */
export const MESSAGES_COLOR = "#3b82f6";
export const MESSAGES_SECONDARY = "#93c5fd";

/**
 * Chart styling defaults.
 *
 * `color: "currentColor"` is what makes every chart follow the light/dark
 * toggle: Plot paints its text and rules with the root element's colour, and
 * `currentColor` there resolves to whatever the surrounding page is using. A
 * fixed hex — which this used to be — is pale grey on a white background.
 *
 * Named DARK_THEME for historical reasons; it is theme-agnostic now.
 */
export const DARK_THEME = {
    backgroundColor: "transparent",
    style: {
        color: "currentColor",
        fontSize: "12px",
        fontFamily: "Inter, system-ui, sans-serif"
    }
};

/**
 * Placeholder shown instead of a chart when there is nothing to draw.
 * Every factory needs one, and they had each grown their own.
 */
export function emptyPlot(message: string, minHeight = 280): HTMLElement {
    const root = document.createElement("div");
    root.style.cssText = `display:flex;align-items:center;justify-content:center;min-height:${minHeight}px;opacity:0.6;font-size:0.9rem`;
    root.textContent = message;
    return root;
}

/**
 * Hairline used for baselines and separators inside a chart. Tied to the text
 * colour rather than a fixed grey so it stays visible in both themes.
 */
export const RULE_STROKE = "currentColor";
export const RULE_OPACITY = 0.25;

export const PIE_COLORS = [
    "#1DB954",
    "#1ED760",
    "#22c55e",
    "#84cc16",
    "#14b8a6",
    "#06b6d4",
    "#60a5fa",
    "#f59e0b",
    "#f97316",
    "#ef4444"
];

/**
 * Curve shared by a ridgeline's fill and its outline. `basis` smooths hard
 * enough to read as a density without inventing peaks the data doesn't have.
 */
const CURVE = "basis";

/** One (series, month) bucket of a ridgeline. */
export type RidgeRow = {
    key: string;
    month: string; // 'YYYY-MM-DD'
    value: number;
};

export interface RidgelineOptions {
    width?: number;
    /** Ridge fill and outline. */
    fill?: string;
    stroke?: string;
    emptyMessage?: string;
    /** Tooltip text for a bucket; defaults to "<key> · <month> · <value>". */
    title?: (row: RidgeRow) => string;
}

/**
 * Ridgeline / joyplot: each series gets an overlapping ridge of its monthly
 * value, ordered top-to-bottom by the month it first appears — so the chart
 * reads as an arrival order (artists discovered, people met).
 *
 * Shared by the Spotify artist ridgeline and the messages contact ridgeline:
 * only the label of the measure differs between them.
 */
export function ridgelinePlot(
    data: RidgeRow[],
    { width = 1100, fill = ACCENT_COLOR, stroke = ACCENT_SECONDARY, emptyMessage = "No data in this range.", title, ...options }: RidgelineOptions & Record<string, any> = {}
) {
    if (data.length === 0) return emptyPlot(emptyMessage, 320) as HTMLElement | SVGElement;

    // First active month per series → arrival order (earliest at the top).
    const firstMonth = new Map<string, string>();
    for (const d of data) {
        if (d.value <= 0) continue;
        const current = firstMonth.get(d.key);
        if (current === undefined || d.month < current) firstMonth.set(d.key, d.month);
    }

    const order = Array.from(firstMonth.keys()).sort((a, b) => {
        const fa = firstMonth.get(a) as string;
        const fb = firstMonth.get(b) as string;
        return fa < fb ? -1 : fa > fb ? 1 : a.localeCompare(b);
    });

    const n = order.length;
    const indexOf = new Map(order.map((key, i) => [key, i]));
    const maxValue = d3.max(data, (d) => d.value) ?? 1;

    const step = 20; // vertical px per row
    const amp = step * 2.5; // ridge height (> step ⇒ overlap into the row above)
    const marginTop = 56; // room for the tallest ridge to overflow upward
    const marginBottom = 40;
    const innerHeight = n * step;
    const height = marginTop + marginBottom + innerHeight;

    // Manual pixel placement: ridges and labels share one identity y-scale (value = px
    // from the top of the inner area), so baselines line up exactly with the names.
    const baselineOf = (i: number) => i * step + step / 2;

    const rows = data
        .filter((d) => indexOf.has(d.key))
        .map((d) => {
            const base = baselineOf(indexOf.get(d.key) as number);
            return {
                key: d.key,
                month: new Date(`${d.month}T00:00:00`),
                yBase: base,
                yTop: base - (d.value / maxValue) * amp,
                value: d.value,
                label: title ? title(d) : `${d.key} · ${d.month} · ${d.value.toLocaleString()}`
            };
        });

    const labels = order.map((key, i) => ({ key, y: baselineOf(i) }));

    return Plot.plot({
        width,
        height,
        marginTop,
        marginBottom,
        marginLeft: 160,
        marginRight: 16,
        x: { label: null, type: "time", grid: true },
        y: { axis: null, domain: [0, innerHeight], range: [0, innerHeight] },
        marks: [
            Plot.ruleY(labels, {
                y: "y",
                stroke: RULE_STROKE,
                strokeOpacity: RULE_OPACITY,
                strokeWidth: 1
            }),
            // Fill and outline are two marks over the same points and the same
            // curve, so they trace the same shape. Neither carries a per-point
            // channel: a `title` that varies along the series makes Plot cut the
            // area into one path per interval, which silently drops the curve
            // and leaves a polygon under a smooth outline.
            Plot.areaY(rows, {
                x: "month",
                y1: "yBase",
                y2: "yTop",
                z: "key",
                fill,
                fillOpacity: 0.5,
                curve: CURVE
            }),
            Plot.line(rows, {
                x: "month",
                y: "yTop",
                z: "key",
                stroke,
                strokeWidth: 1.25,
                strokeLinejoin: "round",
                curve: CURVE
            }),
            // Hover targets live on their own mark, invisible but pickable, so
            // the tooltip costs the area nothing.
            Plot.dot(rows, {
                x: "month",
                y: "yTop",
                r: 4,
                fill: "transparent",
                stroke: "none",
                title: "label"
            }),
            Plot.text(labels, {
                y: "y",
                text: "key",
                frameAnchor: "left",
                textAnchor: "end",
                dx: -10,
                fontSize: 12
            })
        ],
        ...DARK_THEME,
        ...options
    }) as HTMLElement | SVGElement;
}

export type PieItem = {
    label: string;
    value: number;
    color: string;
    share: number;
};

export function polarToCartesian(centerX: number, centerY: number, radius: number, angleInRad: number) {
    return {
        x: centerX + Math.cos(angleInRad) * radius,
        y: centerY + Math.sin(angleInRad) * radius
    };
}

export function describeArc(
    centerX: number,
    centerY: number,
    radius: number,
    startAngle: number,
    endAngle: number
) {
    const start = polarToCartesian(centerX, centerY, radius, endAngle);
    const end = polarToCartesian(centerX, centerY, radius, startAngle);
    const largeArcFlag = endAngle - startAngle <= Math.PI ? 0 : 1;
    return `M ${centerX} ${centerY} L ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArcFlag} 0 ${end.x} ${end.y} Z`;
}

export function createPieChart(title: string, items: PieItem[], options: { width?: number; height?: number } = {}) {
    const width = options.width ?? 760;
    const height = options.height ?? 320;
    const svgSize = Math.min(260, height - 40);
    const radius = svgSize / 2 - 8;
    const centerX = radius + 16;
    const centerY = height / 2;

    const root = document.createElement("div");
    root.style.width = "100%";
    root.style.minHeight = `${height}px`;

    if (items.length === 0) {
        root.className = "pie-empty";
        root.textContent = "No categorical data available for this range.";
        return root;
    }

    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("width", `${width}`);
    svg.setAttribute("height", `${height}`);
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", title);

    let current = -Math.PI / 2;
    for (const item of items) {
        const angle = item.share * Math.PI * 2;
        const slice = document.createElementNS(svgNS, "path");
        slice.setAttribute("d", describeArc(centerX, centerY, radius, current, current + angle));
        slice.setAttribute("fill", item.color);
        slice.setAttribute("stroke", "var(--plot-background)");
        slice.setAttribute("stroke-width", "1");
        slice.appendChild(document.createElementNS(svgNS, "title")).textContent =
            `${item.label}: ${item.value.toLocaleString()} min (${(item.share * 100).toFixed(1)}%)`;
        svg.appendChild(slice);
        current += angle;
    }

    const legendStartX = centerX + radius + 32;
    const legendStartY = 42;
    const legendGap = 24;

    items.forEach((item, index) => {
        const y = legendStartY + index * legendGap;

        const swatch = document.createElementNS(svgNS, "rect");
        swatch.setAttribute("x", `${legendStartX}`);
        swatch.setAttribute("y", `${y - 10}`);
        swatch.setAttribute("width", "12");
        swatch.setAttribute("height", "12");
        swatch.setAttribute("rx", "2");
        swatch.setAttribute("fill", item.color);
        svg.appendChild(swatch);

        const label = document.createElementNS(svgNS, "text");
        label.setAttribute("x", `${legendStartX + 18}`);
        label.setAttribute("y", `${y}`);
        label.setAttribute("fill", "currentColor");
        label.setAttribute("font-size", "12");
        label.setAttribute("font-family", "Inter, system-ui, sans-serif");
        label.textContent = `${item.label} · ${(item.share * 100).toFixed(1)}%`;
        svg.appendChild(label);
    });

    root.appendChild(svg);
    return root;
}

export function buildPieItems<T>(data: T[], labelFn: (row: T) => string, valueFn: (row: T) => number): PieItem[] {
    const cleaned = data
        .map((row, index) => ({
            label: labelFn(row),
            value: Math.max(0, valueFn(row)),
            color: PIE_COLORS[index % PIE_COLORS.length]
        }))
        .filter(row => row.value > 0);

    const total = cleaned.reduce((sum, row) => sum + row.value, 0);
    if (total <= 0) return [];

    return cleaned.map(row => ({
        ...row,
        share: row.value / total
    }));
}
