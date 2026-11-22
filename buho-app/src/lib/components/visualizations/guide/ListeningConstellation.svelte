<script lang="ts">
    import * as d3 from 'd3';
    import type { ConnectablePoint } from '#lib/data/queries/behaviorQueries.ts';
    import { chartFont, peakColor, vizColors } from '#lib/visualizations/themeColors.ts';
    import { themeStore } from '#lib/stores/themeStore.svelte.ts';
    import {
        DAY_MS,
        artistOf,
        clockOf,
        dayStartOf,
        trackOf,
        type FocusDay,
    } from '#lib/visualizations/listeningStory.ts';

    /**
     * The guide's canvas, drawn with the Explorer's constellation grammar: one
     * square per play, the day left to right, the time of day top to bottom with
     * midnight at the top. Only the horizontal window changes between stages, so
     * the reader is always looking at the same chart.
     *
     * The horizontal position is the *day*, not the timestamp — the hour is
     * already the vertical axis, and plotting it on both would tilt every day
     * into a diagonal.
     */
    interface Props {
        /** All plays, oldest first (as `getAllConnectablePoints` returns them). */
        points: ConnectablePoint[];
        /** The day the middle stages zoom in on. */
        focus: FocusDay | null;
        /** 0 everything · 1 one play · 2 that day · 3 the months around it · 4 everything. */
        stage: number;
    }

    let { points, focus, stage }: Props = $props();

    const MARGIN = { top: 16, right: 18, bottom: 34, left: 46 };
    const TRANSITION_MS = 850;
    /** Extra time after the zoom settles, for the annotations to fade in. */
    const ANNOTATION_MS = 500;
    /** Above this many new points, they fade in together instead of one by one. */
    const STAGGER_LIMIT = 400;
    const HOVER_RADIUS = 14;
    /** Window widths, in days, for the zoomed stages. */
    const DAY_WINDOW = 1;
    const MONTHS_WINDOW = 60;

    let canvas = $state<HTMLCanvasElement | undefined>();
    let width = $state(0);
    let hovered = $state<{ point: ConnectablePoint; cx: number; cy: number } | null>(null);

    const height = $derived(Math.round(Math.min(520, Math.max(300, (width || 900) * 0.44))));

    /** Each play's day, in the points' own time base. Sorted, like `points`. */
    const dayX = $derived(points.map(dayStartOf));

    const dataDomain = $derived<[number, number]>(
        points.length > 0 ? [dayX[0], dayX[dayX.length - 1] + DAY_MS] : [0, DAY_MS]
    );

    const bisectDay = d3.bisectLeft;

    /** Index range of the focus day inside the (x-sorted) points. */
    const focusRange = $derived.by((): [number, number] => {
        if (!focus) return [0, 0];
        return [bisectDay(dayX, focus.startMs), bisectDay(dayX, focus.startMs + DAY_MS)];
    });

    /** A window of `days` centred on the focus day, slid back inside the data. */
    function centred(days: number): [number, number] {
        const [dataMin, dataMax] = dataDomain;
        const span = days * DAY_MS;
        if (!focus || span >= dataMax - dataMin) return [dataMin, dataMax];
        const middle = focus.startMs + DAY_MS / 2;
        let low = middle - span / 2;
        let high = middle + span / 2;
        if (low < dataMin) {
            high += dataMin - low;
            low = dataMin;
        }
        if (high > dataMax) {
            low -= high - dataMax;
            high = dataMax;
        }
        return [low, high];
    }

    function domainForStage(value: number): [number, number] {
        if (!focus) return dataDomain;
        if (value === 1 || value === 2) return centred(DAY_WINDOW);
        if (value === 3) return centred(MONTHS_WINDOW);
        return dataDomain;
    }

    function rangeForStage(value: number, domain: [number, number]): [number, number] {
        if (focus) {
            const [low, high] = focusRange;
            if (value === 1) return [low, Math.min(low + 1, high)];
            if (value === 2) return [low, high];
        }
        return [bisectDay(dayX, domain[0]), bisectDay(dayX, domain[1])];
    }

    /* --- animation state (deliberately not reactive: the frame loop drives it) --- */
    let currentDomain: [number, number] = [0, DAY_MS];
    let fromDomain: [number, number] = [0, DAY_MS];
    let toDomain: [number, number] = [0, DAY_MS];
    let previousRange: [number, number] = [0, 0];
    let targetRange: [number, number] = [0, 0];
    let animationStart = 0;
    let frame = 0;
    let settled = true;
    let renderedStage = -1;
    let tree: d3.Quadtree<{ cx: number; cy: number; point: ConnectablePoint }> | null = null;

    function prefersReducedMotion(): boolean {
        return (
            typeof window !== 'undefined' &&
            typeof window.matchMedia === 'function' &&
            window.matchMedia('(prefers-reduced-motion: reduce)').matches
        );
    }

    function stopAnimation() {
        if (frame) cancelAnimationFrame(frame);
        frame = 0;
    }

    function startTransition(instant: boolean) {
        const nextDomain = domainForStage(stage);
        const nextRange = rangeForStage(stage, nextDomain);

        previousRange = renderedStage < 0 ? nextRange : targetRange;
        targetRange = nextRange;
        fromDomain = renderedStage < 0 ? nextDomain : currentDomain;
        toDomain = nextDomain;
        renderedStage = stage;
        tree = null;
        hovered = null;

        stopAnimation();
        if (instant || prefersReducedMotion()) {
            currentDomain = nextDomain;
            settled = true;
            draw(1);
            return;
        }

        settled = false;
        animationStart = performance.now();
        frame = requestAnimationFrame(tick);
    }

    function tick(now: number) {
        const elapsed = now - animationStart;
        const progress = Math.min(1, elapsed / TRANSITION_MS);
        const eased = d3.easeCubicInOut(progress);
        currentDomain = [
            fromDomain[0] + (toDomain[0] - fromDomain[0]) * eased,
            fromDomain[1] + (toDomain[1] - fromDomain[1]) * eased,
        ];
        draw(eased, elapsed);

        if (elapsed < TRANSITION_MS + ANNOTATION_MS) {
            frame = requestAnimationFrame(tick);
        } else {
            frame = 0;
            settled = true;
            draw(1);
        }
    }

    /** Points visible right now, as an index range into `points`. */
    function visibleRange(progress: number): [number, number] {
        // While the window is widening, slice by the window itself so points
        // stream in from the edges instead of appearing all at once.
        if (stage !== 1 && stage !== 2) {
            return [bisectDay(dayX, currentDomain[0]), bisectDay(dayX, currentDomain[1])];
        }
        if (stage === 2 && progress < 1) {
            const [low, high] = targetRange;
            const grown = Math.min(high, low + Math.ceil((high - low) * progress));
            return [low, Math.max(grown, previousRange[1])];
        }
        return targetRange;
    }

    /** Explorer-sized squares when the whole history is on screen, larger when zoomed. */
    function pointSize(spanMs: number): number {
        const days = spanMs / DAY_MS;
        if (days <= 2) return 8;
        if (days <= 90) return 4;
        return 2;
    }

    function draw(progress: number, elapsed = TRANSITION_MS + ANNOTATION_MS) {
        if (!canvas || width < 10) return;
        const context = canvas.getContext('2d');
        // jsdom has no 2D context; nothing to draw and nothing to fail on.
        if (!context) return;

        const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
        canvas.width = Math.floor(width * dpr);
        canvas.height = Math.floor(height * dpr);
        context.setTransform(dpr, 0, 0, dpr, 0, 0);
        context.clearRect(0, 0, width, height);

        const colors = vizColors();
        const left = MARGIN.left;
        const right = width - MARGIN.right;
        const top = MARGIN.top;
        const bottom = height - MARGIN.bottom;
        if (right <= left || bottom <= top) return;

        const x = d3
            .scaleUtc()
            .domain([new Date(currentDomain[0]), new Date(currentDomain[1])])
            .range([left, right]);
        // Midnight at the top, like the Explorer's constellation.
        const y = d3.scaleLinear().domain([0, 24]).range([top, bottom]);

        drawGrid(context, x, y, colors, left, right, top, bottom);
        drawPoints(context, x, y, progress);

        if (stage === 1 && focus && focusRange[0] < focusRange[1]) {
            const annotate = Math.max(0, Math.min(1, (elapsed - TRANSITION_MS) / ANNOTATION_MS));
            drawCrosshair(context, x, y, colors, left, bottom, annotate);
        }

        if (hovered) {
            const size = pointSize(currentDomain[1] - currentDomain[0]) + 6;
            context.strokeStyle = colors.foreground;
            context.lineWidth = 1.5;
            context.strokeRect(hovered.cx - size / 2, hovered.cy - size / 2, size, size);
        }
    }

    function drawGrid(
        context: CanvasRenderingContext2D,
        x: d3.ScaleTime<number, number>,
        y: d3.ScaleLinear<number, number>,
        colors: ReturnType<typeof vizColors>,
        left: number,
        right: number,
        top: number,
        bottom: number
    ) {
        context.font = chartFont();
        context.strokeStyle = colors.border;
        context.fillStyle = colors.mutedForeground;
        context.lineWidth = 1;

        context.textAlign = 'right';
        context.textBaseline = 'middle';
        for (let hour = 0; hour <= 24; hour += 3) {
            const py = y(hour);
            context.globalAlpha = hour % 6 === 0 ? 0.4 : 0.18;
            context.beginPath();
            context.moveTo(left, py);
            context.lineTo(right, py);
            context.stroke();
            context.globalAlpha = 1;
            if (hour % 6 === 0) {
                context.fillText(`${hour}h`, left - 8, py);
            }
        }

        context.textAlign = 'center';
        context.textBaseline = 'top';
        const spanMs = currentDomain[1] - currentDomain[0];
        if (spanMs <= 2.5 * DAY_MS) {
            // One day on screen: a single label, since every play shares its date.
            const label = d3.utcFormat('%a %e %b %Y')(
                new Date((currentDomain[0] + currentDomain[1]) / 2)
            );
            context.fillText(label, (left + right) / 2, bottom + 8);
        } else {
            const ticks = x.ticks(width < 620 ? 4 : 7);
            const format = x.tickFormat();
            for (const tick of ticks) {
                const px = x(tick);
                if (px < left || px > right) continue;
                context.globalAlpha = 0.18;
                context.beginPath();
                context.moveTo(px, top);
                context.lineTo(px, bottom);
                context.stroke();
                context.globalAlpha = 1;
                context.fillText(format(tick), px, bottom + 8);
            }
        }
    }

    function drawPoints(
        context: CanvasRenderingContext2D,
        x: d3.ScaleTime<number, number>,
        y: d3.ScaleLinear<number, number>,
        progress: number
    ) {
        const [low, high] = visibleRange(progress);
        if (high <= low) return;

        const size = pointSize(currentDomain[1] - currentDomain[0]);
        const half = size / 2;
        const [previousLow, previousHigh] = previousRange;
        // Zooming back into a subset: nothing is new, so nothing fades.
        const shrinking = previousLow <= low && previousHigh >= high;
        const overlap = Math.max(0, Math.min(previousHigh, high) - Math.max(previousLow, low));
        const newCount = high - low - overlap;
        const stagger = !shrinking && newCount > 0 && newCount <= STAGGER_LIMIT;

        const scaled: { cx: number; cy: number; point: ConnectablePoint }[] = [];
        let seen = 0;

        context.fillStyle = peakColor('listening');
        for (let i = low; i < high; i++) {
            const isNew = i < previousLow || i >= previousHigh;
            let alpha = 1;
            if (!shrinking && isNew) {
                if (stagger) {
                    // Chronological: the day writes itself out play by play.
                    const share = newCount > 1 ? seen / (newCount - 1) : 0;
                    alpha = Math.max(0, Math.min(1, (progress - share * 0.65) / 0.35));
                } else {
                    alpha = progress;
                }
                seen += 1;
            }
            if (alpha <= 0.01) continue;

            const cx = x(dayX[i]);
            const cy = y(points[i].y);
            context.globalAlpha = alpha * (size > 2 ? 0.9 : 0.7);
            context.fillRect(cx - half, cy - half, size, size);
            if (settled && (stage === 0 || stage === 4)) {
                scaled.push({ cx, cy, point: points[i] });
            }
        }
        context.globalAlpha = 1;

        if (settled && scaled.length > 0 && !tree) {
            tree = d3
                .quadtree<{ cx: number; cy: number; point: ConnectablePoint }>()
                .x((d) => d.cx)
                .y((d) => d.cy)
                .addAll(scaled);
        }
    }

    /** Dashed guides from the single play out to both axes, with its clock time. */
    function drawCrosshair(
        context: CanvasRenderingContext2D,
        x: d3.ScaleTime<number, number>,
        y: d3.ScaleLinear<number, number>,
        colors: ReturnType<typeof vizColors>,
        left: number,
        bottom: number,
        alpha: number
    ) {
        if (alpha <= 0) return;
        const point = points[focusRange[0]];
        if (!point) return;
        const cx = x(dayX[focusRange[0]]);
        const cy = y(point.y);

        context.save();
        context.globalAlpha = alpha * 0.8;
        context.setLineDash([3, 4]);
        context.strokeStyle = colors.mutedForeground;
        context.lineWidth = 1;
        context.beginPath();
        context.moveTo(left, cy);
        context.lineTo(cx, cy);
        context.moveTo(cx, cy);
        context.lineTo(cx, bottom);
        context.stroke();
        context.setLineDash([]);

        context.globalAlpha = alpha;
        context.fillStyle = colors.foreground;
        context.font = chartFont('small');
        context.textAlign = 'left';
        context.textBaseline = 'bottom';
        context.fillText(clockOf(point), left + 6, cy - 6);
        context.restore();
    }

    function onPointerMove(event: PointerEvent) {
        if (!tree || !canvas) return;
        const rect = canvas.getBoundingClientRect();
        const found = tree.find(event.clientX - rect.left, event.clientY - rect.top, HOVER_RADIUS);
        hovered = found ? { point: found.point, cx: found.cx, cy: found.cy } : null;
    }

    function onPointerLeave() {
        hovered = null;
    }

    $effect(() => {
        // Any of these changes the picture: re-run the zoom (instantly when only
        // the canvas geometry or the theme moved).
        void points;
        void focus;
        void width;
        void height;
        void themeStore.theme;
        const nextStage = stage;
        startTransition(nextStage === renderedStage);
    });

    // Hovering only adds a highlight box, so it redraws in place.
    $effect(() => {
        void hovered;
        if (settled) draw(1);
    });

    $effect(() => () => stopAnimation());
