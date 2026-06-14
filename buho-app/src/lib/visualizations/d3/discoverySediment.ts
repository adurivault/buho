import * as d3 from "d3";
import type { MonthlyCohortPoint } from "$lib/data/queries/discoveryQueries";

/**
 * Discovery "sediment" chart, in hand-rolled D3 (replaces the Observable Plot version so we have
 * full control over the SVG for future tweaks).
 *
 * - One stacked column per month; within a column, layers are ordered by discovery cohort, oldest
 *   at the bottom (sediment). No interpolation between months → crisp columns, no sawtooth.
 * - Each layer is coloured by its age relative to the playhead (`nowTime`): light yellow when just
 *   discovered, dark brown once old. As the playhead advances the whole past browns.
 * - Axes grow with the playhead on x (the visible window expands month by month) and stay pinned on
 *   y (the tallest monthly column), so the chart reads like a bar-chart race building up.
 *
 * The factory builds the SVG / scales / legend / tooltip once; `update()` redraws via data-joins,
 * so calling it every animation frame is cheap.
 */

const AGE_RAMP = ["#f7e8b0", "#d9a441", "#b07a32", "#7a4a1e", "#3b2410"]; // fresh → old
const DAY_MS = 86_400_000;
const HEIGHT = 380;
const MARGIN = { top: 56, right: 20, bottom: 34, left: 56 };
const LEGEND_WIDTH = 220;
const TEXT_COLOR = "#e0e6ed";
const GRID_COLOR = "rgba(255,255,255,0.08)";

const ageInterp = d3.interpolateRgbBasis(AGE_RAMP);

function formatAgeDays(days: number): string {
    if (days < 1) return "0";
    if (days < 60) return `${Math.round(days)} j`;
    if (days < 365) return `${Math.round(days / 30)} mois`;
    const years = days / 365;
    return `${years.toFixed(years < 10 ? 1 : 0)} ans`;
}

function styleAxis(g: d3.Selection<SVGGElement, unknown, null, undefined>) {
    g.selectAll("text").attr("fill", TEXT_COLOR).attr("font-size", "11px");
    g.selectAll("line").attr("stroke", GRID_COLOR);
    g.select(".domain").attr("stroke", GRID_COLOR);
}

/**
 * - `discovery`: colour = discovery date, over the revealed window [oldest discovery, playhead].
 *   The scale (and legend) grows with the playhead; oldest = brown, freshest = yellow.
 * - `age`: colour = the track's age at the moment it was played (play month − discovery), on a
 *   fixed age scale; just-discovered = yellow, long-owned = brown.
 */
export type SedimentColorMode = "discovery" | "age";

export interface SedimentUpdateOptions {
    width: number;
    nowTime?: number | null;
    colorMode?: SedimentColorMode;
}

export interface SedimentChart {
    update(data: MonthlyCohortPoint[], options: SedimentUpdateOptions): void;
    destroy(): void;
}

