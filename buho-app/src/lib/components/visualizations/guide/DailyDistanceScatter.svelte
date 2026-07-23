<script lang="ts" module>
    import type { DayRecord } from "$lib/data/queries/googleMapsQueries";
    import { dayOfYearFraction } from "$lib/visualizations/dayRaceData";
    import * as d3 from "d3";

    type ScaleKind = "time" | "sqrt" | "linear";

    type Metric = {
        key: string;
        label: string;
        unit: string;
        scale: ScaleKind;
        clock?: boolean; // value is a fractional hour of day → HH:MM formatting
        value: (d: DayRecord) => number; // number for all kinds (ms for dates)
    };

    const parseUtcDay = d3.utcParse("%Y-%m-%d");
    const dayMs = (d: DayRecord) => parseUtcDay(d.day)?.getTime() ?? NaN;
    const pad2 = (n: number) => String(n).padStart(2, "0");

    function hhmm(v: number): string {
        let h = Math.floor(v);
        let m = Math.round((v - h) * 60);
        if (m === 60) { h += 1; m = 0; }
        return `${pad2(h)}:${pad2(m)}`;
    }

    // Axis metrics. `scale` picks the transform: `time` for the date, `sqrt` for
    // the heavily right-skewed magnitudes, `linear` for small counts and clocks.
    const METRICS: Metric[] = [
        { key: "date", label: "Date", unit: "", scale: "time", value: dayMs },
        { key: "km", label: "Distance travelled", unit: "km", scale: "sqrt", value: (d) => d.kmTraveled },
        { key: "maxDist", label: "Max distance from start", unit: "km", scale: "sqrt", value: (d) => d.maxDistFromStartKm },
        { key: "speed", label: "Average speed", unit: "km/h", scale: "linear", value: (d) => (d.movingMinutes > 0 ? d.kmTraveled / (d.movingMinutes / 60) : NaN) },
        { key: "departure", label: "Departure time", unit: "", scale: "linear", clock: true, value: (d) => d.departureHour ?? NaN },
        { key: "return", label: "Return time", unit: "", scale: "linear", clock: true, value: (d) => d.returnHour ?? NaN },
        { key: "amplitude", label: "Time out", unit: "h", scale: "linear", value: (d) => d.amplitudeHours ?? NaN },
        { key: "discovered", label: "New place today", unit: "", scale: "linear", value: (d) => (d.discoveredNew ? 1 : 0) },
        { key: "places", label: "Distinct places", unit: "", scale: "linear", value: (d) => d.distinctPlaces },
        { key: "visits", label: "Visits", unit: "", scale: "linear", value: (d) => d.visitCount },
        { key: "moving", label: "Time moving", unit: "min", scale: "sqrt", value: (d) => d.movingMinutes },
        { key: "stationary", label: "Time stationary", unit: "min", scale: "sqrt", value: (d) => d.stationaryMinutes },
        { key: "segments", label: "Segments", unit: "", scale: "linear", value: (d) => d.segmentCount },
    ];

    const fmtValue = (m: Metric, v: number): string =>
        m.scale === "time"
            ? d3.utcFormat("%d %b %Y")(new Date(v))
            : m.clock
              ? hhmm(v)
              : `${Math.round(v).toLocaleString()}${m.unit ? " " + m.unit : ""}`;

    const axisTitle = (m: Metric): string =>
        m.unit ? `${m.label} (${m.unit}) →` : `${m.label} →`;

    // Colour-by options and their palettes.
    const COLOR_OPTIONS = [
        { key: "city", label: "Start city" },
        { key: "wecat", label: "Weekday / weekend" },
        { key: "date", label: "Date" },
        { key: "doy", label: "Day of year" },
    ];
    const WEEKDAY_COLOR = "#7dd3fc"; // sky-300
    const WEEKEND_COLOR = "#f9a8d4"; // pink-300
    // Date & day-of-year reuse the DayRaceMap colour scale (d3 Turbo).
    const seqInterp = d3.interpolateTurbo;

    const isWeekend = (d: DayRecord) => {
        const dt = parseUtcDay(d.day);
        const wd = dt ? dt.getUTCDay() : -1;
        return wd === 0 || wd === 6;
    };

    type Coloring = {
        kind: "cat" | "seq";
        fill: (d: DayRecord) => string;
        items?: { label: string; color: string }[];
        stops?: string[];
        ticks?: { at: number; label: string }[];
    };
