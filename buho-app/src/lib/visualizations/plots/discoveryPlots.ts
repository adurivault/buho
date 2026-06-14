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
    if (data.length === 0) return emptyState("Pas assez d'artistes sur cette plage.");

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
        x: { label: "Découverte →", type: "time", grid: true },
        y: { label: "↑ Dernière écoute", type: "time", grid: true },
        r: { range: [2, 22], label: "Écoutes" },
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
                    `Découvert: ${d.firstDate}\n` +
                    `Dernière écoute: ${d.lastDate}\n` +
                    `${d.plays.toLocaleString()} écoutes · ${Math.round(d.minutes).toLocaleString()} min`
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
    if (data.length === 0) return emptyState("Aucune obsession détectée sur cette plage.");

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
        x: { label: "Quand l'obsession a eu lieu", type: "time", grid: true },
        y: { domain: order, label: null },
        r: { range: [3, 16], label: "Écoutes / semaine de pic" },
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
                    `Pic: semaine du ${d.peakWeek} (${d.peakWeekPlays} écoutes)\n` +
                    `${d.totalPlays} écoutes au total · ${(d.concentration * 100).toFixed(0)}% concentrées sur cette semaine`
            })
        ],
        ...DARK_THEME,
        ...options
    }) as HTMLElement | SVGElement;
}
