import * as Plot from "@observablehq/plot";
import * as d3 from "d3";
import { ACCENT_COLOR, DARK_THEME } from "./common";
import type {
    ArtistData,
    ArtistMonthlyAlignedData,
    ArtistAnalysisData,
    ArtistMonthlyDurationData
} from '$lib/data/queries/artistQueries';

/**
 * Ridgeline / joyplot: each top artist gets an overlapping density ridge of monthly
 * listening hours, ordered top-to-bottom by when you first discovered them.
 */
export function artistRidgelinePlot(data: ArtistMonthlyDurationData[], options: any = {}) {
    if (data.length === 0) {
        const root = document.createElement("div");
        root.style.cssText =
            "display:flex;align-items:center;justify-content:center;min-height:320px;opacity:0.6";
        root.textContent = "Pas de données d'artistes sur cette plage.";
        return root as HTMLElement | SVGElement;
    }

    // First active month per artist → discovery order (earliest at the top).
    const firstMonth = new Map<string, string>();
    for (const d of data) {
        if (d.hours <= 0) continue;
        const current = firstMonth.get(d.artist);
        if (current === undefined || d.month < current) firstMonth.set(d.artist, d.month);
    }

    const order = Array.from(firstMonth.keys()).sort((a, b) => {
        const fa = firstMonth.get(a) as string;
        const fb = firstMonth.get(b) as string;
        return fa < fb ? -1 : fa > fb ? 1 : a.localeCompare(b);
    });

    const n = order.length;
    const indexOf = new Map(order.map((artist, i) => [artist, i]));
    const maxHours = d3.max(data, (d) => d.hours) ?? 1;

    const step = 20; // vertical px per artist row
    const amp = step * 2.5; // ridge height (> step ⇒ overlap into the row above)
    const marginTop = 56; // room for the tallest ridge to overflow upward
    const marginBottom = 40;
    const innerHeight = n * step;
    const width = options.width ?? 1100;
    const height = marginTop + marginBottom + innerHeight;

    // Manual pixel placement: ridges and labels share one identity y-scale (value = px
    // from the top of the inner area), so baselines line up exactly with the names.
    const baselineOf = (i: number) => i * step + step / 2;

    const rows = data
        .filter((d) => indexOf.has(d.artist))
        .map((d) => {
            const base = baselineOf(indexOf.get(d.artist) as number);
            return {
                artist: d.artist,
                month: new Date(`${d.month}T00:00:00`),
                yBase: base,
                yTop: base - (d.hours / maxHours) * amp,
                hours: d.hours
            };
        });

    const labels = order.map((artist, i) => ({ artist, y: baselineOf(i) }));

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
            Plot.ruleY(labels, { y: "y", stroke: "#1f2937", strokeWidth: 1 }),
            Plot.areaY(rows, {
                x: "month",
                y1: "yBase",
                y2: "yTop",
                z: "artist",
                fill: ACCENT_COLOR,
                fillOpacity: 0.55,
                curve: "basis"
            }),
            Plot.line(rows, {
                x: "month",
                y: "yTop",
                z: "artist",
                stroke: "#1ED760",
                strokeWidth: 1,
                curve: "basis"
            }),
            Plot.text(labels, {
                y: "y",
                text: "artist",
                frameAnchor: "left",
                textAnchor: "end",
                dx: -10,
                fill: "#cbd5e1",
                fontSize: 12
            })
        ],
        ...DARK_THEME,
        ...options
    }) as HTMLElement | SVGElement;
}

/**
 * Horizontal bar chart showing top artists by listening time
 */
