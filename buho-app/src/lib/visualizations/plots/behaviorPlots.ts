import * as Plot from "@observablehq/plot";
import { ACCENT_COLOR, DARK_THEME, buildPieItems, createPieChart } from "./common";
import type {
    PlatformData,
    ReasonDistributionData,
    ReasonFlowData
} from '$lib/data/queries/behaviorQueries';

/**
 * Horizontal bar chart showing platform distribution
 */
export function platformDistributionPlot(data: PlatformData[], options: any = {}) {
    return Plot.plot({
        marginLeft: 100,
        marginRight: 40,
        height: Math.max(200, data.length * 40),
        x: {
            label: "Minutes →",
            grid: true
        },
        y: {
            label: null,
            domain: data.map(d => d.platform)
        },
        marks: [
            Plot.barX(data, {
                x: "minutes",
                y: "platform",
                fill: ACCENT_COLOR,
                sort: { y: "-x" }
            }),
            Plot.ruleX([0]),
            Plot.text(data, {
                x: "minutes",
                y: "platform",
                text: d => d.minutes.toLocaleString(),
                dx: 5,
                textAnchor: "start",
                fill: "#e0e6ed"
            })
        ],
        ...DARK_THEME,
        ...options
    }) as HTMLElement | SVGElement;
}

export function platformDistributionPiePlot(data: PlatformData[], options: any = {}) {
    const items = buildPieItems(data, d => d.platform, d => d.minutes);
    return createPieChart("Listening share by platform", items, options) as HTMLElement | SVGElement;
}

export function reasonDistributionPiePlot(data: ReasonDistributionData[], options: any = {}) {
    const sorted = [...data].sort((a, b) => b.minutes - a.minutes);
    const top = sorted.slice(0, 8);
    const othersTotal = sorted.slice(8).reduce((sum, row) => sum + row.minutes, 0);
    const compact = othersTotal > 0 ? [...top, { reason: "Other", minutes: othersTotal }] : top;
    const items = buildPieItems(compact, d => d.reason, d => d.minutes);
    return createPieChart("Listening share by reason", items, options) as HTMLElement | SVGElement;
}

type FlowNode = {
    key: string;
    value: number;
    y: number;
    height: number;
    offset: number;
};

