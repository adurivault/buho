import * as Plot from "@observablehq/plot";
import { ACCENT_COLOR, DARK_THEME, ridgelinePlot } from "./common";
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
    return ridgelinePlot(
        data.map((d) => ({ key: d.artist, month: d.month, value: d.hours })),
        {
            emptyMessage: "No artist data in this range.",
            title: (row) => `${row.key} · ${row.month} · ${row.value.toFixed(1)} h`,
            ...options
        }
    );
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
                fill: "currentColor"
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
    // De-emphasised series ride on the page's own colour, so they read as muted
    // against a dark background and a light one alike; a fixed grey only ever
    // suits one of the two.
    const mutedStroke = "currentColor";
    const mutedDot = "currentColor";

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
            stroke: "var(--plot-background)",
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

