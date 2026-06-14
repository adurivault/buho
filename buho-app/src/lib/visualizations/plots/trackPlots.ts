import * as Plot from "@observablehq/plot";
import { ACCENT_COLOR, DARK_THEME } from "./common";
import type {
    TrackData,
    TrackAnalysisData
} from '$lib/data/queries/trackQueries';

/**
 * Horizontal bar chart showing top tracks by play count
 */
export function topTracksPlot(data: TrackData[], options: any = {}) {
    return Plot.plot({
        marginLeft: 180,
        marginRight: 40,
        height: Math.max(400, data.length * 32),
        x: {
            label: "Play Count →",
            grid: true
        },
        y: {
            label: null,
            domain: data.map(d => `${d.track.slice(0, 25)}${d.track.length > 25 ? '...' : ''} - ${d.artist.slice(0, 15)}`)
        },
        marks: [
            Plot.barX(data, {
                x: "plays",
                y: d => `${d.track.slice(0, 25)}${d.track.length > 25 ? '...' : ''} - ${d.artist.slice(0, 15)}`,
                fill: ACCENT_COLOR,
                sort: { y: "-x" }
            }),
            Plot.ruleX([0]),
            Plot.text(data, {
                x: "plays",
                y: d => `${d.track.slice(0, 25)}${d.track.length > 25 ? '...' : ''} - ${d.artist.slice(0, 15)}`,
                text: d => d.plays.toLocaleString(),
                dx: 5,
                textAnchor: "start",
                fill: "#e0e6ed"
            })
        ],
        ...DARK_THEME,
        ...options
    }) as HTMLElement | SVGElement;
}

export function trackAnalysisScatterPlot(
    options: {
        data: TrackAnalysisData[];
        xMetric: keyof TrackAnalysisData;
        yMetric: keyof TrackAnalysisData;
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

    function formatMetricValue(metric: keyof TrackAnalysisData, value: number): string {
        if (metric === "artistPrevalenceRate" || metric === "intentionalityRate" || metric === "skipRate") {
            return `${value.toFixed(1)}%`;
        }
        if (metric === "recencyDays") return `${value.toFixed(1)} d`;
        return value.toLocaleString();
    }

    return Plot.plot({
        width,
        marginLeft: 70,
        marginRight: 20,
        marginBottom: 48,
        height,
        x: {
            label: `${xLabel} →`,
            grid: true
        },
        y: {
            label: `↑ ${yLabel}`,
            grid: true
        },
        marks: [
            Plot.dot(data, {
                x: d => Number(d[xMetric] as number),
                y: d => Number(d[yMetric] as number),
                r: 4.1,
                fill: ACCENT_COLOR,
                fillOpacity: 0.72,
                stroke: "#0f172a",
                strokeWidth: 0.7,
                tip: true,
                title: d =>
                    `${d.track} — ${d.artist}\n${xLabel}: ${formatMetricValue(xMetric, Number(d[xMetric] as number))}\n${yLabel}: ${formatMetricValue(yMetric, Number(d[yMetric] as number))}`
            }),
            Plot.ruleX([0]),
            Plot.ruleY([0])
        ],
        ...DARK_THEME
    }) as HTMLElement | SVGElement;
}