export function reasonStartEndFlowPlot(data: ReasonFlowData[], options: any = {}) {
    const width = options.width ?? 920;
    const height = options.height ?? 360;
    const marginTop = 24;
    const marginBottom = 24;
    const leftX = 180;
    const rightX = width - 180;
    const nodeWidth = 16;
    const nodeGap = 8;

    const clean = data.filter(d => d.minutes > 0);
    if (clean.length === 0) {
        const root = document.createElement("div");
        root.textContent = "No reason flow data available for this range.";
        return root as HTMLElement | SVGElement;
    }

    const startTotals = new Map<string, number>();
    const endTotals = new Map<string, number>();
    for (const row of clean) {
        startTotals.set(row.reasonStart, (startTotals.get(row.reasonStart) ?? 0) + row.minutes);
        endTotals.set(row.reasonEnd, (endTotals.get(row.reasonEnd) ?? 0) + row.minutes);
    }

    const topStarts = [...startTotals.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([key]) => key);
    const topEnds = [...endTotals.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([key]) => key);
    const keepStarts = new Set(topStarts);
    const keepEnds = new Set(topEnds);

    const collapsed = new Map<string, ReasonFlowData>();
    for (const row of clean) {
        const reasonStart = keepStarts.has(row.reasonStart) ? row.reasonStart : "Other start";
        const reasonEnd = keepEnds.has(row.reasonEnd) ? row.reasonEnd : "Other end";
        const key = `${reasonStart}|||${reasonEnd}`;
        const current = collapsed.get(key);
        if (current) {
            current.minutes += row.minutes;
        } else {
            collapsed.set(key, { reasonStart, reasonEnd, minutes: row.minutes });
        }
    }

    const links = [...collapsed.values()].sort((a, b) => b.minutes - a.minutes);
    const total = links.reduce((sum, link) => sum + link.minutes, 0);
    const starts = [...new Set(links.map(link => link.reasonStart))];
    const ends = [...new Set(links.map(link => link.reasonEnd))];
    const startsByTotal = starts
        .map(key => ({ key, value: links.filter(l => l.reasonStart === key).reduce((s, l) => s + l.minutes, 0) }))
        .sort((a, b) => b.value - a.value);
    const endsByTotal = ends
        .map(key => ({ key, value: links.filter(l => l.reasonEnd === key).reduce((s, l) => s + l.minutes, 0) }))
        .sort((a, b) => b.value - a.value);

    const lanesHeight = height - marginTop - marginBottom;
    const maxNodes = Math.max(startsByTotal.length, endsByTotal.length);
    const scale = (lanesHeight - (maxNodes - 1) * nodeGap) / Math.max(total, 1);

    function layoutNodes(items: { key: string; value: number }[]): Map<string, FlowNode> {
        const nodes = new Map<string, FlowNode>();
        let y = marginTop;
        for (const item of items) {
            const h = Math.max(6, item.value * scale);
            nodes.set(item.key, {
                key: item.key,
                value: item.value,
                y,
                height: h,
                offset: 0
            });
            y += h + nodeGap;
        }
        return nodes;
    }

    const startNodes = layoutNodes(startsByTotal);
    const endNodes = layoutNodes(endsByTotal);

    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("width", `${width}`);
    svg.setAttribute("height", `${height}`);
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", "Flow from reason_start to reason_end");

    for (const link of links) {
        const s = startNodes.get(link.reasonStart);
        const e = endNodes.get(link.reasonEnd);
        if (!s || !e) continue;

        const h = Math.max(2, link.minutes * scale);
        const sy = s.y + s.offset + h / 2;
        const ey = e.y + e.offset + h / 2;
        s.offset += h;
        e.offset += h;

        const path = document.createElementNS(svgNS, "path");
        const x1 = leftX + nodeWidth;
        const x2 = rightX;
        const c1 = x1 + (x2 - x1) * 0.35;
        const c2 = x1 + (x2 - x1) * 0.65;
        path.setAttribute("d", `M ${x1} ${sy} C ${c1} ${sy}, ${c2} ${ey}, ${x2} ${ey}`);
        path.setAttribute("fill", "none");
        path.setAttribute("stroke", "#1ED760");
        path.setAttribute("stroke-opacity", "0.35");
        path.setAttribute("stroke-width", `${h}`);
        path.appendChild(document.createElementNS(svgNS, "title")).textContent =
            `${link.reasonStart} → ${link.reasonEnd}: ${link.minutes.toLocaleString()} min`;
        svg.appendChild(path);
    }

    function appendNodeColumn(nodes: Map<string, FlowNode>, x: number, anchor: "start" | "end") {
        for (const node of nodes.values()) {
            const rect = document.createElementNS(svgNS, "rect");
            rect.setAttribute("x", `${x}`);
            rect.setAttribute("y", `${node.y}`);
            rect.setAttribute("width", `${nodeWidth}`);
            rect.setAttribute("height", `${node.height}`);
            rect.setAttribute("rx", "2");
            rect.setAttribute("fill", "#1DB954");
            svg.appendChild(rect);

            const label = document.createElementNS(svgNS, "text");
            label.setAttribute("x", anchor === "start" ? `${x - 8}` : `${x + nodeWidth + 8}`);
            label.setAttribute("y", `${node.y + node.height / 2}`);
            label.setAttribute("dominant-baseline", "middle");
            label.setAttribute("text-anchor", anchor === "start" ? "end" : "start");
            label.setAttribute("font-size", "11");
            label.setAttribute("fill", "#e0e6ed");
            label.textContent = `${node.key} (${Math.round((node.value / total) * 100)}%)`;
            svg.appendChild(label);
        }
    }

    appendNodeColumn(startNodes, leftX, "start");
    appendNodeColumn(endNodes, rightX, "end");

    const startTitle = document.createElementNS(svgNS, "text");
    startTitle.setAttribute("x", `${leftX}`);
    startTitle.setAttribute("y", "14");
    startTitle.setAttribute("font-size", "12");
    startTitle.setAttribute("fill", "#94a3b8");
    startTitle.textContent = "reason_start";
    svg.appendChild(startTitle);

    const endTitle = document.createElementNS(svgNS, "text");
    endTitle.setAttribute("x", `${rightX}`);
    endTitle.setAttribute("y", "14");
    endTitle.setAttribute("font-size", "12");
    endTitle.setAttribute("fill", "#94a3b8");
    endTitle.textContent = "reason_end";
    svg.appendChild(endTitle);

    const root = document.createElement("div");
    root.style.width = "100%";
    root.appendChild(svg);
    return root as HTMLElement | SVGElement;
}
