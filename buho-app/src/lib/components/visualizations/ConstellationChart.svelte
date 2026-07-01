<script lang="ts">
    import { onDestroy, onMount } from "svelte";
    import * as d3 from "d3";
    import type { ConnectablePoint } from "$lib/data/queries/behaviorQueries";
    import { OTHER_COLOR } from "$lib/utils/dimensionColors";
    import { hasOpenModifier } from "$lib/utils/spotify";
    import { vizColors } from "$lib/visualizations/themeColors";
    import { themeStore } from "$lib/stores/themeStore.svelte";

    interface ColorCategory {
        value: string;
        color: string;
    }

    /** Tooltip content for a hovered point, built by the caller from metadata. */
    interface TooltipInfo {
        title?: string;
        lines?: string[];
        hint?: string;
    }

    interface Props {
        data: ConnectablePoint[];
        width: number;
        height: number;
        timeDomain?: [number, number] | null;
        viewTimeDomain?: [number, number] | null;
        viewHourDomain?: [number, number] | null;
        // Optional: when the caller keeps a stable `data` reference and only
        // mutates the `matched` flag in place, it bumps this counter to trigger a
        // redraw without rebuilding scaledData/quadtree (cf. /spotify/explore).
        // Leave at 0 → historical behavior.
        matchVersion?: number;
        // Coloring by dimension. `colorField` = raw field carried by the points
        // (e.g. "platform"); `colorCategories` = ordered values + colors (the last
        // typically being "Other"). When provided, the matched points and the
        // satellite barcharts are colored/stacked by this dimension.
        colorField?: string | null;
        colorCategories?: ColorCategory[];
        // Weight a point contributes to the satellite bar charts (monthly + hourly).
        // Default 1 → bars count points. The Google Maps explorer passes the active
        // measure (presence minutes / km) so the temporal bars track the toggle.
        barValue?: (point: ConnectablePoint) => number;
        // Tooltip content for the hovered point, derived from its metadata.
        // When omitted, no tooltip is shown.
        formatTooltip?: (metadata: Record<string, unknown>) => TooltipInfo;
        // ⌘/Ctrl+click handler. Receives the clicked point's metadata; returns
        // true if it handled the click (the chart then prevents default).
        onPointClick?: (
            metadata: Record<string, unknown>,
            event: MouseEvent,
        ) => boolean;
    }

    let {
        data = [],
        width = 800,
        height = 600,
        timeDomain = null,
        viewTimeDomain = $bindable(null),
        viewHourDomain = $bindable(null),
        matchVersion = 0,
        colorField = null,
        colorCategories = [],
        barValue = () => 1,
        formatTooltip,
        onPointClick,
    }: Props = $props();

    const colorActive = $derived(!!colorField && colorCategories.length > 0);

    // value → color and value → segment index (for stacking). An unknown value
    // falls back to "Other" if present, otherwise to the last category.
    const colorMap = $derived.by(() => {
        const m = new Map<string, string>();
        for (const c of colorCategories) m.set(c.value, c.color);
        return m;
    });
    const valueIndex = $derived.by(() => {
        const m = new Map<string, number>();
        colorCategories.forEach((c, i) => m.set(c.value, i));
        return m;
    });
    const otherIndex = $derived(
        colorCategories.findIndex((c) => c.value === "Other"),
    );

    function pointColorValue(point: ConnectablePoint): string {
        return colorField
            ? ((point as unknown as Record<string, unknown>)[
                  colorField
              ] as string)
            : "";
    }
    function colorFor(point: ConnectablePoint): string {
        return colorMap.get(pointColorValue(point)) ?? OTHER_COLOR;
    }
    function segmentIndex(point: ConnectablePoint): number {
        const i = valueIndex.get(pointColorValue(point));
        if (i !== undefined) return i;
        return otherIndex; // -1 if no "Other" bucket → ignored in the stacking
    }

    // --- Coloring animation (barchart sweep) -----------------------------
    // On entering coloring mode (or on dimension change), a front sweeps the
    // satellite barcharts — dates left to right, hours top to bottom — and each
    // bar colors as it's reached, with a slight thickness "pop". The scatterplot
    // is NOT animated (too costly: 167k points re-sorted per frame).
    // `colorAnimProgress` = 1 at rest (everything colored).
    const COLOR_ANIM_MS = 800; // duration of the end-to-end sweep
    const POP_SPAN = 0.15; // width (in progress units) of the pop window
    // Progress goes up to 1 + POP_SPAN: this surplus lets the pop wave of the last
    // bar (threshold t≈1) finish instead of being cut off abruptly.
    const COLOR_ANIM_END = 1 + POP_SPAN;
    let colorAnimProgress = COLOR_ANIM_END;
    let colorAnimRaf: number | null = null;
    let colorAnimStart = 0;

    function startColorAnim() {
        // Respects system preferences: no sweep if reduced motion.
        if (
            typeof window !== "undefined" &&
            window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
        ) {
            colorAnimProgress = 1;
            return;
        }
        colorAnimStart = performance.now();
        colorAnimProgress = 0;
        if (colorAnimRaf !== null) cancelAnimationFrame(colorAnimRaf);
        const step = () => {
            const t = Math.min(
                1,
                (performance.now() - colorAnimStart) / COLOR_ANIM_MS,
            );
            colorAnimProgress = d3.easeQuadOut(t) * COLOR_ANIM_END;
            // Only the barcharts are animated (the scatterplot stays static/colored).
            drawBottomPanel();
            drawLeftPanel();
            if (t < 1) {
                colorAnimRaf = requestAnimationFrame(step);
            } else {
                colorAnimRaf = null;
                colorAnimProgress = COLOR_ANIM_END;
            }
        };
        colorAnimRaf = requestAnimationFrame(step);
    }

    // Pop amplitude [0,1] for a bar whose reveal threshold is `t`
    // (0 = first revealed, 1 = last). Zero outside the sweep window.
    function barPop(t: number): number {
        const phase = (colorAnimProgress - t) / POP_SPAN;
        if (phase < 0 || phase > 1) return 0;
        return Math.sin(Math.PI * phase);
    }

    const layout = {
        gap: 8,
        sideWidth: 92,
        bottomHeight: 102,
    };
    const axisGutter = {
        left: 42,
        right: 12,
        top: 12,
        bottom: 24,
    };
    const GUIDE_SPOTIFY_COLOR = "#1DB954";
    const OUT_OF_BRUSH_BAR_COLOR = "#6b645c";
    const UNMATCHED_POINT_COLOR = "#6b645c";
    const UNMATCHED_POINT_ALPHA = 0.22;
    // Canvas panel chrome — follows the theme (light/dark toggle). The canvas
    // manipulates color strings, so we re-read the tokens on every draw.
    const panelColors = $derived.by(() => {
        void themeStore.theme;
        const c = vizColors();
        return {
            bg: c.background,
            grid: c.border,
            axisText: c.mutedForeground,
            baseline: c.border,
        };
    });

    // Captured once on mount: enough for the common case (monitor/zoom change
    // mid-session not handled, complexity not justified).
    const dpr =
        typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;

    let mainCanvas: HTMLCanvasElement | null = null;
    let xCanvas: HTMLCanvasElement | null = null;
    let yCanvas: HTMLCanvasElement | null = null;
    let xBrushLayer: SVGSVGElement | null = null;
    let yBrushLayer: SVGSVGElement | null = null;

    let mainCtx: CanvasRenderingContext2D | null = null;
    let xCtx: CanvasRenderingContext2D | null = null;
    let yCtx: CanvasRenderingContext2D | null = null;

    let zoomBehavior: d3.ZoomBehavior<HTMLCanvasElement, unknown> | null = null;
    let xBrush: d3.BrushBehavior<unknown> | null = null;
    let yBrush: d3.BrushBehavior<unknown> | null = null;

    let rafId: number | null = null;
    let suppressBrushEvent = false;

    let tooltip = $state({
        visible: false,
        x: 0,
        y: 0,
        meta: null as Record<string, unknown> | null,
    });

    const tooltipInfo = $derived(
        tooltip.visible && tooltip.meta && formatTooltip
            ? formatTooltip(tooltip.meta)
            : null,
    );

    const panel = $derived.by(() => {
        const mainWidth = Math.max(280, width - layout.sideWidth - layout.gap);
        const mainHeight = Math.max(
            220,
            height - layout.bottomHeight - layout.gap,
        );
        return {
            mainWidth,
            mainHeight,
            sideWidth: layout.sideWidth,
            bottomHeight: layout.bottomHeight,
        };
    });

    const xRange = $derived.by(
        () =>
            [axisGutter.left, panel.mainWidth - axisGutter.right] as [
                number,
                number,
            ],
    );
    const yRange = $derived.by(
        () =>
            [axisGutter.top, panel.mainHeight - axisGutter.bottom] as [
                number,
                number,
            ],
    );

    const bottomPanelBounds = $derived.by(() => ({
        left: xRange[0],
        right: xRange[1],
        top: 6,
        bottom: panel.bottomHeight - 20,
    }));

    const sidePanelBounds = $derived.by(() => ({
        left: 10,
        right: panel.sideWidth - 10,
        top: yRange[0],
        bottom: yRange[1],
    }));

    const effectiveTimeDomain = $derived.by((): [number, number] => {
        if (
            timeDomain &&
            Number.isFinite(timeDomain[0]) &&
            Number.isFinite(timeDomain[1]) &&
            timeDomain[0] < timeDomain[1]
        ) {
            return timeDomain as [number, number];
        }

        if (!data.length) {
            const now = Date.now();
            return [now - 86400000, now];
        }

        let min = Number.POSITIVE_INFINITY;
        let max = Number.NEGATIVE_INFINITY;
        for (const point of data) {
            if (point.x < min) min = point.x;
            if (point.x > max) max = point.x;
        }
        if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) {
            const now = Date.now();
            return [now - 86400000, now];
        }
        return [min, max];
    });

    let viewXDomain = $state<[number, number]>([0, 1]);
    let viewYDomain = $state<[number, number]>([0, 24]);
    let committedXDomain = $state<[number, number]>([0, 1]);
    let committedYDomain = $state<[number, number]>([0, 24]);
    let domainsInitialized = false;
    let lastEffectiveDomainKey = "";

    const baseXScale = $derived.by(() =>
        d3
            .scaleTime<number, number>()
            .domain(
                effectiveTimeDomain.map((value) => new Date(value)) as [
                    Date,
                    Date,
                ],
            )
            .range(xRange),
    );

    const sideYScale = $derived.by(() =>
        d3
            .scaleLinear()
            .domain([0, 24])
            .range([sidePanelBounds.top, sidePanelBounds.bottom]),
    );

    const xScale = $derived.by(() =>
        d3
            .scaleTime<number, number>()
            .domain(viewXDomain.map((value) => new Date(value)) as [Date, Date])
            .range(xRange),
    );

    const yScale = $derived.by(() =>
        d3.scaleLinear().domain(viewYDomain).range(yRange),
    );

    interface ScaledPoint {
        x: number;
        y: number;
        original: ConnectablePoint;
    }

    const scaledData = $derived.by((): ScaledPoint[] =>
        data.map((point) => ({
            x: xScale(point.x),
            y: yScale(point.y),
            original: point,
        })),
    );

    const quadtree = $derived.by(() => {
        if (!scaledData.length) return null;
        return d3
            .quadtree<ScaledPoint>()
            .x((point) => point.x)
            .y((point) => point.y)
            .addAll(scaledData);
    });

    const segCount = $derived(colorActive ? colorCategories.length : 0);

    const monthlyBars = $derived.by(() => {
        void matchVersion; // recompute when `matched` is mutated in place
        // `count` holds the summed bar weight (default: 1 per point = a count;
        // the GMaps explorer passes a measure so it's presence min / km).
        const counts = new Map<number, number>();
        // In coloring mode: weight by category (segments[idx]) per month.
        const segs = colorActive ? new Map<number, number[]>() : null;
        for (const point of data) {
            if (!point.matched) continue;
            if (point.y < committedYDomain[0] || point.y > committedYDomain[1])
                continue;
            const w = barValue(point);
            const month = new Date(point.x);
            month.setDate(1);
            month.setHours(0, 0, 0, 0);
            const key = month.getTime();
            counts.set(key, (counts.get(key) || 0) + w);
            if (segs) {
                const si = segmentIndex(point);
                if (si >= 0) {
                    let arr = segs.get(key);
                    if (!arr) {
                        arr = new Array(segCount).fill(0);
                        segs.set(key, arr);
                    }
                    arr[si] += w;
                }
            }
        }

        // Build a continuous monthly timeline so the bottom bars stay aligned
        // with the main time axis even when some months have zero plays.
        const [domainStart, domainEnd] = effectiveTimeDomain;
        const cursor = new Date(domainStart);
        cursor.setDate(1);
        cursor.setHours(0, 0, 0, 0);

        const end = new Date(domainEnd);
        end.setDate(1);
        end.setHours(0, 0, 0, 0);

        const series: Array<{
            monthStartMs: number;
            count: number;
            segments: number[] | null;
        }> = [];
        while (cursor <= end) {
            const key = cursor.getTime();
            series.push({
                monthStartMs: key,
                count: counts.get(key) || 0,
                segments: segs ? (segs.get(key) ?? null) : null,
            });
            cursor.setMonth(cursor.getMonth() + 1);
        }

        return series;
    });

    const hourBars = $derived.by(() => {
        void matchVersion; // recompute when `matched` is mutated in place
        const step = 15;
        const binCount = Math.ceil((24 * 60) / step);
        const bins = Array.from({ length: binCount }, (_, index) => ({
            startHour: (index * step) / 60,
            endHour: Math.min(24, ((index + 1) * step) / 60),
            count: 0,
            segments: colorActive
                ? (new Array(segCount).fill(0) as number[])
                : null,
        }));

        for (const point of data) {
            if (!point.matched) continue;
            if (point.x < committedXDomain[0] || point.x > committedXDomain[1])
                continue;
            const w = barValue(point);
            const minuteOfDay = Math.max(
                0,
                Math.min(1439, Math.floor(point.y * 60)),
            );
            const binIndex = Math.min(
                binCount - 1,
                Math.floor(minuteOfDay / step),
            );
            const bin = bins[binIndex];
            bin.count += w;
            if (bin.segments) {
                const si = segmentIndex(point);
                if (si >= 0) bin.segments[si] += w;
            }
        }

        return bins;
    });

    function clampXDomain(domain: [number, number]): [number, number] {
        const [minX, maxX] = effectiveTimeDomain;
        let [start, end] = domain;
        if (start > end) [start, end] = [end, start];
        start = Math.min(Math.max(start, minX), maxX);
        end = Math.min(Math.max(end, minX), maxX);
        if (start >= end) {
            const safeStart = Math.max(minX, Math.min(start, maxX - 86400000));
            const safeEnd = Math.min(maxX, safeStart + 86400000);
            return [safeStart, safeEnd > safeStart ? safeEnd : maxX];
        }
        return [start, end];
    }

    function clampYDomain(domain: [number, number]): [number, number] {
        let [start, end] = domain;
        if (start > end) [start, end] = [end, start];
        start = Math.max(0, start);
        end = Math.min(24, end);
        if (start >= end) {
            const safeEnd = Math.min(24, start + 1);
            return [start, safeEnd > start ? safeEnd : 24];
        }
        return [start, end];
    }

    function scheduleRender() {
        if (!mainCtx || !xCtx || !yCtx) return;
        if (rafId !== null) cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(() => {
            drawMain();
            drawBottomPanel();
            drawLeftPanel();
        });
    }

    function drawMain() {
        if (!mainCtx) return;
        const ctx = mainCtx;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        const [x0, x1] = xRange;
        const [y0, y1] = yRange;

        ctx.clearRect(0, 0, panel.mainWidth, panel.mainHeight);
        ctx.fillStyle = panelColors.bg;
        ctx.fillRect(0, 0, panel.mainWidth, panel.mainHeight);

        ctx.strokeStyle = panelColors.grid;
        ctx.fillStyle = panelColors.axisText;
        ctx.lineWidth = 1;
        ctx.font = "10px Inter, sans-serif";

        const yTicks = d3.range(0, 25, 2);
        ctx.textAlign = "right";
        ctx.textBaseline = "middle";
        for (const tick of yTicks) {
            const y = yScale(tick);
            if (y < y0 - 1 || y > y1 + 1) continue;
            ctx.globalAlpha = 0.28;
            ctx.beginPath();
            ctx.moveTo(x0, y);
            ctx.lineTo(x1, y);
            ctx.stroke();
            ctx.globalAlpha = 1;
            ctx.fillText(`${tick}h`, x0 - 6, y);
        }

        const xTicks = xScale.ticks(8);
        const formatTick = d3.timeFormat("%b %Y");
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        for (const tick of xTicks) {
            const x = xScale(tick);
            ctx.globalAlpha = 0.28;
            ctx.beginPath();
            ctx.moveTo(x, y0);
            ctx.lineTo(x, y1);
            ctx.stroke();
            ctx.globalAlpha = 1;
            ctx.fillText(formatTick(tick), x, y1 + 6);
        }

        // Two passes: dimmed non-matching points first, matching points on
        // top so the active selection stays readable at high density.
        const pointSize = 2;
        ctx.fillStyle = UNMATCHED_POINT_COLOR;
        ctx.globalAlpha = UNMATCHED_POINT_ALPHA;
        for (const point of scaledData) {
            if (point.original.matched) continue;
            if (point.x < x0 || point.x > x1 || point.y < y0 || point.y > y1)
                continue;
            ctx.fillRect(
                point.x - pointSize / 2,
                point.y - pointSize / 2,
                pointSize,
                pointSize,
            );
        }

        ctx.globalAlpha = 0.7;
        if (colorActive) {
            // Group the matched points by color in a single pass to minimize
            // fillStyle changes (one draw per category).
            // The scatterplot is not swept: everything is colored directly.
            const buckets = new Map<string, ScaledPoint[]>();
            for (const point of scaledData) {
                if (!point.original.matched) continue;
                if (
                    point.x < x0 ||
                    point.x > x1 ||
                    point.y < y0 ||
                    point.y > y1
                )
                    continue;
                const c = colorFor(point.original);
                let arr = buckets.get(c);
                if (!arr) {
                    arr = [];
                    buckets.set(c, arr);
                }
                arr.push(point);
            }
            for (const [color, pts] of buckets) {
                ctx.fillStyle = color;
                for (const point of pts) {
                    ctx.fillRect(
                        point.x - pointSize / 2,
                        point.y - pointSize / 2,
                        pointSize,
                        pointSize,
                    );
                }
            }
        } else {
            ctx.fillStyle = GUIDE_SPOTIFY_COLOR;
            ctx.globalAlpha = 0.62;
            for (const point of scaledData) {
                if (!point.original.matched) continue;
                if (
                    point.x < x0 ||
                    point.x > x1 ||
                    point.y < y0 ||
                    point.y > y1
                )
                    continue;
                ctx.fillRect(
                    point.x - pointSize / 2,
                    point.y - pointSize / 2,
                    pointSize,
                    pointSize,
                );
            }
        }

        ctx.globalAlpha = 1;
    }

    function drawBottomPanel() {
        if (!xCtx) return;
        const ctx = xCtx;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        const heightPx = panel.bottomHeight;
        const { left: x0, right: x1, top, bottom } = bottomPanelBounds;

        ctx.clearRect(0, 0, panel.mainWidth, heightPx);
        ctx.fillStyle = panelColors.bg;
        ctx.fillRect(0, 0, panel.mainWidth, heightPx);

        const maxCount = Math.max(1, ...monthlyBars.map((bar) => bar.count));
        const barScale = d3
            .scaleLinear()
            .domain([0, maxCount])
            .range([bottom, top]);

        const monthKeys = monthlyBars.map((bar) => bar.monthStartMs);
        const monthBand = d3
            .scaleBand<number>()
            .domain(monthKeys)
            .range([x0, x1])
            .paddingInner(0.22)
            .paddingOuter(0);

        ctx.save();
        ctx.beginPath();
        ctx.rect(x0, top, x1 - x0, bottom - top);
        ctx.clip();

        for (const bar of monthlyBars) {
            const bx = monthBand(bar.monthStartMs);
            if (bx === undefined) continue;
            const bw = Math.max(1, monthBand.bandwidth());
            const nextMonthStart = new Date(bar.monthStartMs);
            nextMonthStart.setMonth(nextMonthStart.getMonth() + 1);

            const monthCenterMs =
                bar.monthStartMs +
                Math.max(1, nextMonthStart.getTime() - bar.monthStartMs) / 2;
            const isInWindow =
                monthCenterMs >= viewXDomain[0] &&
                monthCenterMs <= viewXDomain[1];

            // Sweep left → right: 0 = left edge (revealed first).
            const cx = bx + bw / 2;
            const t = (cx - x0) / (x1 - x0);
            const revealed = colorAnimProgress >= t;

            if (colorActive && isInWindow && bar.segments && revealed) {
                // Stacking bottom to top — only within the brush window.
                // Pop as the front passes: a bit taller and wider.
                const pop = barPop(t);
                const sV = 1 + pop * 0.18;
                const sH = 1 + pop * 0.3;
                const drawW = bw * sH;
                const drawX = cx - drawW / 2;
                ctx.globalAlpha = 0.9;
                let acc = 0;
                for (let i = 0; i < bar.segments.length; i++) {
                    const seg = bar.segments[i];
                    if (seg <= 0) continue;
                    const yTop = bottom - (bottom - barScale(acc + seg)) * sV;
                    const yBot = bottom - (bottom - barScale(acc)) * sV;
                    ctx.fillStyle = colorCategories[i].color;
                    ctx.fillRect(drawX, yTop, drawW, yBot - yTop);
                    acc += seg;
                }
            } else {
                ctx.globalAlpha = 0.85;
                const y = barScale(bar.count);
                ctx.fillStyle = isInWindow
                    ? GUIDE_SPOTIFY_COLOR
                    : OUT_OF_BRUSH_BAR_COLOR;
                ctx.fillRect(bx, y, bw, bottom - y);
            }
        }
        ctx.restore();

        ctx.globalAlpha = 1;
        ctx.strokeStyle = panelColors.baseline;
        ctx.beginPath();
        ctx.moveTo(x0, bottom + 0.5);
        ctx.lineTo(x1, bottom + 0.5);
        ctx.stroke();
    }

    function drawLeftPanel() {
        if (!yCtx) return;
        const ctx = yCtx;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        const widthPx = panel.sideWidth;
        const { top: y0, bottom: y1, left, right } = sidePanelBounds;

        ctx.clearRect(0, 0, widthPx, panel.mainHeight);
        ctx.fillStyle = panelColors.bg;
        ctx.fillRect(0, 0, widthPx, panel.mainHeight);

        const maxCount = Math.max(1, ...hourBars.map((bar) => bar.count));
        const countScale = d3
            .scaleLinear()
            .domain([0, maxCount])
            .range([left, right]);

        // The hour bars start from the right edge and go left.
        const xForCount = (c: number) => right - (countScale(c) - left);
        for (const bar of hourBars) {
            const yStart = sideYScale(bar.startHour);
            const yEnd = sideYScale(bar.endHour);
            const y = Math.max(y0, yStart);
            const h = Math.max(1, Math.min(y1, yEnd) - y);
            const hourCenter = (bar.startHour + bar.endHour) / 2;
            const isInWindow =
                hourCenter >= viewYDomain[0] && hourCenter <= viewYDomain[1];

            // Sweep bottom → top: 0 = bottom (revealed first).
            const yc = sideYScale(hourCenter);
            const t = (y1 - yc) / (y1 - y0);
            const revealed = colorAnimProgress >= t;

            if (colorActive && isInWindow && bar.segments && revealed) {
                // Colored stacking as the front passes, with a pop: a bit thicker
                // (height) and a bit longer.
                const pop = barPop(t);
                const sV = 1 + pop * 0.3;
                const sL = 1 + pop * 0.18;
                const barH = h * 0.92;
                const drawH = barH * sV;
                const drawY = y + barH / 2 - drawH / 2;
                ctx.globalAlpha = 0.9;
                let acc = 0;
                for (let i = 0; i < bar.segments.length; i++) {
                    const seg = bar.segments[i];
                    if (seg <= 0) continue;
                    const xRight = right - (right - xForCount(acc)) * sL;
                    const xLeft = right - (right - xForCount(acc + seg)) * sL;
                    ctx.fillStyle = colorCategories[i].color;
                    ctx.fillRect(
                        xLeft,
                        drawY,
                        Math.max(1, xRight - xLeft),
                        drawH,
                    );
                    acc += seg;
                }
            } else {
                ctx.globalAlpha = 0.85;
                const xStart = xForCount(bar.count);
                ctx.fillStyle = isInWindow
                    ? GUIDE_SPOTIFY_COLOR
                    : OUT_OF_BRUSH_BAR_COLOR;
                ctx.fillRect(xStart, y, Math.max(1, right - xStart), h * 0.92);
            }
        }
        ctx.globalAlpha = 1;

        ctx.strokeStyle = panelColors.baseline;
        ctx.beginPath();
        ctx.moveTo(right + 0.5, y0);
        ctx.lineTo(right + 0.5, y1);
        ctx.stroke();
    }

    function hideTooltip() {
        tooltip.visible = false;
    }

    function onMouseMove(event: MouseEvent) {
        if (!mainCanvas || !quadtree) return;
        const [mx, my] = d3.pointer(event, mainCanvas);
        const hit = quadtree.find(mx, my, 12);
        if (!hit) {
            hideTooltip();
            return;
        }

        // Apply tooltip bounds checking here
        let tx = mx + 12;
        let ty = my + 12;
        const tooltipApproxWidth = 260;
        const tooltipApproxHeight = 70;

        if (tx + tooltipApproxWidth > panel.mainWidth) {
            tx = mx - tooltipApproxWidth - 12;
        }
        if (ty + tooltipApproxHeight > panel.mainHeight) {
            ty = my - tooltipApproxHeight - 12;
        }

        tooltip = {
            visible: true,
            x: Math.max(0, tx),
            y: Math.max(0, ty),
            meta: hit.original.metadata,
        };
    }

    /** ⌘/Ctrl+click on a point: delegated to the caller (e.g. open on Spotify). */
    function onClick(event: MouseEvent) {
        if (!hasOpenModifier(event) || !mainCanvas || !quadtree || !onPointClick)
            return;
        const [mx, my] = d3.pointer(event, mainCanvas);
        const hit = quadtree.find(mx, my, 12);
        if (!hit) return;
        if (onPointClick(hit.original.metadata, event)) {
            event.preventDefault();
            event.stopPropagation();
        }
    }

    function syncXBrushToDomain() {
        if (!xBrushLayer || !xBrush) return;
        const selection: [number, number] = [
            baseXScale(viewXDomain[0]),
            baseXScale(viewXDomain[1]),
        ];
        suppressBrushEvent = true;
        d3.select(xBrushLayer).call(xBrush.move as any, selection);
        suppressBrushEvent = false;
    }

    function syncYBrushToDomain() {
        if (!yBrushLayer || !yBrush) return;
        const selection: [number, number] = [
            sideYScale(viewYDomain[0]),
            sideYScale(viewYDomain[1]),
        ];
        suppressBrushEvent = true;
        d3.select(yBrushLayer).call(yBrush.move as any, selection);
        suppressBrushEvent = false;
    }

    function resetView() {
        viewXDomain = effectiveTimeDomain;
        viewYDomain = [0, 24];
        committedXDomain = effectiveTimeDomain;
        committedYDomain = [0, 24];
        viewTimeDomain = null; // Clear manual filter
        viewHourDomain = null; // Clear manual filter
        if (mainCanvas && zoomBehavior) {
            d3.select(mainCanvas).call(zoomBehavior.transform, d3.zoomIdentity);
        }
        syncXBrushToDomain();
        syncYBrushToDomain();
        scheduleRender();
    }

    function initXBrush() {
        if (!xBrushLayer) return;
        const brushExtent: [[number, number], [number, number]] = [
            [bottomPanelBounds.left, bottomPanelBounds.top],
            [bottomPanelBounds.right, bottomPanelBounds.bottom],
        ];
        const xFromSelection = (event: any): [number, number] | null => {
            if (suppressBrushEvent || !event.selection) return null;
            const [sx0, sx1] = event.selection as [number, number];
            return clampXDomain([
                baseXScale.invert(sx0).getTime(),
                baseXScale.invert(sx1).getTime(),
            ]);
        };
        xBrush = d3
            .brushX()
            .handleSize(2)
            .extent(brushExtent)
            // "brush": live update during the drag. We also emit the domain
            // downstream so the sunburst updates in real time; the consumer
            // throttles the cadence (cf. +page).
            .on("brush", (event) => {
                const nextX = xFromSelection(event);
                if (!nextX) return;
                viewXDomain = nextX;
                committedXDomain = nextX;
                viewTimeDomain = nextX;
                scheduleRender();
            })
            // "end": final value on release (guarantees the last state).
            .on("end", (event) => {
                const nextX = xFromSelection(event);
                if (!nextX) return;
                viewXDomain = nextX;
                committedXDomain = nextX;
                viewTimeDomain = nextX;
                scheduleRender();
            });
        d3.select(xBrushLayer).call(xBrush as any);
        syncXBrushToDomain();
    }

    function initYBrush() {
        if (!yBrushLayer) return;
        const brushExtent: [[number, number], [number, number]] = [
            [sidePanelBounds.left, sidePanelBounds.top],
            [sidePanelBounds.right, sidePanelBounds.bottom],
        ];
        const yFromSelection = (event: any): [number, number] | null => {
            if (suppressBrushEvent || !event.selection) return null;
            const [sy0, sy1] = event.selection as [number, number];
            return clampYDomain([
                sideYScale.invert(sy0),
                sideYScale.invert(sy1),
            ]);
        };
        yBrush = d3
            .brushY()
            .handleSize(2)
            .extent(brushExtent)
            .on("brush", (event) => {
                const nextY = yFromSelection(event);
                if (!nextY) return;
                viewYDomain = nextY;
                committedYDomain = nextY;
                viewHourDomain = nextY;
                scheduleRender();
            })
            .on("end", (event) => {
                const nextY = yFromSelection(event);
                if (!nextY) return;
                viewYDomain = nextY;
                committedYDomain = nextY;
                viewHourDomain = nextY;
                scheduleRender();
            });
        d3.select(yBrushLayer).call(yBrush as any);
        syncYBrushToDomain();
    }

    function initZoom() {
        if (!mainCanvas) return;
        zoomBehavior = d3
            .zoom<HTMLCanvasElement, unknown>()
            .scaleExtent([1, 30])
            .extent([
                [0, 0],
                [panel.mainWidth, panel.mainHeight],
            ])
            .translateExtent([
                [0, 0],
                [panel.mainWidth, panel.mainHeight],
            ])
            .on("zoom", (event) => {
                const zx = event.transform.rescaleX(baseXScale);
                const domain = zx.domain().map((d: Date) => d.getTime()) as [
                    number,
                    number,
                ];
                viewXDomain = clampXDomain(domain);
                committedXDomain = viewXDomain;
                scheduleRender();
            })
            .on("end", () => {
                committedXDomain = viewXDomain;
                // Emit time domain change
                viewTimeDomain = viewXDomain;
                syncXBrushToDomain();
            });

        d3.select(mainCanvas)
            .style("touch-action", "none")
            .call(zoomBehavior)
            .on("mousemove.constellation", onMouseMove)
            .on("mouseleave.constellation", hideTooltip)
            .on("click.constellation", onClick);
    }

    $effect(() => {
        const _width = width;
        const _height = height;
        const _dataCount = data.length;
        const _timeDomain0 = effectiveTimeDomain[0];
        const _timeDomain1 = effectiveTimeDomain[1];
        const effectiveDomainKey = `${effectiveTimeDomain[0]}-${effectiveTimeDomain[1]}`;

        if (!domainsInitialized) {
            viewXDomain = effectiveTimeDomain;
            viewYDomain = [0, 24];
            committedXDomain = effectiveTimeDomain;
            committedYDomain = [0, 24];
            domainsInitialized = true;
            lastEffectiveDomainKey = effectiveDomainKey;
        } else if (effectiveDomainKey !== lastEffectiveDomainKey) {
            viewXDomain = effectiveTimeDomain;
            viewYDomain = [0, 24];
            committedXDomain = effectiveTimeDomain;
            committedYDomain = [0, 24];
            lastEffectiveDomainKey = effectiveDomainKey;
        } else {
            const clampedX = clampXDomain(viewXDomain);
            if (
                clampedX[0] !== viewXDomain[0] ||
                clampedX[1] !== viewXDomain[1]
            ) {
                viewXDomain = clampedX;
            }

            const clampedY = clampYDomain(viewYDomain);
            if (
                clampedY[0] !== viewYDomain[0] ||
                clampedY[1] !== viewYDomain[1]
            ) {
                viewYDomain = clampedY;
            }
        }

        initXBrush();
        initYBrush();
        scheduleRender();
    });

    // Redraw only when `matched` was mutated in place (stable `data` reference).
    // scaledData/quadtree don't read matchVersion → no rebuild.
    $effect(() => {
        void matchVersion;
        void colorActive;
        void colorCategories;
        void colorField;
        void barValue;
        if (domainsInitialized) scheduleRender();
    });

    // Redraw the canvas chrome on theme change (light/dark).
    $effect(() => {
        void themeStore.theme;
        if (domainsInitialized) scheduleRender();
    });

    // Triggers the sweep on entering coloring mode or on colored-dimension change
    // (not on brush or on category reordering).
    let prevColorField: string | null = null;
    $effect(() => {
        const f = colorField;
        const active = colorActive;
        if (active && f !== prevColorField) {
            startColorAnim();
        }
        prevColorField = active ? f : null;
    });

    onMount(() => {
        if (!mainCanvas || !xCanvas || !yCanvas) return;
        mainCtx = mainCanvas.getContext("2d");
        xCtx = xCanvas.getContext("2d");
        yCtx = yCanvas.getContext("2d");
        if (!mainCtx || !xCtx || !yCtx) return;

        initZoom();
        initXBrush();
        initYBrush();
        scheduleRender();
    });

    onDestroy(() => {
        if (rafId !== null) cancelAnimationFrame(rafId);
        if (colorAnimRaf !== null) cancelAnimationFrame(colorAnimRaf);
    });
