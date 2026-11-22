<script lang="ts">
    import { onDestroy, onMount, type Snippet } from 'svelte';
    import * as d3 from 'd3';
    import type { ConnectablePoint } from '#lib/data/queries/behaviorQueries.ts';
    import { otherColor } from '#lib/utils/dimensionColors.ts';
    import {
        createPointCloud,
        packColors,
        type PointCloud,
    } from '#lib/visualizations/gl/pointCloud.ts';
    import { hasOpenModifier } from '#lib/utils/spotify.ts';
    import { chartColors, chartFont, vizColors } from '#lib/visualizations/themeColors.ts';
    import { themeStore } from '#lib/stores/themeStore.svelte.ts';
    import { trackControl } from '#lib/analytics.ts';
    import ShareMenu from '#lib/components/ShareMenu.svelte';
    import type { ShareSource } from '#lib/export/index.ts';
    import {
        barPop as sweepPop,
        buildQuadtree,
        clampHourDomain,
        clampTimeDomain,
        hourBars as buildHourBars,
        monthlyBars as buildMonthlyBars,
        nearestMatched,
        pointPasses as buildPointPasses,
        resolveTimeDomain,
        type BarWeighting,
        type PointPass,
        type ScaledPoint,
    } from '#lib/visualizations/constellation.ts';

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
        // redraw without rebuilding scaledData/quadtree (cf. /listening/explore).
        // Leave at 0 → historical behavior.
        matchVersion?: number;
        // Coloring by dimension. `colorField` = raw field carried by the points
        // (e.g. "platform"); `colorCategories` = ordered values + colors (the last
        // typically being "Other"). When provided, the matched points and the
        // satellite barcharts are colored/stacked by this dimension.
        colorField?: string | null;
        colorCategories?: ColorCategory[];
        // Fill for matched points when not coloring by dimension. Defaults to the
        // Spotify green; the Google Maps explorer passes its red.
        matchedColor?: string;
        // Weight a point contributes to the satellite bar charts (monthly + hourly).
        // Default 1 → bars count points. The Google Maps explorer passes the active
        // measure (presence minutes / km) so the temporal bars track the toggle.
        barValue?: (point: ConnectablePoint) => number;
        // Tooltip content for the hovered point, derived from its metadata.
        // When omitted, no tooltip is shown.
        formatTooltip?: (metadata: Record<string, unknown>) => TooltipInfo;
        // ⌘/Ctrl+click handler. Receives the clicked point's metadata; returns
        // true if it handled the click (the chart then prevents default).
        onPointClick?: (metadata: Record<string, unknown>, event: MouseEvent) => boolean;
        // A key laid over the plot's top-left corner — the search's terms. Part
        // of the exported plate, so it goes out with a shared image; mark its
        // controls `data-export-hide`.
        legend?: Snippet;
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
        // Every Explorer passes its module's peak, resolved for the canvas.
        matchedColor = '#9658c6',
        barValue = () => 1,
        formatTooltip,
        onPointClick,
        legend,
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
    const otherIndex = $derived(colorCategories.findIndex((c) => c.value === 'Other'));

    function pointColorValue(point: ConnectablePoint): string {
        return colorField
            ? ((point as unknown as Record<string, unknown>)[colorField] as string)
            : '';
    }
    function colorFor(point: ConnectablePoint): string {
        return colorMap.get(pointColorValue(point)) ?? otherColor();
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
            typeof window !== 'undefined' &&
            window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
        ) {
            colorAnimProgress = 1;
            return;
        }
        colorAnimStart = performance.now();
        colorAnimProgress = 0;
        if (colorAnimRaf !== null) cancelAnimationFrame(colorAnimRaf);
        const step = () => {
            const t = Math.min(1, (performance.now() - colorAnimStart) / COLOR_ANIM_MS);
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
        return sweepPop(colorAnimProgress, t, POP_SPAN);
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
    const UNMATCHED_POINT_ALPHA = 0.22;
    // Canvas panel chrome — follows the theme (light/dark toggle). The canvas
    // manipulates color strings, so we re-read the tokens on every draw.
    const panelColors = $derived.by(() => {
        void themeStore.theme;
        const c = vizColors();
        const chart = chartColors();
        return {
            bg: c.background,
            grid: chart.grid,
            axisText: chart.muted,
            baseline: chart.axis,
            // Whatever is out of the brush or the search: the strong neutral, hex
            // because the WebGL layer parses it.
            dim: chart.axis,
            font: chartFont(),
        };
    });

    // Captured once on mount: enough for the common case (monitor/zoom change
    // mid-session not handled, complexity not justified).
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;

    let mainCanvas: HTMLCanvasElement | null = null;
    /**
     * The scatterplot is drawn on its own WebGL canvas, stacked over the 2D one
     * that keeps the grid and the axes. Two contexts can't share a canvas, hence
     * the pair — and the GL layer takes no pointer events, so the zoom and the
     * tooltip keep reading the 2D canvas underneath.
     *
     * `glCloud` is null wherever WebGL is unavailable (disabled in the browser,
     * jsdom under test); the Canvas2D point path below is the fallback.
     */
    let glCanvas: HTMLCanvasElement | null = null;
    let glCloud: PointCloud | null = null;
    let xCanvas: HTMLCanvasElement | null = null;
    let yCanvas: HTMLCanvasElement | null = null;
    /**
     * Run `apply` on a brush layer. d3's brush typings only accept a `<g>`; the
     * layers are `<svg>` overlays, which d3 drives the same way at runtime.
     */
    function onBrushLayer(
        layer: SVGSVGElement | null,
        apply: (g: d3.Selection<SVGGElement, unknown, null, undefined>) => void
    ) {
        if (layer) apply(d3.select(layer as unknown as SVGGElement));
    }

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
        tooltip.visible && tooltip.meta && formatTooltip ? formatTooltip(tooltip.meta) : null
    );

    /* The inside of each panel, as the browser reports it. */
    let mainBoxWidth = $state(0);
    let mainBoxHeight = $state(0);
    let sideBoxWidth = $state(0);
    let bottomBoxHeight = $state(0);

    /**
     * The boxes the three panels are drawn in — measured, not calculated.
     *
     * This used to be arithmetic: the container's width, less the side column,
     * less the gap. Which is the same sum the CSS grid does, and it came out two
     * pixels bigger every time, because each panel carries a 1px border that the
     * sum knew nothing about. Two pixels would be nothing if every layer swallowed
     * them the same way, and the trouble is that they do not:
     *
     *  - a canvas is stretched to its box by `width: 100%`, so its drawing was
     *    quietly rescaled by (box − 2) / box;
     *  - an `<svg>` with no viewBox is *not* rescaled — its user units stay CSS
     *    pixels whatever the viewport does.
     *
     * So the axis ticks on the canvas and the brush handles on the SVG above it
     * agreed at the left edge and were nearly two pixels apart at the right. The
     * points and the grid drifted from the axes the same way.
     *
     * Measuring removes the second opinion: `clientWidth` is the padding box,
     * which is exactly what `width: 100%` resolves against and exactly what an
     * absolutely positioned `inset: 0` layer spans. Model pixel, CSS pixel and
     * displayed pixel become the same pixel, and nothing is scaled by anything.
     *
     * The grid template is still driven by the *constants* below, never by these
     * measurements — sizing the columns from the box they produce is how you get
     * a panel that shrinks by two pixels on every frame.
     *
     * The arithmetic survives as a fallback for the frame before the first
     * measurement lands, where a zero would invert the scales.
     */
    const panel = $derived.by(() => ({
        mainWidth: mainBoxWidth || Math.max(280, width - layout.sideWidth - layout.gap),
        mainHeight: mainBoxHeight || Math.max(220, height - layout.bottomHeight - layout.gap),
        sideWidth: sideBoxWidth || layout.sideWidth,
        bottomHeight: bottomBoxHeight || layout.bottomHeight,
    }));

    const xRange = $derived.by(
        () => [axisGutter.left, panel.mainWidth - axisGutter.right] as [number, number]
    );
    const yRange = $derived.by(
        () => [axisGutter.top, panel.mainHeight - axisGutter.bottom] as [number, number]
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

    const effectiveTimeDomain = $derived(resolveTimeDomain(timeDomain, data));

    let viewXDomain = $state<[number, number]>([0, 1]);
    let viewYDomain = $state<[number, number]>([0, 24]);
    let committedXDomain = $state<[number, number]>([0, 1]);
    let committedYDomain = $state<[number, number]>([0, 24]);
    let domainsInitialized = false;
    let lastEffectiveDomainKey = '';

    const baseXScale = $derived.by(() =>
        d3
            .scaleTime<number, number>()
            .domain(effectiveTimeDomain.map((value) => new Date(value)) as [Date, Date])
            .range(xRange)
    );

    const sideYScale = $derived.by(() =>
        d3.scaleLinear().domain([0, 24]).range([sidePanelBounds.top, sidePanelBounds.bottom])
    );

    const xScale = $derived.by(() =>
        d3
            .scaleTime<number, number>()
            .domain(viewXDomain.map((value) => new Date(value)) as [Date, Date])
            .range(xRange)
    );

    const yScale = $derived.by(() => d3.scaleLinear().domain(viewYDomain).range(yRange));

    const scaledData = $derived.by((): ScaledPoint[] =>
        data.map((point) => ({
            x: xScale(point.x),
            y: yScale(point.y),
            original: point,
        }))
    );

    const quadtree = $derived(buildQuadtree(scaledData));

    const segCount = $derived(colorActive ? colorCategories.length : 0);

    /** How both satellite bar charts weigh and split the matched points. */
    const barWeighting = $derived<BarWeighting>({
        // Default: 1 per point, i.e. a count; explorers with a measure pass
        // minutes, km…
        weight: barValue,
        segments: colorActive ? { count: segCount, of: segmentIndex } : null,
    });

    const monthlyBars = $derived.by(() => {
        void matchVersion; // recompute when `matched` is mutated in place
        return buildMonthlyBars(data, effectiveTimeDomain, committedYDomain, barWeighting);
    });

    const hourBars = $derived.by(() => {
        void matchVersion; // recompute when `matched` is mutated in place
        return buildHourBars(data, committedXDomain, barWeighting);
    });

    function clampXDomain(domain: [number, number]): [number, number] {
        return clampTimeDomain(domain, effectiveTimeDomain);
    }

    function clampYDomain(domain: [number, number]): [number, number] {
        return clampHourDomain(domain);
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

    /* ---------------------------------------------------------------- export */

    let plate = $state<HTMLDivElement | undefined>(undefined);

    /**
     * A still of the constellation as it currently stands — the zoom, the
     * brushes, the colouring.
     *
     * `prepare` matters here and nowhere else in the app: the points live on a
     * WebGL canvas whose drawing buffer is discarded once the browser has
     * composited, so it is redrawn in the same task that copies it. Everything
     * else on screen — the axes, the two side panels — is a 2D canvas that
     * keeps its pixels and needs no such care.
     */
    const shareSource: ShareSource = {
        name: 'constellation',
        element: () => plate,
        prepare: () => {
            drawMain();
            drawBottomPanel();
            drawLeftPanel();
        },
    };

    function drawMain() {
        if (!mainCtx) return;
        const ctx = mainCtx;
        drawMainChrome();

        if (glCloud) {
            syncPointCloud(glCloud);
            glCloud.draw({
                xWindow: viewXDomain,
                yWindow: viewYDomain,
                plot: [xRange[0], xRange[1], yRange[0], yRange[1]],
                pointSize: POINT_SIZE * dpr,
                dimColor: panelColors.dim,
                dimAlpha: UNMATCHED_POINT_ALPHA,
            });
            return;
        }

        for (const pass of pointPasses()) {
            drawPointSlice(pass, 0, pass.points.length);
        }
        ctx.globalAlpha = 1;
    }

    // What the GL buffers were last filled from, so each upload happens once.
    let glDataRef: ConnectablePoint[] | null = null;
    let glMatchVersion = -1;
    let glColorKey = '';
    let glSizeKey = '';
    let glXDomain: [number, number] = [0, 1];
    /** `y` is an hour of day by the ConnectablePoint contract. */
    const GL_Y_DOMAIN: [number, number] = [0, 24];

    /**
     * Push to the GPU whatever changed since the last frame — and nothing else.
     *
     * Positions go up once per dataset: the visible window is a uniform, so
     * zooming and brushing cost no upload at all. Only the matched flags (one
     * byte a point) move on a filter change.
     */
    function syncPointCloud(cloud: PointCloud) {
        const sizeKey = `${panel.mainWidth}x${panel.mainHeight}@${dpr}`;
        if (sizeKey !== glSizeKey) {
            glSizeKey = sizeKey;
            cloud.resize(panel.mainWidth, panel.mainHeight, dpr);
        }

        if (glDataRef !== data) {
            glDataRef = data;
            let lo = Infinity;
            let hi = -Infinity;
            for (const point of data) {
                if (point.x < lo) lo = point.x;
                if (point.x > hi) hi = point.x;
            }
            glXDomain = Number.isFinite(lo) ? [lo, hi] : [0, 1];
            cloud.setPoints(data, glXDomain, GL_Y_DOMAIN);
            // A new point set invalidates the two buffers keyed to it.
            glMatchVersion = -1;
            glColorKey = '';
        }

        if (glMatchVersion !== matchVersion) {
            glMatchVersion = matchVersion;
            const flags = new Uint8Array(data.length);
            for (let i = 0; i < data.length; i++) {
                flags[i] = data[i].matched ? 1 : 0;
            }
            cloud.setMatched(flags);
        }

        const colorKey = colorActive
            ? `on|${colorField}|${colorCategories.map((c) => `${c.value}:${c.color}`).join(',')}`
            : `off|${matchedColor}`;
        if (colorKey !== glColorKey) {
            glColorKey = colorKey;
            cloud.setColors(
                packColors(
                    data.length,
                    colorActive ? (i) => colorFor(data[i]) : () => matchedColor,
                    colorActive ? 0.7 : 0.62
                )
            );
        }
    }

    /**
     * Everything but the points: background, grid and axis labels. Always drawn
     * in one go — a half-drawn axis would read as a rendering bug, and it is
     * cheap next to the scatterplot.
     */
    function drawMainChrome() {
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
        ctx.font = panelColors.font;

        const yTicks = d3.range(0, 25, 2);
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        for (const tick of yTicks) {
            const y = yScale(tick);
            if (y < y0 - 1 || y > y1 + 1) continue;
            ctx.beginPath();
            ctx.moveTo(x0, y);
            ctx.lineTo(x1, y);
            ctx.stroke();
            ctx.fillText(`${tick}h`, x0 - 6, y);
        }

        const xTicks = xScale.ticks(8);
        const formatTick = d3.timeFormat('%b %Y');
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        for (const tick of xTicks) {
            const x = xScale(tick);
            ctx.beginPath();
            ctx.moveTo(x, y0);
            ctx.lineTo(x, y1);
            ctx.stroke();
            ctx.fillText(formatTick(tick), x, y1 + 6);
        }
    }

    /**
     * The mark, in CSS px — and the floor it cannot go under.
     *
     * A finer grain is what makes a hundred thousand plays read as structure
     * rather than as one filled block, so the mark is asked to be 1 CSS px. But
     * two *device* pixels is a hard floor, not a preference: the point shader
     * fades its rim by one device pixel, so a one-device-pixel mark is all rim —
     * its centre never passes half opacity and the whole cloud turns grey.
     *
     * Which is why this is expressed against the DPR rather than as a constant.
     * On a 2× screen the floor lands at 1 CSS px and the cloud gets the fine
     * grain; on a 1× screen it lands back at 2 and nothing changes, because
     * there is nothing smaller left to draw.
     */
    const POINT_SIZE_MIN_DEVICE_PX = 2;
    const POINT_SIZE = Math.max(1, POINT_SIZE_MIN_DEVICE_PX / dpr);

    /** The plate's fill passes, in paint order (see `pointPasses` in constellation.ts). */
    function pointPasses(): PointPass[] {
        return buildPointPasses(
            scaledData,
            { x: xRange, y: yRange },
            {
                unmatched: { color: panelColors.dim, alpha: UNMATCHED_POINT_ALPHA },
                matched: { color: matchedColor, alpha: 0.62 },
                colorOf: colorActive ? colorFor : null,
                coloredAlpha: 0.7,
            }
        );
    }

    /** Draw at most `count` points of a pass from `from`; returns where it stopped. */
    function drawPointSlice(pass: PointPass, from: number, count: number): number {
        if (!mainCtx) return pass.points.length;
        const ctx = mainCtx;
        ctx.fillStyle = pass.color;
        ctx.globalAlpha = pass.alpha;
        const pts = pass.points;
        const end = Math.min(from + count, pts.length);
        const half = POINT_SIZE / 2;
        for (let i = from; i < end; i++) {
            const point = pts[i];
            ctx.fillRect(point.x - half, point.y - half, POINT_SIZE, POINT_SIZE);
        }
        return end;
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
        const barScale = d3.scaleLinear().domain([0, maxCount]).range([bottom, top]);

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
                bar.monthStartMs + Math.max(1, nextMonthStart.getTime() - bar.monthStartMs) / 2;
            const isInWindow = monthCenterMs >= viewXDomain[0] && monthCenterMs <= viewXDomain[1];

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
                ctx.fillStyle = isInWindow ? matchedColor : panelColors.dim;
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
        const countScale = d3.scaleLinear().domain([0, maxCount]).range([left, right]);

        // The hour bars start from the right edge and go left.
        const xForCount = (c: number) => right - (countScale(c) - left);
        for (const bar of hourBars) {
            const yStart = sideYScale(bar.startHour);
            const yEnd = sideYScale(bar.endHour);
            const y = Math.max(y0, yStart);
            const h = Math.max(1, Math.min(y1, yEnd) - y);
            const hourCenter = (bar.startHour + bar.endHour) / 2;
            const isInWindow = hourCenter >= viewYDomain[0] && hourCenter <= viewYDomain[1];

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
                    ctx.fillRect(xLeft, drawY, Math.max(1, xRight - xLeft), drawH);
                    acc += seg;
                }
            } else {
                ctx.globalAlpha = 0.85;
                const xStart = xForCount(bar.count);
                ctx.fillStyle = isInWindow ? matchedColor : panelColors.dim;
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

    const HIT_RADIUS = 12;

    /** Nearest matching point within `HIT_RADIUS` (see `nearestMatched`). */
    function findMatchedPoint(mx: number, my: number): ScaledPoint | null {
        return nearestMatched(quadtree, mx, my, HIT_RADIUS);
    }

    function onMouseMove(event: MouseEvent) {
        if (!mainCanvas) return;
        const [mx, my] = d3.pointer(event, mainCanvas);
        const hit = findMatchedPoint(mx, my);
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
        if (!hasOpenModifier(event) || !mainCanvas || !onPointClick) return;
        const [mx, my] = d3.pointer(event, mainCanvas);
        const hit = findMatchedPoint(mx, my);
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
        onBrushLayer(xBrushLayer, (g) => g.call(xBrush!.move, selection));
        suppressBrushEvent = false;
    }

    function syncYBrushToDomain() {
        if (!yBrushLayer || !yBrush) return;
        const selection: [number, number] = [
            sideYScale(viewYDomain[0]),
            sideYScale(viewYDomain[1]),
        ];
        suppressBrushEvent = true;
        onBrushLayer(yBrushLayer, (g) => g.call(yBrush!.move, selection));
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
        const xFromSelection = (event: d3.D3BrushEvent<unknown>): [number, number] | null => {
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
            .on('brush', (event) => {
                const nextX = xFromSelection(event);
                if (!nextX) return;
                viewXDomain = nextX;
                committedXDomain = nextX;
                viewTimeDomain = nextX;
                scheduleRender();
            })
            // "end": final value on release (guarantees the last state).
            .on('end', (event) => {
                const nextX = xFromSelection(event);
                if (!nextX) return;
                viewXDomain = nextX;
                committedXDomain = nextX;
                viewTimeDomain = nextX;
                scheduleRender();
            });
        onBrushLayer(xBrushLayer, (g) => g.call(xBrush!));
        syncXBrushToDomain();
    }

    function initYBrush() {
        if (!yBrushLayer) return;
        const brushExtent: [[number, number], [number, number]] = [
            [sidePanelBounds.left, sidePanelBounds.top],
            [sidePanelBounds.right, sidePanelBounds.bottom],
        ];
        const yFromSelection = (event: d3.D3BrushEvent<unknown>): [number, number] | null => {
            if (suppressBrushEvent || !event.selection) return null;
            const [sy0, sy1] = event.selection as [number, number];
            return clampYDomain([sideYScale.invert(sy0), sideYScale.invert(sy1)]);
        };
        yBrush = d3
            .brushY()
            .handleSize(2)
            .extent(brushExtent)
            .on('brush', (event) => {
                const nextY = yFromSelection(event);
                if (!nextY) return;
                viewYDomain = nextY;
                committedYDomain = nextY;
                viewHourDomain = nextY;
                scheduleRender();
            })
            .on('end', (event) => {
                const nextY = yFromSelection(event);
                if (!nextY) return;
                viewYDomain = nextY;
                committedYDomain = nextY;
                viewHourDomain = nextY;
                scheduleRender();
            });
        onBrushLayer(yBrushLayer, (g) => g.call(yBrush!));
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
            .on('zoom', (event) => {
                const zx = event.transform.rescaleX(baseXScale);
                const domain = zx.domain().map((d: Date) => d.getTime()) as [number, number];
                viewXDomain = clampXDomain(domain);
                committedXDomain = viewXDomain;
                scheduleRender();
            })
            .on('end', () => {
                committedXDomain = viewXDomain;
                // Emit time domain change
                viewTimeDomain = viewXDomain;
                syncXBrushToDomain();
            });

        d3.select(mainCanvas)
            .style('touch-action', 'none')
            .call(zoomBehavior)
            .on('mousemove.constellation', onMouseMove)
            .on('mouseleave.constellation', hideTooltip)
            .on('click.constellation', onClick);
    }

    $effect(() => {
        // The measured box, not the prop: a window resize moves both, but only
        // this one is what everything below is drawn against.
        const _width = panel.mainWidth;
        const _height = panel.mainHeight;
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
            if (clampedX[0] !== viewXDomain[0] || clampedX[1] !== viewXDomain[1]) {
                viewXDomain = clampedX;
            }

            const clampedY = clampYDomain(viewYDomain);
            if (clampedY[0] !== viewYDomain[0] || clampedY[1] !== viewYDomain[1]) {
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
        mainCtx = mainCanvas.getContext('2d');
        xCtx = xCanvas.getContext('2d');
        yCtx = yCanvas.getContext('2d');
        if (!mainCtx || !xCtx || !yCtx) return;

        if (glCanvas) glCloud = createPointCloud(glCanvas);

        initZoom();
        initXBrush();
        initYBrush();
        scheduleRender();
    });

    onDestroy(() => {
        if (rafId !== null) cancelAnimationFrame(rafId);
        glCloud?.destroy();
        if (colorAnimRaf !== null) cancelAnimationFrame(colorAnimRaf);
    });
</script>

<div class="constellation-shell">
    <!--
        Both of the plot's own controls, in one row.

        They used to be two separately positioned things reaching for the same
        corner, which is how a share button ends up sitting on top of a reset
        button. A flex row lines them up and lets each keep its own width.

        Outside the plot area rather than in it, because that area is
        `overflow: hidden` for the zoom and would slice the share panel off at
        its edge. Outside the captured plate too, so neither ends up in an
        export — the corner they share is the corner every chart's chrome wants.
    -->
    <div class="plot-toolbar">
        <button
            class="reset-btn"
            type="button"
            onclick={() => {
                trackControl('constellation', 'reset-view', true);
                resetView();
            }}
        >
            Reset view
        </button>
        <ShareMenu source={shareSource} vizId="constellation" floating={false} />
    </div>
    <div
        bind:this={plate}
        class="constellation-layout"
        style={`--side-width:${layout.sideWidth}px; --bottom-height:${layout.bottomHeight}px; --layout-height:${height}px;`}
    >
        <div class="y-area" bind:clientWidth={sideBoxWidth}>
            <canvas
                bind:this={yCanvas}
                width={panel.sideWidth * dpr}
                height={panel.mainHeight * dpr}
            ></canvas>
            <svg bind:this={yBrushLayer} width={panel.sideWidth} height={panel.mainHeight}></svg>
        </div>

        <div class="main-area" bind:clientWidth={mainBoxWidth} bind:clientHeight={mainBoxHeight}>
            <canvas
                bind:this={mainCanvas}
                width={panel.mainWidth * dpr}
                height={panel.mainHeight * dpr}
            ></canvas>
            <!-- The points. Its size is owned by the renderer (resize()), not by
             attributes here, and it lets every pointer event through to the 2D
             canvas below, which carries the zoom and the hit-testing. -->
            <canvas class="gl-layer" bind:this={glCanvas}></canvas>
            {#if legend}
                <div class="plot-legend">{@render legend()}</div>
            {/if}
            {#if tooltipInfo}
                <div
                    class="chart-tooltip"
                    data-export-hide
                    style={`left:${tooltip.x}px; top:${tooltip.y}px;`}
                >
                    {#if tooltipInfo.title}
                        <strong>{tooltipInfo.title}</strong>
                    {/if}
                    {#each tooltipInfo.lines ?? [] as line, index (index)}
                        <span>{line}</span>
                    {/each}
                    {#if tooltipInfo.hint}
                        <span class="hint">{tooltipInfo.hint}</span>
                    {/if}
                </div>
            {/if}
        </div>

        <div class="x-area" bind:clientHeight={bottomBoxHeight}>
            <canvas
                bind:this={xCanvas}
                width={panel.mainWidth * dpr}
                height={panel.bottomHeight * dpr}
            ></canvas>
            <svg bind:this={xBrushLayer} width={panel.mainWidth} height={panel.bottomHeight}></svg>
        </div>
    </div>
</div>

<style>
    /* Holds the share control over the grid without joining it. */
    .constellation-shell {
        position: relative;
    }

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
        border-radius: var(--radius-md);
    }

    .x-area {
        grid-column: 2;
        grid-row: 2;
        position: relative;
        border: 1px solid hsl(var(--border));
        border-radius: var(--radius-md);
        overflow: hidden;
    }

    .y-area {
        grid-column: 1;
        grid-row: 1;
        position: relative;
        border: 1px solid hsl(var(--border));
        border-radius: var(--radius-md);
        overflow: hidden;
    }

    .main-area canvas,
    .x-area canvas,
    .y-area canvas {
        display: block;
        width: 100%;
        height: 100%;
    }

    .gl-layer {
        position: absolute;
        inset: 0;
        pointer-events: none;
    }

    /* Over the plot, clear of the hour labels on its left edge and of the
       toolbar in the other corner. Only the key itself takes the pointer: the
       space around it still pans and zooms. */
    .plot-legend {
        position: absolute;
        top: 8px;
        left: 40px;
        max-width: calc(100% - 260px);
        z-index: 2;
        pointer-events: none;
    }

    .plot-legend > :global(*) {
        pointer-events: auto;
    }

    /* Too narrow to share the top edge with the toolbar: it goes under it. */
    @media (max-width: 767px) {
        .plot-legend {
            top: 40px;
            max-width: calc(100% - 48px);
        }
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
        fill: hsl(var(--foreground) / 0.1);
        stroke: none;
    }

    .x-area :global(.handle),
    .y-area :global(.handle) {
        fill: hsl(var(--muted-foreground));
        stroke: none;
    }

    .plot-toolbar {
        position: absolute;
        top: 10px;
        right: 10px;
        z-index: 20;
        display: flex;
        align-items: center;
        gap: 0.4rem;
    }

    /* Matched to the share trigger's metrics, since the two now sit shoulder to
       shoulder and any difference in height reads as a mistake. */
    .reset-btn {
        border: 1px solid hsl(var(--border));
        border-radius: var(--radius-pill);
        padding: 0.3rem 0.7rem;
        font-size: var(--text-small);
        line-height: 1.2;
        color: hsl(var(--foreground));
        background: color-mix(in srgb, hsl(var(--card)) 88%, white 12%);
        cursor: pointer;
        transition:
            border-color 0.15s,
            background-color 0.15s;
    }

    .reset-btn:hover {
        border-color: var(--module-accent);
        color: var(--module-accent);
    }
</style>
