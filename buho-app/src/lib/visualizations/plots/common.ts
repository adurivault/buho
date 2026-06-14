import * as d3 from "d3";

// Spotify brand-like greens
export const ACCENT_COLOR = "#1DB954";
export const ACCENT_SECONDARY = "#1ED760";

// Chart styling defaults
export const DARK_THEME = {
    backgroundColor: "transparent",
    style: {
        color: "#e0e6ed",
        fontSize: "12px",
        fontFamily: "Inter, system-ui, sans-serif"
    }
};

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
        slice.setAttribute("stroke", "#0f172a");
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
        label.setAttribute("fill", "#e0e6ed");
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
