<script lang="ts">
    import * as d3 from 'd3';
    import {
        buildCadenceDistribution,
        shiftSpan,
        spanFromBars,
        type CadenceSeries,
        type CadenceSpan as Span,
    } from '#lib/visualizations/cadenceDistribution.ts';
    import type { NumericRangeFilterValue } from '#lib/types/filters.ts';
    import { trackControl } from '#lib/analytics.ts';

    interface Props {
        /**
         * One series per step counter. Their cadences are NaN wherever that
         * counter recorded no active time, and their weights are the explorer's
         * current measure.
         */
        series: CadenceSeries[];
        /** Series key → colour; anything unlisted takes the module's fill. */
        colors?: Record<string, string>;
        /** The cadence selection in force, or null. */
        range?: NumericRangeFilterValue | null;
        onSelect?: (range: NumericRangeFilterValue | null) => void;
        /** Renders a weight in the current measure's own words. */
        formatValue?: (value: number) => string;
        /** Is the constellation currently coloured by cadence band? */
        colorByActive?: boolean;
        onToggleColorBy?: () => void;
        testId?: string;
    }

    let {
        series,
        colors = {},
        range = null,
        onSelect,
        formatValue = (v: number) => Math.round(v).toLocaleString(),
        colorByActive = false,
        onToggleColorBy,
        testId,
    }: Props = $props();

    const MARGIN = { top: 8, right: 10, bottom: 26, left: 10 };
    /** Grab zone on each edge of the selection, in px. */
    const HANDLE = 8;

    let plotWidth = $state(0);
    let plotHeight = $state(0);
    let hostEl = $state<HTMLDivElement>();
    let hover = $state<{
        x: number;
        y: number;
        label: string;
        value: string;
        detail: string;
    } | null>(null);

    const clipId = `cadence-clip-${Math.random().toString(36).slice(2)}`;

    const innerWidth = $derived(Math.max(0, plotWidth - MARGIN.left - MARGIN.right));
    const innerHeight = $derived(Math.max(0, plotHeight - MARGIN.top - MARGIN.bottom));

    const dist = $derived(buildCadenceDistribution(series));

    const colorOf = (key: string) => colors[key] ?? 'var(--module-fill)';

    // Bars sit on whole spm and are drawn a unit wide, so the axis runs half a
    // step past each end and the columns tile it exactly.
    const x = $derived(
        d3
            .scaleLinear()
            .domain([dist.domain[0] - 0.5, dist.domain[1] + 0.5])
            .range([0, Math.max(1, innerWidth)])
    );
    const y = $derived(
        d3
            .scaleLinear()
            .domain([0, dist.peak || 1])
            .range([Math.max(0, innerHeight), 0])
    );

    const xTicks = $derived(d3.ticks(dist.domain[0], dist.domain[1], 4));

    /** Running totals per series, so the counters stack into the silhouette. */
    const stacks = $derived.by(() => {
        const out: Float64Array[] = [];
        let below: Float64Array | null = null;
        for (const s of dist.series) {
            const cumulative = new Float64Array(s.columns.length);
            for (let i = 0; i < cumulative.length; i++) {
                cumulative[i] = (below ? below[i] : 0) + s.columns[i];
            }
            out.push(cumulative);
            below = cumulative;
        }
        return out;
    });

    /** Step outline of one stacked band, closed over the one beneath it. */
    const seriesPaths = $derived.by(() => {
        if (innerWidth <= 0 || innerHeight <= 0 || dist.peak <= 0) return [];
        return dist.series.map((s, index) => {
            const upper = stacks[index];
            const lower = index > 0 ? stacks[index - 1] : null;
            const parts: string[] = [`M${x(-0.5)},${y(lower ? lower[0] : 0)}`];
            for (let spm = 0; spm < upper.length; spm++) {
                const top = y(upper[spm]);
                parts.push(`L${x(spm - 0.5)},${top}`, `L${x(spm + 0.5)},${top}`);
            }
            for (let spm = upper.length - 1; spm >= 0; spm--) {
                const bottom = y(lower ? lower[spm] : 0);
                parts.push(`L${x(spm + 0.5)},${bottom}`, `L${x(spm - 0.5)},${bottom}`);
            }
            parts.push('Z');
            return { key: s.key, d: parts.join('') };
        });
    });

    // --- Brush -----------------------------------------------------------
    // A selection is a half-open span of whole spm: `from` is the first bar it
    // holds, `to` the first bar past it. Drawn on the bar edges, which is why
    // both map through x() at a half-step offset.
    type DragKind = 'new' | 'move' | 'resize-from' | 'resize-to';

    let drag = $state<{
        kind: DragKind;
        /**
         * The bar the drag pivots on, fixed for its whole duration: the edge
         * being dragged is free, the opposite one must not move. Re-reading it
         * from the live span instead lets it drift every time the span is
         * clamped or the handles cross.
         */
        anchor: number;
        span: Span;
        /** For a move: where inside the span the pointer grabbed it. */
        grab: number;
        moved: boolean;
    } | null>(null);
    let hoverKind = $state<DragKind | null>(null);

    const committed = $derived.by((): Span | null => {
        if (!range) return null;
        const from = typeof range.min === 'number' ? range.min : dist.domain[0];
        const to = typeof range.max === 'number' ? range.max : dist.domain[1] + 1;
        return { from, to };
    });

    /** What the brush shows right now: the live drag, else the committed range. */
    const selection = $derived(drag ? drag.span : committed);

    const selectionLabel = $derived.by(() => {
        const s = selection;
        if (!s) return null;
        const openEnded = s.to > dist.domain[1];
        const first = Math.max(dist.domain[0], Math.round(s.from));
        if (openEnded) return `${first}+ spm`;
        return `${first}–${Math.round(s.to)} spm`;
    });

    /** Weight inside the selection — what the headline number reports. */
    const selectedWeight = $derived.by(() => {
        const s = selection;
        if (!s) return dist.total;
        let sum = 0;
        const from = Math.max(0, Math.floor(s.from));
        const to = Math.min(dist.columns.length, Math.ceil(s.to));
        for (let spm = from; spm < to; spm++) sum += dist.columns[spm];
        return sum;
    });

    /** What each counter contributes to the selection — the split, in numbers. */
    const seriesReadout = $derived.by(() =>
        dist.series.map((s) => {
            const span = selection;
            const from = span ? Math.max(0, Math.floor(span.from)) : 0;
            const to = span ? Math.min(s.columns.length, Math.ceil(span.to)) : s.columns.length;
            let value = 0;
            for (let spm = from; spm < to; spm++) value += s.columns[spm];
            return { key: s.key, label: s.label, value };
        })
    );

    function share(value: number): string {
        if (dist.total <= 0) return '0%';
        const pct = (value / dist.total) * 100;
        if (pct > 0 && pct < 0.1) return '<0.1%';
        return `${(Math.round(pct * 10) / 10).toLocaleString()}%`;
    }

    /** Pixel bounds of a span, on the bar edges it encloses. */
    function spanPixels(s: Span): [number, number] {
        return [x(s.from - 0.5), x(s.to - 0.5)];
    }

    function commit(span: Span | null, origin: string) {
        if (!span) {
            trackControl('cadence-distribution', origin, 'clear');
            onSelect?.(null);
            return;
        }
        trackControl('cadence-distribution', origin, 'set');
        onSelect?.({
            min: Math.max(dist.domain[0], Math.round(span.from)),
            // Reaching the last bar means "and everything faster": the fast tail
            // lives beyond the axis, and stopping at the edge would silently
            // drop the packets the user just asked for.
            max: span.to > dist.domain[1] ? null : Math.round(span.to),
        });
    }

    /** Pointer x in spm, clamped to the axis. */
    function cadenceAt(event: PointerEvent, target: SVGGElement): number {
        const rect = target.getBoundingClientRect();
        const px = Math.max(0, Math.min(innerWidth, event.clientX - rect.left));
        return x.invert(px);
    }

    /** Which part of the brush a pixel is over, if any. */
    function hitTest(px: number): DragKind | null {
        const s = committed;
        if (!s) return null;
        const [a, b] = spanPixels(s);
        if (Math.abs(px - a) <= HANDLE) return 'resize-from';
        if (Math.abs(px - b) <= HANDLE) return 'resize-to';
        if (px > a && px < b) return 'move';
        return null;
    }

    // Cross-filtering follows the brush rather than waiting for the release, so
    // dragging it across the axis reads as a sweep over the constellation. One
    // commit per frame at most: the page rebuilds every point's match on each.
    let commitRaf = 0;
    function scheduleCommit() {
        if (commitRaf) return;
        commitRaf = requestAnimationFrame(() => {
            commitRaf = 0;
            // Read the span at fire time, not at schedule time: the pointer has
            // moved on since, and committing the older one fights the newer.
            if (drag) commit(drag.span, 'brush');
        });
    }

    function onPointerDown(event: PointerEvent) {
        const g = event.currentTarget as SVGGElement;
        g.setPointerCapture(event.pointerId);
        const rect = g.getBoundingClientRect();
        const px = event.clientX - rect.left;
        const at = cadenceAt(event, g);
        const kind = hitTest(px) ?? 'new';
        const base = committed;
        const bar = Math.round(at);

        // The dragged handle pivots on the far end of the selection; a fresh
        // brush pivots on wherever it was started.
        let anchor = bar;
        if (base && kind === 'resize-from') anchor = base.to - 1;
        else if (base && kind === 'resize-to') anchor = base.from;

        drag = {
            kind,
            anchor,
            span: base && kind !== 'new' ? { ...base } : spanFromBars(bar, bar, dist.domain),
            grab: base ? at - base.from : 0,
            moved: false,
        };
        hover = null;
    }

    function onPointerMove(event: PointerEvent) {
        const g = event.currentTarget as SVGGElement;
        const at = cadenceAt(event, g);

        if (!drag) {
            const rect = g.getBoundingClientRect();
            hoverKind = hitTest(event.clientX - rect.left);
            showTooltip(event, at);
            return;
        }

        const current = drag;
        let span: Span;

        if (current.kind === 'move') {
            span = shiftSpan(current.span, at - current.grab, dist.domain);
        } else {
            span = spanFromBars(current.anchor, Math.round(at), dist.domain);
        }

        drag = { ...current, span, moved: true };
        scheduleCommit();
    }

    function onPointerUp(event: PointerEvent) {
        const g = event.currentTarget as SVGGElement;
        g.releasePointerCapture(event.pointerId);
        const current = drag;
        drag = null;
        if (!current) return;

        // A click outside the brush drops the selection; a click on it keeps it.
        if (!current.moved) {
            if (current.kind === 'new' && committed) commit(null, 'brush');
            return;
        }
        commit(current.span, 'brush');
    }

    function showTooltip(event: PointerEvent, at: number) {
        if (!hostEl) return;
        const spm = Math.round(at);
        if (spm < 0 || spm >= dist.columns.length) {
            hover = null;
            return;
        }
        const rect = hostEl.getBoundingClientRect();
        const split = dist.series
            .filter((s) => s.columns[spm] > 0)
            .map((s) => `${s.label} ${formatValue(s.columns[spm])}`)
            .join(' · ');
        hover = {
            x: event.clientX - rect.left,
            y: event.clientY - rect.top,
            label: `${spm.toLocaleString()} spm`,
            value: `${formatValue(dist.columns[spm])} · ${share(dist.columns[spm])}`,
            // Only worth a line when the counters actually disagree here.
            detail: dist.series.length > 1 ? split : '',
        };
    }

    const cursor = $derived.by(() => {
        if (drag) return drag.kind === 'move' ? 'grabbing' : 'ew-resize';
        if (hoverKind === 'move') return 'grab';
        if (hoverKind) return 'ew-resize';
        return 'crosshair';
    });
