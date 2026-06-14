import * as Plot from "@observablehq/plot";
import * as d3 from "d3";
import { ACCENT_COLOR, ACCENT_SECONDARY, DARK_THEME } from "./common";
import type {
    DailyAnalysisData,
    TracklistSizePoint,
    DailyCalendarPoint
} from '$lib/data/queries/temporalQueries';
import type { WeeklyVolumePoint } from '$lib/data/queries/behaviorQueries';

const DAY_INITIALS = ["D", "L", "M", "M", "J", "V", "S"];

/**
 * GitHub-style calendar heatmap: one cell per day, faceted by year, colored by minutes listened.
 */
export function calendarHeatmapPlot(data: DailyCalendarPoint[], options: any = {}) {
    const days = data
        .filter((d) => d.minutes > 0)
        .map((d) => ({ date: new Date(`${d.date}T00:00:00Z`), minutes: d.minutes }));

    if (days.length === 0) {
        const root = document.createElement("div");
        root.style.cssText =
            "display:flex;align-items:center;justify-content:center;min-height:240px;opacity:0.6";
        root.textContent = "Pas de données dans cette plage de dates.";
        return root as HTMLElement | SVGElement;
    }

    const years = Array.from(new Set(days.map((d) => d.date.getUTCFullYear()))).sort(
        (a, b) => a - b
    );
    const width = options.width ?? 1100;

    return Plot.plot({
        width,
        height: years.length * 148 + 40,
        marginLeft: 34,
        marginRight: 12,
        padding: 0,
        x: { axis: null },
        y: {
            tickFormat: (d: number) => DAY_INITIALS[d] ?? "",
            domain: [1, 2, 3, 4, 5, 6, 0],
            tickSize: 0,
            label: null
        },
        fy: { tickFormat: (y: number) => String(y), label: null },
        color: {
            type: "sqrt",
            scheme: "greens",
            label: "Minutes / jour",
            legend: true
        },
        marks: [
            Plot.cell(days, {
                x: (d) => d3.utcWeek.count(d3.utcYear(d.date), d.date),
                y: (d) => d.date.getUTCDay(),
                fy: (d) => d.date.getUTCFullYear(),
                fill: "minutes",
                inset: 0.5,
                rx: 2,
                tip: true,
                title: (d) =>
                    `${d.date.toLocaleDateString("fr-FR", {
                        weekday: "short",
                        year: "numeric",
                        month: "long",
                        day: "numeric",
                        timeZone: "UTC"
                    })}\n${Math.round(d.minutes).toLocaleString()} min`
            })
        ],
        ...DARK_THEME,
        ...options
    }) as HTMLElement | SVGElement;
}

export function dailyAnalysisScatterPlot(
    options: {
        data: DailyAnalysisData[];
        xMetric: keyof DailyAnalysisData;
        yMetric: keyof DailyAnalysisData;
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

    const DATE_METRIC_KEY = "dateEpochMs";
    const isXDate = xMetric === DATE_METRIC_KEY;
    const isYDate = yMetric === DATE_METRIC_KEY;

    function formatMetricValue(metric: keyof DailyAnalysisData, value: number): string {
        if (metric === DATE_METRIC_KEY) return new Date(value).toLocaleDateString("fr-FR");
        if (metric === "meanListenHour") return `${value.toFixed(2)}h`;
        if (metric === "repeatIntensity") return value.toFixed(3);
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
            r: 4.2,
            fill: ACCENT_SECONDARY,
            fillOpacity: 0.75,
            stroke: "#0f172a",
            strokeWidth: 0.75,
            tip: true,
            title: d =>
                `${d.date}\n${xLabel}: ${formatMetricValue(xMetric, Number(d[xMetric] as number))}\n${yLabel}: ${formatMetricValue(yMetric, Number(d[yMetric] as number))}`
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

export function tracklistSizeOverTimePlot(data: TracklistSizePoint[], options: any = {}) {
    const timeline = data.map(d => ({
        ...d,
        dateObj: new Date(d.date)
    }));

    return Plot.plot({
        marginLeft: 60,
        marginBottom: 44,
        height: 360,
        x: {
            label: "Date",
            type: "time",
            grid: true
        },
        y: {
            label: "↑ Tracklist size",
            grid: true
        },
        marks: [
            Plot.lineY(timeline, {
                x: "dateObj",
                y: "tracklistSize",
                stroke: ACCENT_COLOR,
                strokeWidth: 2.4,
                curve: "linear"
            }),
            Plot.dot(timeline, {
                x: "dateObj",
                y: "tracklistSize",
                r: 2.2,
                fill: ACCENT_SECONDARY,
                tip: true,
                title: d => `${d.date}\nTracklist size: ${d.tracklistSize.toLocaleString()}`
            }),
            Plot.ruleY([0])
        ],
        ...DARK_THEME,
        ...options
    }) as HTMLElement | SVGElement;
}

export function explorerTemporalBarsPlot(
    data: WeeklyVolumePoint[],
    options: { timeDomain?: [number, number] | null } = {}
) {
    const bars = data.map((d) => ({
        ...d,
        weekDate: new Date(d.weekStartMs)
    }));

    const domain =
        options.timeDomain && Number.isFinite(options.timeDomain[0]) && Number.isFinite(options.timeDomain[1])
            ? [new Date(options.timeDomain[0]), new Date(options.timeDomain[1])]
            : undefined;

    return Plot.plot({
        marginLeft: 48,
        marginBottom: 40,
        marginRight: 16,
        height: 240,
        x: {
            type: 'time',
            label: 'Week',
            grid: true,
            domain
        },
        y: {
            label: '↑ Plays',
            grid: true
        },
        marks: [
            Plot.barY(bars, {
                x: 'weekDate',
                y: 'plays',
                fill: ACCENT_COLOR,
                inset: 0.6,
                tip: true,
                title: (d) => `${d.weekStart}\n${d.plays.toLocaleString()} plays`
            }),
            Plot.ruleY([0])
        ],
        ...DARK_THEME
    }) as HTMLElement | SVGElement;
}