</script>

<script lang="ts">
    import { RACE_PALETTE } from "$lib/visualizations/racePalette";

    let { data, width = 960 }: { data: DayRecord[]; width?: number } = $props();

    const OTHER = "#9ca3af"; // gray-400 — the folded "Other" city bucket
    const TOP_N = 8;
    const DUR = 750; // metric-switch transition (ms)
    const R = 2.6; // dot radius — deliberately small / minimal
    const height = 460;
    const margin = { top: 12, right: 18, bottom: 44, left: 54 };

    let xKey = $state("km");
    let yKey = $state("maxDist");
    let colorBy = $state("city");
    const xMetric = $derived(METRICS.find((m) => m.key === xKey)!);
    const yMetric = $derived(METRICS.find((m) => m.key === yKey)!);

    let svgEl: SVGSVGElement;
    let plotEl: HTMLDivElement;
    let tooltipEl: HTMLDivElement;
    let plotW = $state(0);

    const W = $derived(plotW || width);
    const innerW = $derived(W - margin.left - margin.right);
    const innerH = height - margin.top - margin.bottom;

    const coloring = $derived.by<Coloring>(() => {
        if (colorBy === "wecat") {
            return {
                kind: "cat",
                fill: (d) => (isWeekend(d) ? WEEKEND_COLOR : WEEKDAY_COLOR),
                items: [
                    { label: "Weekday", color: WEEKDAY_COLOR },
                    { label: "Weekend", color: WEEKEND_COLOR },
                ],
            };
        }
        if (colorBy === "date") {
            const [a, b] = d3.extent(data, dayMs) as [number, number];
            const t = d3.scaleLinear().domain([a ?? 0, b ?? 1]).range([0, 1]);
            const mf = d3.utcFormat("%b %Y");
            return {
                kind: "seq",
                fill: (d) => seqInterp(t(dayMs(d))),
                stops: d3.range(0, 1.0001, 0.2).map((s) => seqInterp(s)),
                ticks: [
                    { at: 0, label: a ? mf(new Date(a)) : "" },
                    { at: 1, label: b ? mf(new Date(b)) : "" },
                ],
            };
        }
        if (colorBy === "doy") {
            return {
                kind: "seq",
                fill: (d) => seqInterp(dayOfYearFraction(d.day)),
                stops: d3.range(0, 1.0001, 0.1).map((s) => seqInterp(s)),
                ticks: [
                    { at: 0, label: "Jan" },
                    { at: 0.25, label: "Apr" },
                    { at: 0.5, label: "Jul" },
                    { at: 0.75, label: "Oct" },
                ],
            };
        }
        // Default: start city — top cities by day count, rest folded into "Other".
        const counts = d3.rollup(
            data.filter((d) => d.startCity && d.startCity !== "Unknown"),
            (v) => v.length,
            (d) => d.startCity,
        );
        const top = new Set(
            [...counts.entries()].sort((p, q) => q[1] - p[1]).slice(0, TOP_N).map(([c]) => c),
        );
        const scale = d3.scaleOrdinal<string, string>().domain([...top]).range(RACE_PALETTE).unknown(OTHER);
        return {
            kind: "cat",
            fill: (d) => (top.has(d.startCity) ? scale(d.startCity) : OTHER),
            items: [
                ...[...top].map((c) => ({ label: c, color: scale(c) })),
                { label: "Other", color: OTHER },
            ],
        };
    });

    function makeScale(m: Metric, range: [number, number]) {
        if (m.scale === "time") {
            const [a, b] = d3.extent(data, m.value) as [number, number];
            return d3.scaleUtc().domain([a ?? 0, b ?? 1]).nice().range(range);
        }
        const max = d3.max(data, m.value) ?? 1;
        const base = m.scale === "sqrt" ? d3.scaleSqrt() : d3.scaleLinear();
        return base.domain([0, max || 1]).nice().range(range);
    }

    function styleAxis(
        sel: d3.Selection<SVGGElement, unknown, null, undefined>,
        grid: boolean,
    ) {
        sel.select(".domain").remove();
        sel.selectAll<SVGLineElement, unknown>(".tick line")
            .attr("stroke", "currentColor")
            .attr("stroke-opacity", grid ? 0.1 : 0);
        sel.selectAll<SVGTextElement, unknown>("text")
            .attr("fill", "currentColor")
            .attr("opacity", 0.55)
            .attr("font-size", 11);
    }

    let built = false;
    let gDots: d3.Selection<SVGGElement, unknown, null, undefined>;
    let gx: d3.Selection<SVGGElement, unknown, null, undefined>;
    let gy: d3.Selection<SVGGElement, unknown, null, undefined>;
    let xLabel: d3.Selection<SVGTextElement, unknown, null, undefined>;
    let yLabel: d3.Selection<SVGTextElement, unknown, null, undefined>;

    function build() {
        const root = d3
            .select(svgEl)
            .attr("width", "100%")
            .attr("height", height)
            .append("g")
            .attr("transform", `translate(${margin.left},${margin.top})`);
        gy = root.append("g").attr("class", "y-axis");
        gx = root.append("g").attr("class", "x-axis").attr("transform", `translate(0,${innerH})`);
        gDots = root.append("g").attr("class", "dots");
        xLabel = root
            .append("text")
            .attr("y", innerH + 38)
            .attr("text-anchor", "end")
            .attr("fill", "currentColor")
            .attr("opacity", 0.5)
            .attr("font-size", 11);
        yLabel = root
            .append("text")
            .attr("transform", "rotate(-90)")
            .attr("x", 0)
            .attr("y", -42)
            .attr("text-anchor", "end")
            .attr("fill", "currentColor")
            .attr("opacity", 0.5)
            .attr("font-size", 11);
        built = true;
    }

    $effect(() => {
        if (!svgEl || innerW <= 0) return;
        if (!built) build();

        const xm = xMetric;
        const ym = yMetric;
        const paint = coloring.fill;
        const tip = d3.select(tooltipEl);
        const rows = data.filter(
            (d) => Number.isFinite(xm.value(d)) && Number.isFinite(ym.value(d)),
        );

        d3.select(svgEl).attr("viewBox", `0 0 ${W} ${height}`);

        const x = makeScale(xm, [0, innerW]);
        const y = makeScale(ym, [innerH, 0]);
        const xVal = (d: DayRecord) => x(xm.value(d) as never);
        const yVal = (d: DayRecord) => y(ym.value(d) as never);

        const ease = d3.easeCubicInOut;
        const xAxis = d3.axisBottom(x).ticks(7).tickSize(0);
        const yAxis = d3.axisLeft(y).ticks(5).tickSize(-innerW);
        if (xm.clock) xAxis.tickFormat((v) => hhmm(+v));
        if (ym.clock) yAxis.tickFormat((v) => hhmm(+v));
        gx.transition().duration(DUR).ease(ease).call(xAxis as never);
        gy.transition().duration(DUR).ease(ease).call(yAxis as never);
        gx.call((s) => styleAxis(s, false));
        gy.call((s) => styleAxis(s, true));

        xLabel.attr("x", innerW).text(axisTitle(xm));
        yLabel.text(axisTitle(ym));

        function showTip(event: MouseEvent, d: DayRecord) {
            tip.style("opacity", "1").html(
                `<b>${d.day}</b><br>${
                    d.startCity !== "Unknown" ? d.startCity : "unknown start"
                }<br>${xm.label}: ${fmtValue(xm, xm.value(d))}<br>${ym.label}: ${fmtValue(ym, ym.value(d))}`,
            );
            tip.style("left", `${event.offsetX + 12}px`).style("top", `${event.offsetY + 12}px`);
        }

        gDots
            .selectAll<SVGCircleElement, DayRecord>("circle")
            .data(rows, (d) => d.day)
            .join(
                (enter) =>
                    enter
                        .append("circle")
                        .attr("cx", xVal)
                        .attr("cy", yVal)
                        .attr("r", 0)
                        .attr("fill", paint)
                        .attr("fill-opacity", 0.6)
                        .call((e) => e.transition().duration(DUR).ease(ease).attr("r", R)),
                (update) =>
                    update.call((u) =>
                        u
                            .transition()
                            .duration(DUR)
                            .ease(ease)
                            .attr("cx", xVal)
                            .attr("cy", yVal)
                            .attr("fill", paint),
                    ),
                (exit) => exit.call((e) => e.transition().duration(DUR / 2).attr("r", 0).remove()),
            )
            .on("mouseenter", function (event, d) {
                d3.select(this)
                    .raise()
                    .interrupt()
                    .transition()
                    .duration(120)
                    .attr("r", R * 2.4)
                    .attr("fill-opacity", 1);
                showTip(event, d);
            })
            .on("mousemove", function (event, d) {
                showTip(event, d);
            })
            .on("mouseleave", function () {
                d3.select(this)
                    .interrupt()
                    .transition()
                    .duration(160)
                    .attr("r", R)
                    .attr("fill-opacity", 0.6);
                tip.style("opacity", "0");
            });
    });