export function topArtistsPlot(data: ArtistData[], options: any = {}) {
    return Plot.plot({
        marginLeft: 140,
        marginRight: 40,
        height: Math.max(400, data.length * 32),
        x: {
            label: "Minutes →",
            grid: true
        },
        y: {
            label: null,
            domain: data.map(d => d.artist)
        },
        marks: [
            Plot.barX(data, {
                x: "minutes",
                y: "artist",
                fill: ACCENT_COLOR,
                sort: { y: "-x" }
            }),
            Plot.ruleX([0]),
            Plot.text(data, {
                x: "minutes",
                y: "artist",
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

/**
 * Multi-line chart showing monthly listening minutes per top artist,
 * aligned on each artist's first listening month (month 0).
 */
export function topArtistsMonthlyAlignedPlot(data: ArtistMonthlyAlignedData[], options: any = {}) {
    const {
        highlightedArtist = null,
        width = 1200,
        ...plotOptions
    } = options as { highlightedArtist?: string | null; width?: number };

    const hasHighlight = Boolean(highlightedArtist);
    const mutedStroke = "#6b7280";
    const mutedDot = "#9ca3af";

    return Plot.plot({
        width,
        marginLeft: 70,
        marginRight: 20,
        marginBottom: 42,
        height: 420,
        x: {
            label: "Months Since First Listen (Artist-Aligned)",
            grid: true
        },
        y: {
            label: "↑ Minutes per Month",
            grid: true
        },
        marks: [
            Plot.lineY(data, {
                x: "monthIndex",
                y: "minutes",
                z: "artist",
                stroke: d =>
                    hasHighlight
                        ? d.artist === highlightedArtist
                            ? ACCENT_COLOR
                            : mutedStroke
                        : mutedStroke,
                strokeOpacity: d =>
                    hasHighlight
                        ? d.artist === highlightedArtist
                            ? 1
                            : 0.28
                        : 0.55,
                strokeWidth: d =>
                    hasHighlight
                        ? d.artist === highlightedArtist
                            ? 2.5
                            : 1.5
                        : 1.8,
                curve: "monotone-x",
                tip: true
            }),
            Plot.dot(data, {
                x: "monthIndex",
                y: "minutes",
                fill: d =>
                    hasHighlight
                        ? d.artist === highlightedArtist
                            ? ACCENT_COLOR
                            : mutedDot
                        : mutedDot,
                fillOpacity: d =>
                    hasHighlight
                        ? d.artist === highlightedArtist
                            ? 1
                            : 0.35
                        : 0.65,
                r: d =>
                    hasHighlight
                        ? d.artist === highlightedArtist
                            ? 3
                            : 2
                        : 2.25,
                tip: true
            }),
            Plot.ruleY([0])
        ],
        ...DARK_THEME,
        ...plotOptions
    }) as HTMLElement | SVGElement;
}

export function artistAnalysisScatterPlot(
    options: {
        data: ArtistAnalysisData[];
        xMetric: keyof ArtistAnalysisData;
        yMetric: keyof ArtistAnalysisData;
        xLabel?: string;
        yLabel?: string;
        width?: number;
        height?: number;
    }
) {
    const {
        data,
        xMetric,
        yMetric,
        xLabel = String(xMetric),
        yLabel = String(yMetric),
        width = 1400,
        height = 760
    } = options;

    const DATE_METRIC_KEY = "meanListenDateEpochMs";
    const isXDate = xMetric === DATE_METRIC_KEY;
    const isYDate = yMetric === DATE_METRIC_KEY;

    function formatMetricValue(metric: keyof ArtistAnalysisData, value: number): string {
        if (metric === DATE_METRIC_KEY) {
            return new Date(value).toLocaleDateString("fr-FR");
        }
        if (metric === "listenDateVarianceDays2") {
            return value.toFixed(3);
        }
        return value.toLocaleString();
    }

    const marks: any[] = [
        Plot.dot(data, {
            x: d => {
                const value = Number(d[xMetric] as number);
                return isXDate ? new Date(value) : value;
            },
            y: d => {
                const value = Number(d[yMetric] as number);
                return isYDate ? new Date(value) : value;
            },
            r: 4.5,
            fill: ACCENT_COLOR,
            fillOpacity: 0.75,
            stroke: "#0f172a",
            strokeWidth: 0.75,
            tip: true,
            title: d =>
                `${d.artist}\n${xLabel}: ${formatMetricValue(xMetric, Number(d[xMetric] as number))}\n${yLabel}: ${formatMetricValue(yMetric, Number(d[yMetric] as number))}`
        })
    ];

    if (!isXDate) marks.push(Plot.ruleX([0]));
    if (!isYDate) marks.push(Plot.ruleY([0]));

    return Plot.plot({
        width,
        marginLeft: 70,
        marginRight: 20,
        marginBottom: 48,
        height,
        x: {
            label: `${xLabel} →`,
            type: isXDate ? "time" : undefined,
            grid: true
        },
        y: {
            label: `↑ ${yLabel}`,
            type: isYDate ? "time" : undefined,
            grid: true
        },
        marks,
        ...DARK_THEME
    }) as HTMLElement | SVGElement;
}