export function createDiscoverySediment(container: HTMLElement): SedimentChart {
    container.style.position = "relative";

    const svg = d3
        .select(container)
        .append("svg")
        .attr("height", HEIGHT)
        .style("display", "block")
        .style("max-width", "100%")
        .style("font-family", "Inter, system-ui, sans-serif");

    // Two horizontal gradients (unique ids so instances don't collide). The legends read left→right:
    // the date legend runs old→recent (brown→yellow); the age legend runs fresh→old (yellow→brown).
    const defs = svg.append("defs");
    const suffix = Math.random().toString(36).slice(2);
    const gradDateId = `grad-date-${suffix}`;
    const gradAgeId = `grad-age-${suffix}`;
    const buildGradient = (id: string, colorAt: (t: number) => string) => {
        const g = defs
            .append("linearGradient")
            .attr("id", id)
            .attr("x1", "0%")
            .attr("x2", "100%");
        d3.range(0, 1.0001, 0.1).forEach((t) => {
            g.append("stop").attr("offset", `${t * 100}%`).attr("stop-color", colorAt(t));
        });
    };
    buildGradient(gradDateId, (t) => ageInterp(1 - t)); // brown (old) → yellow (recent)
    buildGradient(gradAgeId, (t) => ageInterp(t)); // yellow (fresh) → brown (old)

    const gGrid = svg.append("g").attr("class", "y-grid");
    const gBars = svg.append("g").attr("class", "bars");
    const gX = svg.append("g").attr("class", "x-axis");
    const gY = svg.append("g").attr("class", "y-axis");
    const gLegend = svg.append("g").attr("class", "legend");

    const tip = d3
        .select(container)
        .append("div")
        .style("position", "absolute")
        .style("pointer-events", "none")
        .style("opacity", "0")
        .style("background", "#0b1220")
        .style("border", "1px solid rgba(255,255,255,0.15)")
        .style("border-radius", "6px")
        .style("padding", "6px 8px")
        .style("font-size", "12px")
        .style("line-height", "1.35")
        .style("color", TEXT_COLOR)
        .style("white-space", "pre")
        .style("transform", "translate(-50%, calc(-100% - 12px))")
        .style("transition", "opacity 0.1s")
        .style("z-index", "10");

    function clearMarks() {
        gBars.selectAll("*").remove();
        gX.selectAll("*").remove();
        gY.selectAll("*").remove();
        gGrid.selectAll("*").remove();
        gLegend.selectAll("*").remove();
    }

    function update(data: MonthlyCohortPoint[], opts: SedimentUpdateOptions) {
        const width = Math.max(320, Math.floor(opts.width));
        svg.attr("width", width);

        if (!data.length) {
            clearMarks();
            tip.style("opacity", "0");
            return;
        }

        const plotLeft = MARGIN.left;
        const plotRight = width - MARGIN.right;
        const plotTop = MARGIN.top;
        const plotBottom = HEIGHT - MARGIN.bottom;

        const rows = data.map((d) => ({
            monthTime: new Date(`${d.month}T00:00:00`).getTime(),
            cohortTime: new Date(`${d.cohort}T00:00:00`).getTime(),
            plays: d.plays,
        }));

        const firstMonth = d3.min(rows, (r) => r.monthTime) ?? 0;
        const lastMonth = d3.max(rows, (r) => r.monthTime) ?? 1;
        const minCohort = d3.min(rows, (r) => r.cohortTime) ?? firstMonth;
        const maxMonthlyPlays =
            d3.max(
                d3.rollup(rows, (v) => d3.sum(v, (r) => r.plays), (r) => r.monthTime).values()
            ) ?? 1;

        const mode: SedimentColorMode = opts.colorMode ?? "discovery";

        // Playhead: clamp to range, default to the end (settled full chart).
        const now = Math.min(lastMonth, Math.max(firstMonth, opts.nowTime ?? lastMonth));

        // `discovery`: colour = discovery date over the revealed window [oldest discovery, now],
        // which grows with the playhead (oldest = brown, freshest = yellow).
        // `age`: colour = the track's age when played (play month − discovery) on a fixed scale
        // (just-discovered = yellow, long-owned = brown).
        const span = Math.max(DAY_MS, now - minCohort);
        const maxAgeDays = Math.max(1, (d3.max(rows, (r) => r.monthTime - r.cohortTime) ?? 0) / DAY_MS);
        const colorOf = (s: { monthTime: number; cohortTime: number }) =>
            mode === "age"
                ? ageInterp(Math.min(1, (s.monthTime - s.cohortTime) / DAY_MS / maxAgeDays))
                : ageInterp(Math.min(1, Math.max(0, (now - s.cohortTime) / span)));

        // Build stacked segments for the visible months (oldest cohort at the bottom).
        type Seg = {
            monthTime: number;
            cohortTime: number;
            y0: number;
            y1: number;
            plays: number;
        };
        const segments: Seg[] = [];
        const byMonth = d3.group(
            rows.filter((r) => r.monthTime <= now),
            (r) => r.monthTime
        );
        for (const [monthTime, list] of byMonth) {
            list.sort((a, b) => a.cohortTime - b.cohortTime); // oldest first → bottom
            let acc = 0;
            for (const r of list) {
                const y0 = acc;
                acc += r.plays;
                segments.push({
                    monthTime,
                    cohortTime: r.cohortTime,
                    y0,
                    y1: acc,
                    plays: r.plays,
                });
            }
        }

        // x grows with the playhead; y is pinned to the tallest column.
        const x = d3
            .scaleTime()
            .domain([firstMonth, d3.timeMonth.offset(new Date(now), 1).getTime()])
            .range([plotLeft, plotRight]);
        const y = d3
            .scaleLinear()
            .domain([0, maxMonthlyPlays])
            .range([plotBottom, plotTop]);

        const monthWidth = (mt: number) => {
            const w = x(d3.timeMonth.offset(new Date(mt), 1).getTime()) - x(mt);
            return Math.max(0.5, w - 0.5);
        };

        // Grid (horizontal lines).
        gGrid
            .attr("transform", `translate(${plotLeft},0)`)
            .call(
                d3
                    .axisLeft(y)
                    .ticks(5)
                    .tickSize(-(plotRight - plotLeft))
                    .tickFormat(() => "") as any
            );
        gGrid.select(".domain").remove();
        gGrid.selectAll("line").attr("stroke", GRID_COLOR);

        // Axes.
        gX.attr("transform", `translate(0,${plotBottom})`).call(
            d3.axisBottom(x).ticks(Math.max(2, Math.floor(width / 120))) as any
        );
        styleAxis(gX as any);
        gY.attr("transform", `translate(${plotLeft},0)`).call(
            d3.axisLeft(y).ticks(5).tickFormat(d3.format("~s")) as any
        );
        styleAxis(gY as any);

        // Bars (one rect per cohort layer), keyed so joins are stable across frames.
        gBars
            .selectAll<SVGRectElement, Seg>("rect")
            .data(segments, (d) => `${d.monthTime}:${d.cohortTime}`)
            .join("rect")
            .attr("x", (d) => x(d.monthTime))
            .attr("width", (d) => monthWidth(d.monthTime))
            .attr("y", (d) => y(d.y1))
            .attr("height", (d) => Math.max(0, y(d.y0) - y(d.y1)))
            .attr("fill", (d) => colorOf(d))
            .attr("stroke", (d) => colorOf(d)) // same colour → hides seams
            .attr("stroke-width", 1)
            .on("mousemove", (event: MouseEvent, d) => {
                const [mx, my] = d3.pointer(event, container);
                const monthLabel = new Date(d.monthTime).toLocaleDateString("fr-FR", {
                    year: "numeric",
                    month: "long",
                });
                const cohortLabel = new Date(d.cohortTime).toLocaleDateString("fr-FR", {
                    year: "numeric",
                    month: "long",
                });
                const ageLabel = formatAgeDays((d.monthTime - d.cohortTime) / DAY_MS);
                tip.style("left", `${mx}px`)
                    .style("top", `${my}px`)
                    .style("opacity", "1")
                    .text(
                        `${monthLabel}\n` +
                            `Découvert en ${cohortLabel} (il y a ${ageLabel})\n` +
                            `${d.plays.toLocaleString()} écoutes`
                    );
            })
            .on("mouseleave", () => tip.style("opacity", "0"));

        // Legend depends on the colour mode.
        gLegend.selectAll("*").remove();
        gLegend.attr("transform", `translate(${plotLeft},14)`);
        gLegend
            .append("text")
            .attr("y", 0)
            .attr("fill", TEXT_COLOR)
            .attr("font-size", "11px")
            .text(
                mode === "age"
                    ? "Ancienneté du morceau au moment de l'écoute"
                    : "Date de découverte du morceau"
            );
        gLegend
            .append("rect")
            .attr("y", 8)
            .attr("width", LEGEND_WIDTH)
            .attr("height", 8)
            .attr("rx", 2)
            .attr("fill", `url(#${mode === "age" ? gradAgeId : gradDateId})`);

        let legendAxisGen: d3.Axis<d3.NumberValue>;
        if (mode === "age") {
            // Fixed age axis: 0 (just discovered) → maxAge (long-owned).
            const ageScale = d3.scaleLinear().domain([0, maxAgeDays]).range([0, LEGEND_WIDTH]);
            legendAxisGen = d3
                .axisBottom(ageScale)
                .ticks(4)
                .tickSize(3)
                .tickFormat((d) => formatAgeDays(d as number));
        } else {
            // Date axis over [oldest discovery, playhead], growing with the animation.
            const legendEnd = Math.max(now, minCohort + DAY_MS);
            const wideSpan = legendEnd - minCohort > 2 * 365 * DAY_MS;
            const dateScale = d3.scaleTime().domain([minCohort, legendEnd]).range([0, LEGEND_WIDTH]);
            legendAxisGen = d3
                .axisBottom(dateScale)
                .ticks(3)
                .tickSize(3)
                .tickFormat(((d: Date) =>
                    d.toLocaleDateString(
                        "fr-FR",
                        wideSpan ? { year: "numeric" } : { year: "numeric", month: "short" }
                    )) as any) as unknown as d3.Axis<d3.NumberValue>;
        }
        const legendAxis = gLegend
            .append("g")
            .attr("transform", "translate(0,16)")
            .call(legendAxisGen as any);
        legendAxis.select(".domain").remove();
        legendAxis.selectAll("text").attr("fill", TEXT_COLOR).attr("font-size", "10px");
        legendAxis.selectAll("line").attr("stroke", GRID_COLOR);
    }

    function destroy() {
        svg.remove();
        tip.remove();
    }

    return { update, destroy };
}
