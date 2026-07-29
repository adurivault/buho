import * as Plot from "@observablehq/plot";
import * as d3 from "d3";
import { ACCENT_COLOR, DARK_THEME } from "./common";
import {
    type ArtistDiscoveryRecencyData,
    type TrackObsessionData
} from "$lib/data/queries/discoveryQueries";

function emptyState(message: string): HTMLElement {
    const root = document.createElement("div");
    root.style.display = "flex";
    root.style.alignItems = "center";
    root.style.justifyContent = "center";
    root.style.minHeight = "320px";
    root.style.opacity = "0.6";
    root.textContent = message;
    return root;
}

function truncate(label: string, max = 40): string {
    return label.length > max ? `${label.slice(0, max - 1)}…` : label;
}

/**
 * Per-artist discovery date (x) vs. last-listen date (y), bubble size = total plays.
 * The dashed diagonal is the "heard once and dropped" line; height above it = lifespan.
 */
export function discoveryRecencyScatterPlot(
    options: {
        data: ArtistDiscoveryRecencyData[];
        width?: number;
        height?: number;
    }
) {
    const { data, width = 1200, height = 720 } = options;
    if (data.length === 0) return emptyState("Not enough artists in this range.");

    const pts = data.map((d) => ({
        ...d,
        first: new Date(`${d.firstDate}T00:00:00`),
        last: new Date(`${d.lastDate}T00:00:00`)
    }));

    const allDates = pts.flatMap((d) => [d.first, d.last]);
    const min = d3.min(allDates) ?? new Date();
    const max = d3.max(allDates) ?? new Date();

    return Plot.plot({
        width,
        height,
        marginLeft: 64,
        marginBottom: 48,
        marginRight: 20,
        x: { label: "Discovery →", type: "time", grid: true },
        y: { label: "↑ Last listen", type: "time", grid: true },
        r: { range: [2, 22], label: "Plays" },
        marks: [
            Plot.line(
                [
                    { x: min, y: min },
                    { x: max, y: max }
                ],
                { x: "x", y: "y", stroke: "#475569", strokeDasharray: "4 4" }
            ),
            Plot.dot(pts, {
                x: "first",
                y: "last",
                r: "plays",
                fill: ACCENT_COLOR,
                fillOpacity: 0.55,
                stroke: "#0f172a",
                strokeWidth: 0.5,
                tip: true,
                title: (d) =>
                    `${d.artist}\n` +
                    `Discovered: ${d.firstDate}\n` +
                    `Last listen: ${d.lastDate}\n` +
                    `${d.plays.toLocaleString()} plays · ${Math.round(d.minutes).toLocaleString()} min`
            })
        ],
        ...DARK_THEME
    }) as HTMLElement | SVGElement;
}

/**
 * Obsession timeline: each track is a row, ordered by the date of its most intense week.
 * Thin line = full lifespan, fat dot = peak week (size = plays that week, color = concentration).
 */
export function trackObsessionsPlot(data: TrackObsessionData[], options: any = {}) {
    if (data.length === 0) return emptyState("No obsession detected in this range.");

    const rows = data.map((d) => ({
        ...d,
        label: `${truncate(d.track, 34)} — ${truncate(d.artist, 22)}`,
        peak: new Date(`${d.peakWeek}T00:00:00`),
        first: new Date(`${d.firstWeek}T00:00:00`),
        last: new Date(`${d.lastWeek}T00:00:00`)
    }));

    const order = rows
        .slice()
        .sort((a, b) => a.peak.getTime() - b.peak.getTime())
        .map((d) => d.label);

    const width = options.width ?? 1100;
    const height = Math.max(360, rows.length * 26 + 90);

    return Plot.plot({
        width,
        height,
        marginLeft: 290,
        marginBottom: 40,
        marginRight: 64,
        x: { label: "When the obsession happened", type: "time", grid: true },
        y: { domain: order, label: null },
        r: { range: [3, 16], label: "Plays / peak week" },
        color: {
            type: "linear",
            scheme: "greens",
            domain: [0, 1],
            label: "Concentration",
            legend: true
        },
        marks: [
            Plot.link(rows, {
                x1: "first",
                x2: "last",
                y1: "label",
                y2: "label",
                stroke: "#334155",
                strokeWidth: 2
            }),
            Plot.dot(rows, {
                x: "peak",
                y: "label",
                r: "peakWeekPlays",
                fill: "concentration",
                stroke: "#0f172a",
                strokeWidth: 0.5,
                tip: true,
                title: (d) =>
                    `${d.track} — ${d.artist}\n` +
                    `Peak: week of ${d.peakWeek} (${d.peakWeekPlays} plays)\n` +
                    `${d.totalPlays} plays total · ${(d.concentration * 100).toFixed(0)}% concentrated in that week`
            })
        ],
        ...DARK_THEME,
        ...options
    }) as HTMLElement | SVGElement;
}
