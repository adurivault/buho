<script lang="ts" module>
    export type RaceRow = {
        month: string; // 'YYYY-MM-DD' (month bucket)
        name: string;
        value: number;
    };
</script>

<script lang="ts">
    import * as d3 from "d3";
    import { RACE_PALETTE } from "$lib/visualizations/racePalette";
    import { onMount } from "svelte";

    type Props = {
        title: string;
        rows: RaceRow[];
        formatValue?: (v: number) => string;
        // Applied to bar labels only (join keys stay the full name), e.g. to
        // truncate long track titles.
        formatName?: (name: string) => string;
        ariaLabel?: string;
        loadingLabel?: string;
        topN?: number;
        // Space reserved for bar labels on the left (px).
        leftMargin?: number;
        // Lower bound on the drawn chart width (px).
        minWidth?: number;
        // Fired once when the section scrolls into view, so parents can lazy-load.
        onVisible?: () => void;
    };

    let {
        title,
        rows,
        formatValue = (v: number) => v.toFixed(1),
        formatName = (name: string) => name,
        ariaLabel = "Bar chart race",
        loadingLabel = "Loading…",
        topN = 15,
        leftMargin = 220,
        minWidth = 920,
        onVisible,
    }: Props = $props();

    type RankedItem = {
        name: string;
        value: number;
        rank: number;
    };

    type RaceKeyframe = {
        date: Date;
        items: RankedItem[];
    };

    const INTERPOLATION_STEPS = 10;
    const FRAME_DURATION_MS = 120;
    const BAR_SIZE = 36;
    const MARGIN = $derived({ top: 24, right: 90, bottom: 16, left: leftMargin });

    let element = $state<HTMLElement | undefined>(undefined);
    let chartContainer = $state<HTMLDivElement | undefined>(undefined);
    let chartHost = $state<HTMLDivElement | undefined>(undefined);
    let isVisible = $state(false);
    let isPlaying = $state(false);
    let currentFrameIndex = $state(0);
    let chartWidth = $state(1200);
    let resizeObserver: ResizeObserver | undefined;
    let stopPlayback = false;
    let pendingDraw = 0;

    let keyframes = $state<RaceKeyframe[]>([]);
    let colorScale = d3.scaleOrdinal<string, string>().range(RACE_PALETTE);

    let svg: any = null;
    let chartG: any = null;
    let axisG: any = null;
    let barG: any = null;
    let labelG: any = null;
    let tickerText: any = null;

    // Placeholders; both scales are fully configured in ensureChart().
    let x = d3.scaleLinear();
    let y = d3.scaleBand<number>();

    function colorForName(name: string): string {
        return colorScale(name) ?? "#94a3b8";
    }

    function rank(
        names: Set<string>,
        value: (name: string) => number,
    ): RankedItem[] {
        const keep = topN + 1;
        const top: RankedItem[] = [];

        function isGreater(a: RankedItem, b: RankedItem): boolean {
            if (a.value !== b.value) return a.value > b.value;
            return a.name.localeCompare(b.name) < 0;
        }

        function minIndex(list: RankedItem[]): number {
            let idx = 0;
            for (let i = 1; i < list.length; i++) {
                const a = list[i];
                const b = list[idx];
                if (
                    a.value < b.value ||
                    (a.value === b.value && a.name.localeCompare(b.name) > 0)
                ) {
                    idx = i;
                }
            }
            return idx;
        }

        for (const name of names) {
            const candidate: RankedItem = {
                name,
                value: value(name),
                rank: topN,
            };
            if (candidate.value <= 0) continue;

            if (top.length < keep) {
                top.push(candidate);
                continue;
            }

            const idx = minIndex(top);
            if (isGreater(candidate, top[idx])) {
                top[idx] = candidate;
            }
        }

        top.sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
        for (let i = 0; i < top.length; i++) {
            top[i].rank = i;
        }
        return top;
    }

    function buildKeyframes(source: RaceRow[]): RaceKeyframe[] {
        if (source.length === 0) return [];

        const names = new Set(source.map((d) => d.name));
        const monthMap = d3.rollup(
            source,
            (group) => d3.sum(group, (d) => d.value),
            (d) => d.month,
            (d) => d.name,
        );

        const months = Array.from(monthMap.keys()).sort((a, b) =>
            d3.ascending(new Date(`${a}T00:00:00`), new Date(`${b}T00:00:00`)),
        );

        const cumulative = new Map<string, number>(
            Array.from(names, (name) => [name, 0]),
        );

        const dateValues: Array<[Date, Map<string, number>]> = [];
        for (const month of months) {
            const nameValues = monthMap.get(month) ?? new Map<string, number>();
            for (const [name, value] of nameValues.entries()) {
                cumulative.set(name, (cumulative.get(name) ?? 0) + value);
            }
            dateValues.push([
                new Date(`${month}T00:00:00`),
                new Map<string, number>(cumulative),
            ]);
        }

        const frames: RaceKeyframe[] = [];
        for (let i = 0; i < dateValues.length - 1; i++) {
            const [ka, a] = dateValues[i];
            const [kb, b] = dateValues[i + 1];
            for (let j = 0; j < INTERPOLATION_STEPS; j++) {
                const t = j / INTERPOLATION_STEPS;
                frames.push({
                    date: new Date(ka.getTime() * (1 - t) + kb.getTime() * t),
                    items: rank(
                        names,
                        (name) =>
                            (a.get(name) ?? 0) * (1 - t) +
                            (b.get(name) ?? 0) * t,
                    ),
                });
            }
        }

        const [lastDate, lastValues] = dateValues[dateValues.length - 1];
        frames.push({
            date: lastDate,
            items: rank(names, (name) => lastValues.get(name) ?? 0),
        });

        return frames;
    }

    const progressPct = $derived(
        keyframes.length > 1
            ? (currentFrameIndex / (keyframes.length - 1)) * 100
            : 0,
    );

    const currentDateLabel = $derived.by(() => {
        const frame =
            keyframes[
                Math.max(0, Math.min(currentFrameIndex, keyframes.length - 1))
            ];
        return frame ? d3.utcFormat("%b %Y")(frame.date) : "";
    });

    // Rebuild whenever the parent hands us new rows. The draw is deferred to the
    // next animation frame — outside Svelte's reactive flush — so that (a) the
    // `{#if keyframes.length > 0}` block has mounted `chartHost`, and (b) the
    // render's reads of `chartWidth` (which the ResizeObserver writes back on the
    // resulting size change) can't feed back into this effect and blow the
    // update-depth guard. This mirrors how the original artist race renders
    // imperatively, never from a reactive effect.
    $effect(() => {
        const source = rows;
        stopRace();
        // Read the local `frames`, never the reactive `keyframes` we just wrote:
        // this effect writes `keyframes`, so reading it back here would register a
        // self-dependency and — since buildKeyframes returns a fresh array every
        // run — retrigger the effect endlessly (effect_update_depth_exceeded).
        const frames = buildKeyframes(source);
        keyframes = frames;
        colorScale = d3
            .scaleOrdinal<string, string>()
            .domain(Array.from(new Set(source.map((d) => d.name))))
            .range(RACE_PALETTE);
        currentFrameIndex = Math.max(0, frames.length - 1);

        if (pendingDraw) cancelAnimationFrame(pendingDraw);
        pendingDraw = requestAnimationFrame(() => {
            pendingDraw = 0;
            renderStaticFrame();
        });
    });

    function updateChartWidth() {
        if (!chartContainer) return;
        chartWidth = Math.max(
            minWidth,
            Math.floor(chartContainer.clientWidth - 32),
        );
        if (!isPlaying) renderStaticFrame();
    }

    function chartHeight(): number {
        return MARGIN.top + BAR_SIZE * (topN + 1) + MARGIN.bottom;
    }

    function ensureChart() {
        if (!chartHost) return;
        if (svg) return;

        const h = chartHeight();
        x = d3.scaleLinear([0, 1], [MARGIN.left, chartWidth - MARGIN.right]);
        y = d3
            .scaleBand<number>()
            .domain(d3.range(topN + 1))
            .rangeRound([MARGIN.top, MARGIN.top + BAR_SIZE * (topN + 1 + 0.1)])
            .padding(0.1);

        svg = d3
            .select(chartHost)
            .append("svg")
            .attr("role", "img")
            .attr("aria-label", ariaLabel)
            .attr("width", chartWidth)
            .attr("height", h)
            .attr("viewBox", `0 0 ${chartWidth} ${h}`);

        chartG = svg.append("g");
        axisG = chartG.append("g");
        barG = chartG.append("g");
        labelG = chartG.append("g");
        tickerText = svg
            .append("text")
            .style(
                "font",
                `bold ${BAR_SIZE}px var(--font-geist-mono, monospace)`,
            )
            .style("font-variant-numeric", "tabular-nums")
            .attr("text-anchor", "end")
            .attr("x", chartWidth - 8)
            .attr("y", h - 8)
            .attr("fill", "rgb(148 163 184 / 0.65)");
    }

    function resetChart() {
        if (!chartHost) return;
        chartHost.innerHTML = "";
        svg = null;
        chartG = null;
        axisG = null;
        barG = null;
        labelG = null;
        tickerText = null;
    }

    function axis(transition: any) {
        const h = chartHeight();
        const tickSize = MARGIN.top + BAR_SIZE * (topN + 0.1);
        axisG
            .attr("transform", `translate(0,${MARGIN.top})`)
            .transition(transition)
            .call(
                d3
                    .axisTop(x)
                    .ticks(chartWidth / 160)
                    .tickSizeOuter(0)
                    .tickSizeInner(-tickSize),
            )
            .call((g: any) => g.select(".domain").remove())
            .call((g: any) =>
                g
                    .selectAll(".tick line")
                    .attr("stroke", "rgb(148 163 184 / 0.28)"),
            )
            .call((g: any) => g.selectAll(".tick text").attr("dy", "-0.15em"));

        tickerText.attr("x", chartWidth - 8).attr("y", h - 8);
    }

    function bars(
        frame: RaceKeyframe,
        prev: Map<string, RankedItem>,
        next: Map<string, RankedItem>,
        transition: any,
    ) {
        barG.selectAll("rect")
            .data(frame.items.slice(0, topN), (d: any) => d.name)
            .join(
                (enter: any) =>
                    enter
                        .append("rect")
                        .attr("fill", (d: any) => colorForName(d.name))
                        .attr("height", y.bandwidth())
                        .attr("x", x(0))
                        .attr(
                            "y",
                            (d: any) =>
                                y((prev.get(d.name) ?? d).rank) ??
                                y(topN) ??
                                0,
                        )
                        .attr(
                            "width",
                            (d: any) => x((prev.get(d.name) ?? d).value) - x(0),
                        ),
                (update: any) => update,
                (exit: any) =>
                    exit
                        .transition(transition)
                        .remove()
                        .attr(
                            "y",
                            (d: any) =>
                                y((next.get(d.name) ?? d).rank) ??
                                y(topN) ??
                                0,
                        )
                        .attr(
                            "width",
                            (d: any) => x((next.get(d.name) ?? d).value) - x(0),
                        ),
            )
            .call((bar: any) =>
                bar
                    .transition(transition)
                    .attr("y", (d: any) => y(d.rank) ?? y(topN) ?? 0)
                    .attr("width", (d: any) => x(d.value) - x(0)),
            );
    }

    function labels(
        frame: RaceKeyframe,
        prev: Map<string, RankedItem>,
        next: Map<string, RankedItem>,
        transition: any,
    ) {
        labelG
            .selectAll("text")
            .data(frame.items.slice(0, topN), (d: any) => d.name)
            .join(
                (enter: any) => {
                    const text = enter
                        .append("text")
                        .attr("text-anchor", "end")
                        .attr("transform", (d: any) => {
                            const p = prev.get(d.name) ?? d;
                            return `translate(${x(p.value)},${(y(p.rank) ?? 0) + y.bandwidth() / 2})`;
                        })
                        .attr("dy", "0.35em")
                        .style("font-size", "12px");

                    text.append("tspan")
                        .attr("x", -6)
                        .attr("font-weight", "600")
                        .text((d: any) => formatName(d.name));

                    text.append("tspan")
                        .attr("fill-opacity", 0.78)
                        .attr("font-weight", "400")
                        .attr("x", 6)
                        .attr("text-anchor", "start")
                        .text((d: any) =>
                            formatValue((prev.get(d.name) ?? d).value),
                        );

                    return text;
                },
                (update: any) => update,
                (exit: any) =>
                    exit
                        .transition(transition)
                        .remove()
                        .attr("transform", (d: any) => {
                            const n = next.get(d.name) ?? d;
                            return `translate(${x(n.value)},${(y(n.rank) ?? 0) + y.bandwidth() / 2})`;
                        })
                        .call((g: any) =>
                            g
                                .select("tspan:last-child")
                                .tween("text", function (this: any, d: any) {
                                    const el = this;
                                    const i = d3.interpolateNumber(
                                        d.value,
                                        (next.get(d.name) ?? d).value,
                                    );
                                    return (t: number) => {
                                        el.textContent = formatValue(i(t));
                                    };
                                }),
                        ),
            )
            .call((text: any) =>
                text
                    .transition(transition)
                    .attr(
                        "transform",
                        (d: any) =>
                            `translate(${x(d.value)},${(y(d.rank) ?? 0) + y.bandwidth() / 2})`,
                    )
                    .call((g: any) =>
                        g
                            .select("tspan:last-child")
                            .tween(
                                "text",
                                function (this: SVGTextElement, d: any) {
                                    const el = this;
                                    const p = prev.get(d.name) ?? d;
                                    const i = d3.interpolateNumber(
                                        p.value,
                                        d.value,
                                    );
                                    return (t: number) => {
                                        el.textContent = formatValue(i(t));
                                    };
                                },
                            ),
                    ),
            );
    }

    async function drawFrame(index: number, duration = 0) {
        if (keyframes.length === 0) return;
        ensureChart();

        const frame = keyframes[index];
        const prevFrame = keyframes[Math.max(0, index - 1)] ?? frame;
        const nextFrame =
            keyframes[Math.min(keyframes.length - 1, index + 1)] ?? frame;
        const prev = new Map(prevFrame.items.map((d) => [d.name, d]));
        const next = new Map(nextFrame.items.map((d) => [d.name, d]));

        x.domain([0, frame.items[0]?.value ?? 1]);

        const transition = svg
            .transition()
            .duration(duration)
            .ease(d3.easeLinear);

        axis(transition);
        bars(frame, prev, next, transition);
        labels(frame, prev, next, transition);

        tickerText.transition(transition).tween("text", () => {
            const format = d3.utcFormat("%b %Y");
            const i = d3.interpolateDate(prevFrame.date, frame.date);
            return function (this: SVGTextElement, t: number) {
                this.textContent = format(i(t));
            };
        });

        try {
            await transition.end();
        } catch {
            // Interruption (stop button / data refresh).
        }
    }

    async function playRace() {
        if (isPlaying || keyframes.length <= 1) return;
        stopPlayback = false;
        isPlaying = true;

        // Resume from the current position; restart from the beginning if already at the end.
        const start =
            currentFrameIndex >= keyframes.length - 1 ? 0 : currentFrameIndex;
        currentFrameIndex = start;
        await drawFrame(start, 0);

        for (let i = start + 1; i < keyframes.length; i++) {
            if (stopPlayback) break;
            currentFrameIndex = i;
            await drawFrame(i, FRAME_DURATION_MS);
        }

        isPlaying = false;
    }

    function stopRace() {
        stopPlayback = true;
        isPlaying = false;
        svg?.interrupt();
    }

    function stepFrame(delta: number) {
        if (isPlaying || keyframes.length === 0) return;
        const nextIndex = Math.max(
            0,
            Math.min(currentFrameIndex + delta, keyframes.length - 1),
        );
        currentFrameIndex = nextIndex;
        drawFrame(nextIndex, 220);
    }

    function scrubToFrame(index: number) {
        if (keyframes.length === 0) return;
        if (isPlaying) stopRace();
        const nextIndex = Math.max(0, Math.min(index, keyframes.length - 1));
        currentFrameIndex = nextIndex;
        drawFrame(nextIndex, 0);
    }

    function renderStaticFrame() {
        if (isPlaying || keyframes.length === 0) return;
        resetChart();
        drawFrame(
            Math.max(0, Math.min(currentFrameIndex, keyframes.length - 1)),
            0,
        );
    }

    onMount(() => {
        const observer = new IntersectionObserver(
            (entries) => {
                if (entries[0].isIntersecting) {
                    isVisible = true;
                    onVisible?.();
                    observer.disconnect();
                }
            },
            { threshold: 0.1 },
        );

        if (element) observer.observe(element);

        resizeObserver = new ResizeObserver(() => updateChartWidth());
        if (chartContainer) {
            resizeObserver.observe(chartContainer);
            updateChartWidth();
        }

        return () => {
            observer.disconnect();
            resizeObserver?.disconnect();
            if (pendingDraw) cancelAnimationFrame(pendingDraw);
            stopRace();
            resetChart();
        };
    });