</script>

<div class="distribution" bind:this={hostEl} data-testid={testId}>
    <header class="head">
        <div class="titles">
            <h3>
                {#if onToggleColorBy}
                    <button
                        class="color-by"
                        class:active={colorByActive}
                        type="button"
                        role="radio"
                        aria-checked={colorByActive}
                        aria-label="Color the constellation by cadence band"
                        title="Color the constellation by cadence band"
                        onclick={() => {
                            trackControl('cadence-distribution', 'color-by', 'cadence');
                            onToggleColorBy?.();
                        }}
                    ></button>
                {/if}
                Cadence
            </h3>
        </div>
        {#if range}
            <button class="clear" type="button" onclick={() => commit(null, 'header')}>
                Clear ✕
            </button>
        {/if}
    </header>

    <div class="readout">
        <span class="value">
            {formatValue(selectedWeight)}
        </span>
        {#if selection && selectionLabel}
            <span class="label">{selectionLabel}</span>
        {/if}
    </div>

    <div
        class="plot"
        bind:clientWidth={plotWidth}
        bind:clientHeight={plotHeight}
        role="presentation"
    >
        {#if plotWidth > 0 && plotHeight > 0}
            <svg width={plotWidth} height={plotHeight} aria-hidden="true">
                <defs>
                    <clipPath id={clipId}>
                        {#if selection}
                            {@const [a, b] = spanPixels(selection)}
                            <rect x={a} y={0} width={Math.max(0, b - a)} height={innerHeight} />
                        {/if}
                    </clipPath>
                </defs>

                <g transform="translate({MARGIN.left},{MARGIN.top})">
                    {#each dist.bands as band (band.label)}
                        {#if band.min > 0 && band.min <= dist.domain[1]}
                            <line
                                class="band-rule"
                                x1={x(band.min - 0.5)}
                                x2={x(band.min - 0.5)}
                                y1={0}
                                y2={innerHeight}
                            />
                        {/if}
                    {/each}

                    {#each seriesPaths as path (path.key)}
                        <path
                            class="area"
                            class:dimmed={!!selection}
                            d={path.d}
                            fill={colorOf(path.key)}
                        />
                    {/each}
                    {#if selection}
                        {@const [a, b] = spanPixels(selection)}
                        <rect
                            class="brush-body"
                            x={a}
                            y={0}
                            width={Math.max(0, b - a)}
                            height={innerHeight}
                        />
                        {#each seriesPaths as path (path.key)}
                            <path
                                class="area selected"
                                d={path.d}
                                fill={colorOf(path.key)}
                                clip-path="url(#{clipId})"
                            />
                        {/each}
                        <line class="brush-edge" x1={a} x2={a} y1={0} y2={innerHeight} />
                        <line class="brush-edge" x1={b} x2={b} y1={0} y2={innerHeight} />
                        {#each [a, b] as edge (edge)}
                            <rect
                                class="brush-grip"
                                x={edge - 2}
                                y={innerHeight / 2 - 12}
                                width={4}
                                height={24}
                                rx={2}
                            />
                        {/each}
                    {/if}

                    <line class="axis" x1={0} x2={innerWidth} y1={innerHeight} y2={innerHeight} />
                    {#each xTicks as tick (tick)}
                        <text class="tick" x={x(tick)} y={innerHeight + 15}>{tick}</text>
                    {/each}

                    <!-- svelte-ignore a11y_no_static_element_interactions -->
                    <g
                        class="capture"
                        onpointerdown={onPointerDown}
                        onpointermove={onPointerMove}
                        onpointerup={onPointerUp}
                        onpointerleave={() => {
                            hover = null;
                            hoverKind = null;
                        }}
                    >
                        <rect
                            x={0}
                            y={0}
                            width={Math.max(0, innerWidth)}
                            height={Math.max(0, innerHeight)}
                            style:cursor
                        />
                    </g>
                </g>
            </svg>
        {/if}

        {#if hover && !drag}
            <div class="chart-tooltip" style={`left:${hover.x + 12}px; top:${hover.y + 12}px;`}>
                <strong>{hover.label}</strong>
                <span>{hover.value}</span>
                {#if hover.detail}
                    <span>{hover.detail}</span>
                {/if}
            </div>
        {/if}
    </div>

    <ul class="legend">
        {#each seriesReadout as row (row.key)}
            <li>
                <span class="swatch" style:background={colorOf(row.key)}></span>
                <span class="legend-label">{row.label}</span>
                <span class="legend-share">{share(row.value)}</span>
            </li>
        {/each}
    </ul>

    {#if dist.unknown > 0}
        <p class="notes">
            {formatValue(dist.unknown)} with no active time recorded, so no cadence.
        </p>
    {/if}
</div>

<style>
    .distribution {
        position: relative;
        display: flex;
        flex-direction: column;
        gap: 0.6rem;
        width: 100%;
        height: 100%;
        min-height: 0;
    }

    .head {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 0.5rem;
    }

    h3 {
        display: flex;
        align-items: center;
        gap: 0.4rem;
        margin: 0;
        font-size: var(--text-small);
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: hsl(var(--foreground));
    }

    /* Same control the pies carry, kept here because cadence has no pie. */
    .color-by {
        flex: none;
        width: 14px;
        height: 14px;
        padding: 0;
        border: 1.5px solid hsl(var(--muted-foreground));
        border-radius: 50%;
        background: transparent;
        cursor: pointer;
        transition:
            border-color 0.16s ease,
            background-color 0.16s ease;
    }

    .color-by:hover {
        border-color: var(--module-accent);
    }

    .color-by.active {
        border-color: var(--module-accent);
        background: var(--module-accent);
    }

    .clear {
        flex: none;
        border: 1px solid var(--border, hsl(var(--border)));
        border-radius: var(--radius-md);
        padding: 0.2rem 0.45rem;
        font-size: var(--text-label);
        white-space: nowrap;
        color: hsl(var(--muted-foreground));
        background: transparent;
        cursor: pointer;
    }

    .clear:hover {
        color: hsl(var(--foreground));
    }

    .readout {
        display: flex;
        flex-direction: column;
        line-height: 1.15;
    }

    .readout .value {
        font-size: var(--text-subheading);
        font-weight: 700;
        color: var(--module-accent);
        font-variant-numeric: tabular-nums;
    }

    .readout .label {
        font-size: var(--text-label);
        color: hsl(var(--muted-foreground));
    }

    .plot {
        position: relative;
        flex: 1;
        min-height: 8rem;
        width: 100%;
    }

    .area {
        fill-opacity: 0.75;
    }

    .area.dimmed {
        fill-opacity: 0.16;
    }

    .area.selected {
        fill-opacity: 0.9;
    }

    .brush-body {
        fill: color-mix(in srgb, hsl(var(--foreground)) 6%, transparent);
    }

    .brush-edge {
        stroke: hsl(var(--muted-foreground));
        stroke-width: 1;
        opacity: 0.8;
    }

    .brush-grip {
        fill: hsl(var(--muted-foreground));
        opacity: 0.9;
    }

    .band-rule {
        stroke: var(--chart-grid);
        stroke-width: 1;
    }

    .tick {
        fill: hsl(var(--muted-foreground));
        font-size: var(--text-label);
        text-anchor: middle;
    }

    .axis {
        stroke: var(--chart-axis);
        stroke-width: 1;
    }

    .capture rect {
        fill: transparent;
    }

    .legend {
        flex: none;
        display: flex;
        flex-direction: column;
        gap: 0.2rem;
        margin: 0;
        padding: 0;
        list-style: none;
    }

    .legend li {
        display: grid;
        grid-template-columns: 0.55rem 1fr auto;
        align-items: center;
        gap: 0.45rem;
        font-size: var(--text-label);
        color: hsl(var(--muted-foreground));
    }

    .swatch {
        width: 0.55rem;
        height: 0.55rem;
        border-radius: 2px;
    }

    .legend-label {
        color: hsl(var(--foreground));
    }

    .legend-share {
        font-variant-numeric: tabular-nums;
    }

    .notes {
        flex: none;
        margin: 0;
        font-size: var(--text-label);
        line-height: 1.35;
        color: hsl(var(--muted-foreground));
    }
</style>