</script>

<div class="constellation" bind:clientWidth={width}>
    {#if points.length === 0}
        <p class="empty-canvas">No plays to draw yet.</p>
    {:else}
        <!-- The label lives on the wrapper: a <canvas> cannot take role="img". -->
        <div
            role="img"
            aria-label="Every play as a square: horizontally the day it happened, vertically the time of day"
        >
            <canvas
                bind:this={canvas}
                style:width="{width}px"
                style:height="{height}px"
                aria-hidden="true"
                onpointermove={onPointerMove}
                onpointerleave={onPointerLeave}
            ></canvas>
        </div>
        {#if hovered}
            <div
                class="chart-tooltip"
                style:left="{hovered.cx}px"
                style:top="{hovered.cy}px"
                aria-hidden="true"
            >
                <strong>{trackOf(hovered.point)}</strong>
                <span>{artistOf(hovered.point)}</span>
                <span class="tip-time">{clockOf(hovered.point)}</span>
            </div>
        {/if}
    {/if}
</div>

<style>
    .constellation {
        position: relative;
        width: 100%;
        border: 1px solid hsl(var(--border));
        border-radius: var(--radius-lg);
        background: hsl(var(--card));
        overflow: hidden;
    }

    canvas {
        display: block;
        touch-action: pan-y;
    }

    .empty-canvas {
        padding: 6rem 1rem;
        text-align: center;
        color: hsl(var(--muted-foreground));
        font-size: var(--text-body);
    }

    /* Centred above the hovered point, and cut short rather than wrapped. */
    .chart-tooltip {
        transform: translate(-50%, calc(-100% - 0.75rem));
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .chart-tooltip .tip-time {
        font-family: var(--font-mono);
        color: hsl(var(--muted-foreground));
    }
</style>