</script>

<section bind:this={element} class="guide-section py-8">
    <div class="text-content mb-6">
        <h2 class="text-2xl font-bold mb-2">{title}</h2>
    </div>

    <div
        bind:this={chartContainer}
        class="chart-container bg-surface-900 rounded-lg p-6 border border-surface-700"
    >
        {#if keyframes.length > 0}
            <div class="mb-4 flex items-center gap-3">
                <button
                    type="button"
                    class="race-btn"
                    onclick={playRace}
                    disabled={isPlaying}
                >
                    Play
                </button>
                <button
                    type="button"
                    class="race-btn"
                    onclick={stopRace}
                    disabled={!isPlaying}
                >
                    Stop
                </button>
                <button
                    type="button"
                    class="race-btn"
                    onclick={() => stepFrame(-1)}
                    disabled={isPlaying || currentFrameIndex === 0}
                >
                    ←
                </button>
                <button
                    type="button"
                    class="race-btn"
                    onclick={() => stepFrame(1)}
                    disabled={isPlaying ||
                        currentFrameIndex === keyframes.length - 1}
                >
                    →
                </button>
                <div class="text-sm opacity-70 ml-2 tabular-nums">
                    {currentDateLabel}
                </div>
            </div>

            <div class="mb-5">
                <input
                    type="range"
                    class="race-scrubber"
                    min="0"
                    max={keyframes.length - 1}
                    step="1"
                    value={currentFrameIndex}
                    oninput={(e) => scrubToFrame(+e.currentTarget.value)}
                    aria-label="Position in the timeline"
                    style={`--progress:${progressPct}%`}
                />
            </div>

            <div bind:this={chartHost} class="w-full"></div>
        {:else if isVisible}
            <div
                class="w-full h-[420px] flex items-center justify-center opacity-50"
            >
                {loadingLabel}
            </div>
        {:else}
            <div
                class="w-full h-[420px] flex items-center justify-center opacity-50"
            >
                Scroll to view
            </div>
        {/if}
    </div>
</section>

<style>
    .race-btn {
        border: 1px solid rgb(71 85 105 / 0.8);
        background: rgb(15 23 42 / 0.7);
        color: rgb(226 232 240 / 1);
        border-radius: 999px;
        padding: 0.35rem 0.8rem;
        font-size: 0.85rem;
    }

    .race-btn:disabled {
        opacity: 0.45;
        cursor: not-allowed;
    }

    .race-scrubber {
        -webkit-appearance: none;
        appearance: none;
        width: 100%;
        height: 4px;
        border-radius: 999px;
        background: linear-gradient(
            to right,
            rgb(96 165 250 / 0.9) var(--progress, 0%),
            rgb(71 85 105 / 0.4) var(--progress, 0%)
        );
        cursor: pointer;
        outline: none;
    }

    .race-scrubber::-webkit-slider-thumb {
        -webkit-appearance: none;
        appearance: none;
        width: 13px;
        height: 13px;
        border-radius: 50%;
        background: rgb(226 232 240 / 1);
        box-shadow: 0 0 0 3px rgb(15 23 42 / 0.7);
        transition: transform 0.12s ease;
    }

    .race-scrubber::-moz-range-thumb {
        width: 13px;
        height: 13px;
        border: none;
        border-radius: 50%;
        background: rgb(226 232 240 / 1);
        box-shadow: 0 0 0 3px rgb(15 23 42 / 0.7);
    }

    .race-scrubber:hover::-webkit-slider-thumb,
    .race-scrubber:active::-webkit-slider-thumb {
        transform: scale(1.18);
    }

    .race-scrubber:focus-visible::-webkit-slider-thumb {
        box-shadow: 0 0 0 3px rgb(96 165 250 / 0.6);
    }
</style>