</script>

<div class="scatter">
    <div class="controls">
        <label>
            <span>X</span>
            <select bind:value={xKey}>
                {#each METRICS as m (m.key)}
                    <option value={m.key}>{m.label}</option>
                {/each}
            </select>
        </label>
        <label>
            <span>Y</span>
            <select bind:value={yKey}>
                {#each METRICS as m (m.key)}
                    <option value={m.key}>{m.label}</option>
                {/each}
            </select>
        </label>
        <label>
            <span>Colour</span>
            <select bind:value={colorBy}>
                {#each COLOR_OPTIONS as c (c.key)}
                    <option value={c.key}>{c.label}</option>
                {/each}
            </select>
        </label>
    </div>

    <div class="plot" bind:this={plotEl} bind:clientWidth={plotW}>
        <svg
            bind:this={svgEl}
            aria-label="Daily mobility scatterplot with selectable axes and colour"
        ></svg>
        <div bind:this={tooltipEl} class="tip"></div>
    </div>

    <div class="legend">
        {#if coloring.kind === "cat"}
            {#each coloring.items ?? [] as item (item.label)}
                <span class="item">
                    <span class="dot" style:background={item.color}></span>
                    {item.label}
                </span>
            {/each}
        {:else}
            <div class="seq">
                <span
                    class="grad"
                    style:background="linear-gradient(90deg, {(coloring.stops ?? []).join(',')})"
                ></span>
                <div class="seq-ticks">
                    {#each coloring.ticks ?? [] as t (t.at)}
                        <span style:left="{t.at * 100}%">{t.label}</span>
                    {/each}
                </div>
            </div>
        {/if}
    </div>
</div>

<style>
    .scatter {
        color: hsl(var(--foreground));
    }
    .controls {
        display: flex;
        flex-wrap: wrap;
        gap: 1rem;
        margin-bottom: 0.75rem;
    }
    .controls label {
        display: inline-flex;
        align-items: center;
        gap: 0.4rem;
        font-size: 0.75rem;
        color: hsl(var(--muted-foreground));
    }
    .controls span {
        text-transform: uppercase;
        letter-spacing: 0.05em;
        font-size: 0.68rem;
    }
    .controls select {
        background: hsl(var(--secondary) / 0.4);
        color: hsl(var(--foreground));
        border: 1px solid hsl(var(--border));
        border-radius: 0.4rem;
        padding: 0.25rem 0.5rem;
        font-size: 0.78rem;
        cursor: pointer;
    }
    .controls select:focus-visible {
        outline: 2px solid hsl(var(--ring, var(--foreground)));
        outline-offset: 1px;
    }
    .plot {
        position: relative;
    }
    .plot svg {
        display: block;
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
        line-height: 1.35;
        white-space: nowrap;
        box-shadow: 0 2px 8px rgb(0 0 0 / 0.25);
        z-index: 10;
        transition: opacity 0.12s;
    }
    .legend {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 0.35rem 0.9rem;
        margin-top: 0.75rem;
        font-size: 0.75rem;
        color: hsl(var(--muted-foreground));
    }
    .legend .item {
        display: inline-flex;
        align-items: center;
        gap: 0.35rem;
    }
    .legend .dot {
        width: 10px;
        height: 10px;
        border-radius: 50%;
        display: inline-block;
    }
    .seq {
        width: 220px;
    }
    .seq .grad {
        display: block;
        height: 10px;
        border-radius: 3px;
    }
    .seq-ticks {
        position: relative;
        height: 1rem;
        margin-top: 2px;
    }
    .seq-ticks span {
        position: absolute;
        transform: translateX(-50%);
        white-space: nowrap;
        font-size: 0.68rem;
    }
    .seq-ticks span:first-child {
        transform: none;
    }
    .seq-ticks span:last-child {
        transform: translateX(-100%);
    }
</style>
