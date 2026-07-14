<script lang="ts">
    import * as d3 from "d3";
    import type { DayRecord } from "$lib/data/queries/googleMapsQueries";

    let { data, width = 820 }: { data: DayRecord[]; width?: number } = $props();

    let svgEl: SVGSVGElement;
    let tooltipEl: HTMLDivElement;

    // Sequential red ramp (single hue, light → dark) — km per day.
    const RAMP = ["#fee2e2", "#fca5a5", "#f87171", "#ef4444", "#b91c1c"];
    const CELL = 13; // cell pitch (px), including the 2px surface gap
    const GAP = 2;
    const cellSize = CELL - GAP;
    const margin = { top: 18, right: 16, bottom: 8, left: 34 };
    const yearGap = 28;
    const DOW = ["Mon", "", "Wed", "", "Fri", "", "Sun"];

    const parseDay = d3.utcParse("%Y-%m-%d");
    const dayKey = d3.utcFormat("%Y-%m-%d");
    // Monday-first day index (0 = Monday … 6 = Sunday).
    const dowIndex = (date: Date) => (date.getUTCDay() + 6) % 7;
    // Week column: Mondays elapsed since the year's first Monday-or-before.
    const weekIndex = (date: Date, yearStart: Date) =>
        d3.utcMonday.count(d3.utcMonday.floor(yearStart), date);

    $effect(() => {
        const rows = data;
        const svg = d3.select(svgEl);
        svg.selectAll("*").remove();
        if (!rows.length) return;

        // km lookup per day + the set of years present.
        const kmByDay = new Map<string, number>();
        for (const r of rows) kmByDay.set(r.day, r.kmTraveled);
        const dates = rows.map((r) => parseDay(r.day)!).filter(Boolean);
        const years = d3.range(
            d3.min(dates, (d) => d.getUTCFullYear())!,
            d3.max(dates, (d) => d.getUTCFullYear())! + 1,
        );

        // Threshold scale over positive km (quantile-derived buckets), so the
        // long tail of big travel days doesn't wash out ordinary ones.
        const positive = rows
            .map((r) => r.kmTraveled)
            .filter((v) => v > 0)
            .sort(d3.ascending);
        const thresholds = [0.2, 0.4, 0.6, 0.8].map(
            (q) => d3.quantileSorted(positive, q) ?? 0,
        );
        const color = d3
            .scaleThreshold<number, string>()
            .domain(thresholds)
            .range(RAMP);
        const fillOf = (km: number | undefined) =>
            km === undefined ? "empty" : km <= 0 ? "empty" : color(km);

        const yearH = 7 * CELL;
        const height =
            margin.top +
            margin.bottom +
            years.length * (yearH + yearGap) -
            yearGap;

        svg.attr("viewBox", `0 0 ${width} ${height}`)
            .attr("width", "100%")
            .attr("height", height);

        const tip = d3.select(tooltipEl);
        const fmt = d3.utcFormat("%a %d %b %Y");

        years.forEach((year, yi) => {
            const yearStart = new Date(Date.UTC(year, 0, 1));
            const gy =
                margin.top + yi * (yearH + yearGap);
            const g = svg
                .append("g")
                .attr("transform", `translate(${margin.left},${gy})`);

            // Year label.
            g.append("text")
                .attr("x", 0)
                .attr("y", -6)
                .attr("fill", "currentColor")
                .attr("font-size", 12)
                .attr("font-weight", 600)
                .attr("opacity", 0.85)
                .text(year);

            // Day-of-week labels.
            g.append("g")
                .selectAll("text")
                .data(DOW)
                .join("text")
                .attr("x", -6)
                .attr("y", (_, i) => i * CELL + cellSize / 2)
                .attr("dy", "0.32em")
                .attr("text-anchor", "end")
                .attr("fill", "currentColor")
                .attr("font-size", 9)
                .attr("opacity", 0.5)
                .text((d) => d);

            // All days of the year, with their km resolved once.
            const cells = d3
                .utcDays(yearStart, new Date(Date.UTC(year + 1, 0, 1)))
                .map((date) => ({
                    date,
                    km: kmByDay.get(dayKey(date)),
                }));

            g.append("g")
                .selectAll("rect")
                .data(cells)
                .join("rect")
                .attr("width", cellSize)
                .attr("height", cellSize)
                .attr("rx", 2)
                .attr("x", (d) => weekIndex(d.date, yearStart) * CELL)
                .attr("y", (d) => dowIndex(d.date) * CELL)
                .attr("fill", (d) => {
                    const f = fillOf(d.km);
                    return f === "empty" ? "hsl(var(--secondary))" : f;
                })
                .attr("fill-opacity", (d) =>
                    fillOf(d.km) === "empty" ? 0.5 : 1,
                )
                .on("mouseenter", (event, d) => {
                    tip.style("opacity", "1").html(
                        `<b>${fmt(d.date)}</b><br>${
                            d.km === undefined
                                ? "no tracking"
                                : `${Math.round(d.km).toLocaleString()} km`
                        }`,
                    );
                })
                .on("mousemove", (event) => {
                    tip.style("left", `${event.offsetX + 12}px`).style(
                        "top",
                        `${event.offsetY + 12}px`,
                    );
                })
                .on("mouseleave", () => tip.style("opacity", "0"));
        });
    });
</script>

<div class="cal-wrap">
    <svg bind:this={svgEl} class="cal" aria-label="Kilometres travelled per day"
    ></svg>
    <div bind:this={tooltipEl} class="tip"></div>
    <div class="legend">
        <span>Less</span>
        <span class="sw" style:background="hsl(var(--secondary))"></span>
        {#each RAMP as c (c)}
            <span class="sw" style:background={c}></span>
        {/each}
        <span>More</span>
    </div>
</div>

<style>
    .cal-wrap {
        position: relative;
        color: hsl(var(--foreground));
    }
    .cal {
        display: block;
        overflow: visible;
    }
    .tip {
        position: absolute;
        pointer-events: none;
        opacity: 0;
        background: hsl(var(--popover, var(--background)));
        color: hsl(var(--foreground));
        border: 1px solid hsl(var(--border));
        border-radius: 0.35rem;
        padding: 0.35rem 0.5rem;
        font-size: 0.75rem;
        line-height: 1.3;
        white-space: nowrap;
        box-shadow: 0 2px 8px rgb(0 0 0 / 0.25);
        z-index: 10;
    }
    .legend {
        display: flex;
        align-items: center;
        gap: 3px;
        margin-top: 0.5rem;
        font-size: 0.72rem;
        color: hsl(var(--muted-foreground));
    }
    .legend .sw {
        width: 11px;
        height: 11px;
        border-radius: 2px;
        display: inline-block;
    }
    .legend span:first-child {
        margin-right: 4px;
    }
    .legend span:last-child {
        margin-left: 4px;
    }
</style>