</script>

<div
    class="constellation-layout"
    style={`--side-width:${panel.sideWidth}px; --bottom-height:${panel.bottomHeight}px; --layout-height:${height}px;`}
>
    <div class="y-area">
        <canvas
            bind:this={yCanvas}
            width={panel.sideWidth * dpr}
            height={panel.mainHeight * dpr}
        ></canvas>
        <svg
            bind:this={yBrushLayer}
            width={panel.sideWidth}
            height={panel.mainHeight}
        ></svg>
    </div>

    <div class="main-area">
        <canvas
            bind:this={mainCanvas}
            width={panel.mainWidth * dpr}
            height={panel.mainHeight * dpr}
        ></canvas>
        <button class="reset-btn" type="button" onclick={resetView}
            >Reset view</button
        >
        {#if tooltipInfo}
            <div
                class="tooltip"
                style={`left:${tooltip.x}px; top:${tooltip.y}px;`}
            >
                {#if tooltipInfo.title}
                    <strong>{tooltipInfo.title}</strong>
                {/if}
                {#each tooltipInfo.lines ?? [] as line}
                    <span>{line}</span>
                {/each}
                {#if tooltipInfo.hint}
                    <span class="hint">{tooltipInfo.hint}</span>
                {/if}
            </div>
        {/if}
    </div>

    <div class="x-area">
        <canvas
            bind:this={xCanvas}
            width={panel.mainWidth * dpr}
            height={panel.bottomHeight * dpr}
        ></canvas>
        <svg
            bind:this={xBrushLayer}
            width={panel.mainWidth}
            height={panel.bottomHeight}
        ></svg>
    </div>
</div>

<style>
    .constellation-layout {
        width: 100%;
        height: var(--layout-height);
        display: grid;
        grid-template-columns: var(--side-width) minmax(0, 1fr);
        grid-template-rows: minmax(0, 1fr) var(--bottom-height);
        gap: 8px;
        background: hsl(var(--background));
    }

    .main-area {
        grid-column: 2;
        grid-row: 1;
        position: relative;
        overflow: hidden;
        border: 1px solid hsl(var(--border));
        border-radius: 8px;
    }

    .x-area {
        grid-column: 2;
        grid-row: 2;
        position: relative;
        border: 1px solid hsl(var(--border));
        border-radius: 8px;
        overflow: hidden;
    }

    .y-area {
        grid-column: 1;
        grid-row: 1;
        position: relative;
        border: 1px solid hsl(var(--border));
        border-radius: 8px;
        overflow: hidden;
    }

    .main-area canvas,
    .x-area canvas,
    .y-area canvas {
        display: block;
        width: 100%;
        height: 100%;
    }

    .x-area svg,
    .y-area svg {
        position: absolute;
        inset: 0;
        overflow: hidden;
        display: block;
        width: 100%;
        height: 100%;
    }

    .x-area :global(.selection),
    .y-area :global(.selection) {
        fill: rgb(148 163 184 / 0.26);
        stroke: none;
    }

    .x-area :global(.handle),
    .y-area :global(.handle) {
        fill: rgb(148 163 184 / 0.9);
        stroke: none;
    }

    .reset-btn {
        position: absolute;
        top: 10px;
        right: 10px;
        z-index: 2;
        border: 1px solid var(--border, hsl(var(--border)));
        border-radius: 999px;
        padding: 0.3rem 0.65rem;
        font-size: 0.72rem;
        color: hsl(var(--foreground));
        background: color-mix(in srgb, hsl(var(--card)) 88%, white 12%);
        cursor: pointer;
    }

    .reset-btn:hover {
        border-color: var(--accent-spotify, #1db954);
        color: var(--accent-spotify, #1db954);
    }

    .tooltip {
        position: absolute;
        pointer-events: none;
        z-index: 3;
        display: flex;
        flex-direction: column;
        gap: 2px;
        max-width: 16rem;
        border-radius: 7px;
        border: 1px solid hsl(var(--border));
        padding: 0.42rem 0.52rem;
        font-size: 0.72rem;
        color: hsl(var(--foreground));
        background: color-mix(in srgb, hsl(var(--card)) 92%, black 8%);
    }

    .tooltip .hint {
        margin-top: 2px;
        font-size: 0.66rem;
        color: var(--accent-spotify, #1db954);
    }
</style>
