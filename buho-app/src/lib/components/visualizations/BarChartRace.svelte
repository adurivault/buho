<script lang="ts" module>
    export type RaceRow = {
        month: string; // 'YYYY-MM-DD' (month bucket)
        name: string;
        value: number;
    };
</script>

<script lang="ts">
    import * as d3 from 'd3';
    import { RACE_PALETTE_SIZE, racePalette } from '#lib/visualizations/racePalette.ts';
    import { themeStore } from '#lib/stores/themeStore.svelte.ts';
    import { onMount } from 'svelte';
    import { trackControl, trackOnce } from '#lib/analytics.ts';
    import InfoHint from '#lib/components/InfoHint.svelte';
    import ShareMenu from '#lib/components/ShareMenu.svelte';
    import { clipDurationMs, type ShareSource } from '#lib/export/index.ts';

    type Props = {
        title: string;
        // Optional explanation, shown behind a "?" next to the title.
        hint?: string;
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
        // Analytics id for this race (a literal, never derived from data).
        trackId?: string;
    };

    let {
        title,
        hint,
        rows,
        formatValue = (v: number) => v.toFixed(1),
        formatName = (name: string) => name,
        ariaLabel = 'Bar chart race',
        loadingLabel = 'Loading…',
        topN = 15,
        leftMargin = 220,
        minWidth = 920,
        onVisible,
        trackId,
    }: Props = $props();

    // Falls back to a slug of the (literal) title so every race is
    // distinguishable in analytics without touching each call site.
    const vizId = $derived(
        trackId ??
            title
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, '-')
                .replace(/^-|-$/g, '')
                .slice(0, 40)
    );

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
    // 1× is deliberately a slow, readable step — the setting where the reorders
    // can actually be followed — with the ceiling raised so a long history can
    // still be crossed quickly.
    const FRAME_DURATION_MS = 240;
    const SPEEDS = [1, 2, 4, 8, 16] as const;
    const BAR_SIZE = 36;
    const BAR_RADIUS = 4;
    // Gap between a bar's end and the number reading it out.
    const VALUE_GAP = 8;
    const MARGIN = $derived({ top: 28, right: 96, bottom: 16, left: leftMargin });

    /**
     * A bar of `w` × `h` with its far end rounded, drawn from its own origin.
     *
     * A plain `rx` would round the baseline end too, which detaches the bar from
     * the axis it is measured against. The radius collapses with the width so a
     * near-zero bar stays a sliver instead of a pill, and the command sequence is
     * the same at every width — d3's string interpolation tweens it number by
     * number, so the shape morphs cleanly across a frame.
     */
    function barPath(w: number, h: number): string {
        const r = Math.min(BAR_RADIUS, Math.max(0, w), h / 2);
        return `M0,0H${w - r}A${r},${r} 0 0 1 ${w},${r}V${h - r}A${r},${r} 0 0 1 ${w - r},${h}H0Z`;
    }

    /**
     * What fits in the name column, in characters.
     *
     * Now that the names live in the margin rather than riding their bar, a long
     * one runs off the left edge of the viewBox and is cut mid-glyph. SVG has no
     * text-overflow, so the budget is estimated from the average advance of the
     * label face at its size — approximate on purpose, and generous, since the
     * cost of guessing low is one clipped character and the cost of guessing
     * high is a name sliced by the frame.
     */
    const LABEL_CHAR_PX = 6.6;
    const maxLabelChars = $derived(
        Math.max(8, Math.floor((leftMargin - VALUE_GAP * 2) / LABEL_CHAR_PX))
    );
    const labelText = (name: string): string => {
        const text = formatName(name);
        return text.length > maxLabelChars ? `${text.slice(0, maxLabelChars - 1)}…` : text;
    };

    let element = $state<HTMLElement | undefined>(undefined);
    let chartContainer = $state<HTMLDivElement | undefined>(undefined);
    let chartHost = $state<HTMLDivElement | undefined>(undefined);
    let isVisible = $state(false);
    let isPlaying = $state(false);
    let speed = $state<(typeof SPEEDS)[number]>(1);
    let currentFrameIndex = $state(0);
    let chartWidth = $state(1200);
    let resizeObserver: ResizeObserver | undefined;
    let stopPlayback = false;
    let pendingDraw = 0;

    let keyframes = $state<RaceKeyframe[]>([]);
    // A name holds a slot, not a colour, so a theme toggle repaints without
    // reshuffling anyone.
    let colorScale = d3.scaleOrdinal<string, number>().range(d3.range(RACE_PALETTE_SIZE));

    type Group = d3.Selection<SVGGElement, unknown, null, undefined>;
    /**
     * One keyframe step: every part of the chart joins the same transition. Typed
     * on `BaseType` because that is what `selection.transition(t)` accepts.
     */
    type Step = d3.Transition<d3.BaseType, unknown, null, undefined>;

    let svg: d3.Selection<SVGSVGElement, unknown, null, undefined> | null = null;
    let chartG: Group | null = null;
    let axisG: Group | null = null;
    let barG: Group | null = null;
    let labelG: Group | null = null;
    let valueG: Group | null = null;
    let tickerText: d3.Selection<SVGTextElement, unknown, null, undefined> | null = null;

    // Placeholders; both scales are fully configured in ensureChart().
    let x = d3.scaleLinear();
    let y = d3.scaleBand<number>();

    function colorForName(name: string): string {
        return racePalette()[colorScale(name) ?? 0];
    }

    function rank(names: Set<string>, value: (name: string) => number): RankedItem[] {
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
            (d) => d.name
        );

        const months = Array.from(monthMap.keys()).sort((a, b) =>
            d3.ascending(new Date(`${a}T00:00:00`), new Date(`${b}T00:00:00`))
        );

        const cumulative = new Map<string, number>(Array.from(names, (name) => [name, 0]));

        const dateValues: Array<[Date, Map<string, number>]> = [];
        for (const month of months) {
            const nameValues = monthMap.get(month) ?? new Map<string, number>();
            for (const [name, value] of nameValues.entries()) {
                cumulative.set(name, (cumulative.get(name) ?? 0) + value);
            }
            dateValues.push([new Date(`${month}T00:00:00`), new Map<string, number>(cumulative)]);
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
                        (name) => (a.get(name) ?? 0) * (1 - t) + (b.get(name) ?? 0) * t
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
        keyframes.length > 1 ? (currentFrameIndex / (keyframes.length - 1)) * 100 : 0
    );

    const currentDateLabel = $derived.by(() => {
        const frame = keyframes[Math.max(0, Math.min(currentFrameIndex, keyframes.length - 1))];
        return frame ? d3.utcFormat('%b %Y')(frame.date) : '';
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
            .scaleOrdinal<string, number>()
            .domain(Array.from(new Set(source.map((d) => d.name))))
            .range(d3.range(RACE_PALETTE_SIZE));
        currentFrameIndex = Math.max(0, frames.length - 1);

        if (pendingDraw) cancelAnimationFrame(pendingDraw);
        pendingDraw = requestAnimationFrame(() => {
            pendingDraw = 0;
            renderStaticFrame();
        });
    });

    function updateChartWidth() {
        if (!chartContainer) return;
        chartWidth = Math.max(minWidth, Math.floor(chartContainer.clientWidth - 32));
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
            .append('svg')
            .attr('role', 'img')
            .attr('aria-label', ariaLabel)
            .attr('width', chartWidth)
            .attr('height', h)
            .attr('viewBox', `0 0 ${chartWidth} ${h}`);

        // The ticker goes down first so the bars paint over it.
        tickerText = svg
            .append('text')
            .style('font', `600 ${BAR_SIZE}px var(--font-mono, monospace)`)
            .style('font-variant-numeric', 'tabular-nums')
            .style('letter-spacing', '-0.02em')
            .attr('text-anchor', 'end')
            .attr('x', chartWidth - 8)
            .attr('y', h - 8)
            // A watermark, not a readout: at this size a legible month competes
            // with the race. The control row above states it in plain text.
            .style('fill', 'hsl(var(--foreground) / 0.18)');

        chartG = svg.append('g');
        axisG = chartG.append('g');
        barG = chartG.append('g');
        labelG = chartG.append('g');
        valueG = chartG.append('g');
    }

    $effect(() => {
        void themeStore.theme;
        barG?.selectAll<SVGPathElement, RankedItem>('path').attr('fill', (d) =>
            colorForName(d.name)
        );
    });

    function resetChart() {
        if (!chartHost) return;
        // The host is D3's, never rendered into by Svelte.
        // eslint-disable-next-line svelte/no-dom-manipulating
        chartHost.innerHTML = '';
        svg = null;
        chartG = null;
        axisG = null;
        barG = null;
        labelG = null;
        valueG = null;
        tickerText = null;
    }

    function axis(transition: Step) {
        if (!axisG || !tickerText) return;
        const h = chartHeight();
        const tickSize = MARGIN.top + BAR_SIZE * (topN + 0.1);
        axisG
            .attr('transform', `translate(0,${MARGIN.top})`)
            .transition(transition)
            .call(
                d3
                    .axisTop(x)
                    .ticks(chartWidth / 160)
                    .tickSizeOuter(0)
                    .tickSizeInner(-tickSize)
            )
            .call((g) => g.select('.domain').remove())
            .call((g) => g.selectAll('.tick line').style('stroke', 'hsl(var(--border))'))
            .call((g) =>
                g
                    .selectAll('.tick text')
                    .attr('dy', '-0.35em')
                    .style('fill', 'hsl(var(--muted-foreground))')
                    .style('font-size', 'var(--text-label)')
                    .style('font-variant-numeric', 'tabular-nums')
            );

        tickerText.attr('x', chartWidth - 8).attr('y', h - 8);
    }

    function bars(
        frame: RaceKeyframe,
        prev: Map<string, RankedItem>,
        next: Map<string, RankedItem>,
        transition: Step
    ) {
        const rowY = (d: RankedItem) => y(d.rank) ?? y(topN) ?? 0;
        const place = (d: RankedItem) => `translate(${x(0)},${rowY(d)})`;
        const shape = (d: RankedItem) => barPath(x(d.value) - x(0), y.bandwidth());

        if (!barG) return;
        barG.selectAll<SVGPathElement, RankedItem>('path')
            .data(frame.items.slice(0, topN), (d) => d.name)
            .join(
                (enter) =>
                    enter
                        .append('path')
                        .attr('fill', (d) => colorForName(d.name))
                        .attr('transform', (d) => place(prev.get(d.name) ?? d))
                        .attr('d', (d) => shape(prev.get(d.name) ?? d)),
                (update) => update,
                (exit) =>
                    exit
                        .transition(transition)
                        .remove()
                        .attr('transform', (d) => place(next.get(d.name) ?? d))
                        .attr('d', (d) => shape(next.get(d.name) ?? d))
            )
            .call((bar) => bar.transition(transition).attr('transform', place).attr('d', shape));
    }

    /**
     * The names, as a fixed column in the left margin.
     *
     * They used to ride the end of their own bar, the way Observable's original
     * does. That reads well only while every bar is long: the tail of the field
     * pulls its label off the bar and out over the background, and since the
     * name is set in the ink that has to stay legible *on* a pastel bar, the
     * bottom of the ranking went dark-on-dark. Anchored to the margin they are
     * always on the surface, always the surface's own ink, and only ever move
     * vertically — which is the movement the race is about anyway.
     */
    function labels(
        frame: RaceKeyframe,
        prev: Map<string, RankedItem>,
        next: Map<string, RankedItem>,
        transition: Step
    ) {
        const rowMid = (d: RankedItem) => (y(d.rank) ?? y(topN) ?? 0) + y.bandwidth() / 2;
        const place = (d: RankedItem) => `translate(${MARGIN.left - VALUE_GAP},${rowMid(d)})`;

        if (!labelG) return;
        labelG
            .selectAll<SVGTextElement, RankedItem>('text')
            .data(frame.items.slice(0, topN), (d) => d.name)
            .join(
                (enter) =>
                    enter
                        .append('text')
                        .attr('text-anchor', 'end')
                        .attr('dy', '0.35em')
                        .style('font-size', 'var(--text-small)')
                        .style('font-weight', '500')
                        .style('fill', 'hsl(var(--foreground))')
                        .attr('transform', (d) => place(prev.get(d.name) ?? d))
                        .text((d) => labelText(d.name)),
                (update) => update,
                (exit) =>
                    exit
                        .transition(transition)
                        .remove()
                        .attr('transform', (d) => place(next.get(d.name) ?? d))
            )
            .call((text) => text.transition(transition).attr('transform', place));
    }

    /** The running total, counting up just past the end of its own bar. */
    function values(
        frame: RaceKeyframe,
        prev: Map<string, RankedItem>,
        next: Map<string, RankedItem>,
        transition: Step
    ) {
        const rowMid = (d: RankedItem) => (y(d.rank) ?? y(topN) ?? 0) + y.bandwidth() / 2;
        const place = (d: RankedItem) => `translate(${x(d.value) + VALUE_GAP},${rowMid(d)})`;
        /** Count from wherever the number stood to wherever it is going. */
        const count = (from: (d: RankedItem) => number, to: (d: RankedItem) => number) =>
            function (this: SVGTextElement, d: RankedItem) {
                // D3 hands the element over as `this`; the tween closure outlives it.
                // eslint-disable-next-line @typescript-eslint/no-this-alias
                const el = this;
                const i = d3.interpolateNumber(from(d), to(d));
                return (t: number) => {
                    el.textContent = formatValue(i(t));
                };
            };
        const own = (d: RankedItem) => d.value;

        if (!valueG) return;
        valueG
            .selectAll<SVGTextElement, RankedItem>('text')
            .data(frame.items.slice(0, topN), (d) => d.name)
            .join(
                (enter) =>
                    enter
                        .append('text')
                        .attr('dy', '0.35em')
                        .style('font-size', 'var(--text-label)')
                        .style('font-variant-numeric', 'tabular-nums')
                        .style('fill', 'hsl(var(--muted-foreground))')
                        .attr('transform', (d) => place(prev.get(d.name) ?? d))
                        .text((d) => formatValue((prev.get(d.name) ?? d).value)),
                (update) => update,
                (exit) =>
                    exit
                        .transition(transition)
                        .remove()
                        .attr('transform', (d) => place(next.get(d.name) ?? d))
                        .tween(
                            'text',
                            count(own, (d) => (next.get(d.name) ?? d).value)
                        )
            )
            .call((text) =>
                text
                    .transition(transition)
                    .attr('transform', place)
                    .tween(
                        'text',
                        count((d: RankedItem) => (prev.get(d.name) ?? d).value, own)
                    )
            );
    }

    /**
     * `fromIndex` is the frame currently on screen, which is not always
     * `index - 1`: playback can skip keyframes to go faster. Every tween starts
     * from it — the counting labels and the month ticker would otherwise animate
     * across one step while the bars travel several.
     */
    async function drawFrame(index: number, duration = 0, fromIndex = index - 1) {
        if (keyframes.length === 0) return;
        ensureChart();
        // The host is only in the DOM once the section has scrolled into view;
        // until then there is nothing to draw on.
        if (!svg) return;

        const frame = keyframes[index];
        const prevFrame = keyframes[Math.max(0, fromIndex)] ?? frame;
        const nextFrame = keyframes[Math.min(keyframes.length - 1, index + 1)] ?? frame;
        const prev = new Map(prevFrame.items.map((d) => [d.name, d]));
        const next = new Map(nextFrame.items.map((d) => [d.name, d]));

        x.domain([0, frame.items[0]?.value ?? 1]);

        if (!svg || !tickerText) return;
        const transition: Step = d3
            .select<d3.BaseType, unknown>(svg.node())
            .transition()
            .duration(duration)
            .ease(d3.easeLinear);

        axis(transition);
        bars(frame, prev, next, transition);
        labels(frame, prev, next, transition);
        values(frame, prev, next, transition);

        tickerText.transition(transition).tween('text', () => {
            const format = d3.utcFormat('%b %Y');
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
        const start = currentFrameIndex >= keyframes.length - 1 ? 0 : currentFrameIndex;
        currentFrameIndex = start;
        await drawFrame(start, 0);

        let from = start;
        while (!stopPlayback && from < keyframes.length - 1) {
            // Speed skips keyframes instead of shortening the transition: each
            // step still animates over its full duration, so the race stays
            // fluid rather than degrading into a stutter of near-instant hops.
            // `speed` is read per step, so a change lands on the next one.
            const next = Math.min(from + speed, keyframes.length - 1);
            currentFrameIndex = next;
            await drawFrame(next, FRAME_DURATION_MS, from);
            from = next;
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
        const nextIndex = Math.max(0, Math.min(currentFrameIndex + delta, keyframes.length - 1));
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
        drawFrame(Math.max(0, Math.min(currentFrameIndex, keyframes.length - 1)), 0);
    }

    /* ---------------------------------------------------------------- export */

    /**
     * How long the race should last in an exported file.
     *
     * Not the on-screen duration: at 1× a decade of listening runs for minutes,
     * and nobody shares a four-minute clip of a bar chart. The export is paced
     * to the size of the history, then divided by the speed the reader picked
     * — the same control, meaning the same thing — and capped at both ends.
     */
    const EXPORT_MS = $derived(clipDurationMs(Math.max(6_000, keyframes.length * 55), speed));

    /** The frame the reader was on, restored once a recording is over. */
    let frameBeforeExport = 0;

    const shareSource = $derived<ShareSource>({
        name: vizId,
        title,
        element: () => chartHost,
        animation:
            keyframes.length > 1
                ? {
                      durationMs: EXPORT_MS,
                      speed,
                      begin: () => {
                          stopRace();
                          frameBeforeExport = currentFrameIndex;
                      },
                      end: () => {
                          currentFrameIndex = frameBeforeExport;
                          drawFrame(frameBeforeExport, 0);
                      },
                      // Straight to the frame, with no transition: the recorder
                      // owns the clock, and a tween running underneath it would
                      // be captured mid-flight.
                      seek: async (t) => {
                          const index = Math.round(t * (keyframes.length - 1));
                          currentFrameIndex = index;
                          await drawFrame(index, 0, index);
                      },
                  }
                : undefined,
    });

    onMount(() => {
        const observer = new IntersectionObserver(
            (entries) => {
                if (entries[0].isIntersecting) {
                    isVisible = true;
                    trackOnce('section-view', vizId, { section: vizId });
                    onVisible?.();
                    observer.disconnect();
                }
            },
            { threshold: 0.1 }
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
        <h2 class="text-2xl font-bold mb-2">
            {title}{#if hint}<InfoHint text={hint} />{/if}
        </h2>
    </div>

    <div
        bind:this={chartContainer}
        class="chart-container rounded-lg border border-border bg-card p-6"
    >
        {#if keyframes.length > 0}
            <div class="controls">
                <!--
                    One button, not a Play next to a Stop with one of the two
                    always greyed out. Stopping resumes where it left off, so
                    the control was a pause all along.
                -->
                <button
                    type="button"
                    class="race-btn primary"
                    onclick={() => {
                        trackControl(vizId, 'playback', isPlaying ? 'stop' : 'play');
                        if (isPlaying) stopRace();
                        else playRace();
                    }}
                >
                    {isPlaying ? 'Pause' : 'Play'}
                </button>

                <div class="group" role="group" aria-label="Step">
                    <button
                        type="button"
                        class="race-btn step"
                        aria-label="Previous frame"
                        onclick={() => {
                            trackControl(vizId, 'step', 'back');
                            stepFrame(-1);
                        }}
                        disabled={isPlaying || currentFrameIndex === 0}
                    >
                        ←
                    </button>
                    <button
                        type="button"
                        class="race-btn step"
                        aria-label="Next frame"
                        onclick={() => {
                            trackControl(vizId, 'step', 'forward');
                            stepFrame(1);
                        }}
                        disabled={isPlaying || currentFrameIndex === keyframes.length - 1}
                    >
                        →
                    </button>
                </div>

                <div class="group" role="group" aria-label="Playback speed">
                    {#each SPEEDS as s (s)}
                        <button
                            type="button"
                            class="race-btn speed"
                            class:active={speed === s}
                            aria-pressed={speed === s}
                            onclick={() => {
                                trackControl(vizId, 'speed', String(s));
                                speed = s;
                            }}
                        >
                            {s}×
                        </button>
                    {/each}
                </div>

                <div class="ticker">{currentDateLabel}</div>
                <ShareMenu source={shareSource} {vizId} floating={false} />
            </div>

            <div class="mb-6">
                <input
                    type="range"
                    class="race-scrubber"
                    min="0"
                    max={keyframes.length - 1}
                    step="1"
                    value={currentFrameIndex}
                    oninput={(e) => {
                        trackControl(vizId, 'scrub', 'drag');
                        scrubToFrame(+e.currentTarget.value);
                    }}
                    aria-label="Position in the timeline"
                    style={`--progress:${progressPct}%`}
                />
            </div>

            <div bind:this={chartHost} class="w-full"></div>
        {:else if isVisible}
            <div class="placeholder">{loadingLabel}</div>
        {:else}
            <div class="placeholder">Scroll to view</div>
        {/if}
    </div>
</section>

<style>
    /*
       Chrome in the app's own tokens.

       Every colour here used to be a hard-coded slate — a cold blue-grey set
       against a warm paper/ink theme, and fixed to the dark one, so the light
       theme rendered near-black pills on off-white. Tokens make both themes
       correct for free, and they were already there.

    .controls {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 0.5rem;
        margin-bottom: 1rem;
    }

    .race-btn {
        border: 1px solid hsl(var(--border));
        background: hsl(var(--secondary) / 0.45);
        color: hsl(var(--foreground));
        border-radius: var(--radius-pill);
        padding: 0.35rem 0.85rem;
        font-size: var(--text-body);
        line-height: 1.2;
        cursor: pointer;
        transition:
            border-color 0.15s,
            background-color 0.15s,
            opacity 0.15s;
    }

    .race-btn:hover:not(:disabled) {
        border-color: hsl(var(--foreground) / 0.4);
    }

    .race-btn:disabled {
        opacity: 0.4;
        cursor: not-allowed;
    }

    /* The one control anyone reaches for first. */
    .race-btn.primary {
        min-width: 5.25rem;
        border-color: transparent;
        background: hsl(var(--primary));
        color: hsl(var(--primary-foreground));
        font-weight: 600;
    }

    .race-btn.primary:hover {
        border-color: transparent;
        opacity: 0.9;
    }

    /* Stepping and speed each read as one control, not as loose pills. */
    .group {
        display: inline-flex;
        gap: 0.25rem;
        margin-left: 0.25rem;
    }

    .race-btn.step {
        padding: 0.35rem 0.7rem;
        font-variant-numeric: tabular-nums;
    }

    .race-btn.speed {
        padding: 0.35rem 0.65rem;
        color: hsl(var(--muted-foreground));
        font-variant-numeric: tabular-nums;
    }

    .race-btn.speed.active {
        border-color: hsl(var(--foreground) / 0.45);
        background: hsl(var(--secondary));
        color: hsl(var(--foreground));
        font-weight: 600;
    }

    /* The month in plain text, since the one in the chart is a watermark. */
    .ticker {
        margin-left: auto;
        margin-right: 0.15rem;
        font-size: var(--text-body);
        font-variant-numeric: tabular-nums;
        letter-spacing: 0.01em;
        color: hsl(var(--muted-foreground));
    }

    .placeholder {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 100%;
        height: 420px;
        font-size: var(--text-body);
        color: hsl(var(--muted-foreground));
    }

    .race-scrubber {
        -webkit-appearance: none;
        appearance: none;
        width: 100%;
        height: 4px;
        border-radius: var(--radius-pill);
        background: linear-gradient(
            to right,
            hsl(var(--foreground) / 0.7) var(--progress, 0%),
            hsl(var(--border)) var(--progress, 0%)
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
        background: hsl(var(--foreground));
        box-shadow: 0 0 0 3px hsl(var(--card));
        transition: transform 0.12s ease;
    }

    .race-scrubber::-moz-range-thumb {
        width: 13px;
        height: 13px;
        border: none;
        border-radius: 50%;
        background: hsl(var(--foreground));
        box-shadow: 0 0 0 3px hsl(var(--card));
    }

    .race-scrubber:hover::-webkit-slider-thumb,
    .race-scrubber:active::-webkit-slider-thumb {
        transform: scale(1.18);
    }

    .race-scrubber:focus-visible::-webkit-slider-thumb {
        box-shadow: 0 0 0 3px hsl(var(--ring) / 0.7);
    }
</style>
