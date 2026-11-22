<script lang="ts">
    import * as d3 from 'd3';
    import {
        bandStacks,
        dayAt,
        hourAt,
        valueAt,
        type ColorStop,
        type SignalGrid,
    } from '#lib/visualizations/signalGrid.ts';
    import { chartColors, chartFont } from '#lib/visualizations/themeColors.ts';
    import { themeStore } from '#lib/stores/themeStore.svelte.ts';

    interface Props {
        grid: SignalGrid;
        width: number;
        height: number;
        /**
         * The ramp, as a colour and the value it sits at, ascending. Readings
         * outside the two ends clamp to them. Stops need not be evenly spaced:
         * a last one set far past the others gives the tail of a skewed signal
         * a colour of its own instead of flattening it against the end.
         *
         * Interpolated, never stepped: bands would draw contour lines that are
         * not in the signal.
         */
        stops: ColorStop[];
        formatValue?: (value: number) => string;
        label?: string;
    }

    let {
        grid,
        width,
        height,
        stops,
        formatValue = (v: number) => String(Math.round(v * 10) / 10),
        label = '',
    }: Props = $props();

    const domain = $derived<[number, number]>([
        stops[0]?.value ?? 0,
        stops[stops.length - 1]?.value ?? 1,
    ]);

    // The constellation's own proportions and arrangement, so the two charts
    // read as one family: a 92 px column of hour bars down the LEFT, a 102 px
    // band of day bars under the grid, and the same axis gutters.
    const LAYOUT = { gap: 8, sideWidth: 92, bottomHeight: 102 };
    const GUTTER = { top: 12, right: 12, left: 42 };
    /** Inset of the hour bars inside their column, as in sidePanelBounds. */
    const SIDE_INSET = 10;
    /** The rest of the day panel carries the dates. */
    const DAY_LABELS = 20;

    let canvas = $state<HTMLCanvasElement | null>(null);
    let xBrushLayer = $state<SVGGElement | null>(null);
    let yBrushLayer = $state<SVGGElement | null>(null);
    let hover = $state<{ x: number; y: number; lines: string[] } | null>(null);

    /** Brushed window, in grid indices. Null means the whole grid. */
    let window_ = $state<{
        fromDay: number;
        toDay: number;
        fromSlot: number;
        toSlot: number;
    } | null>(null);

    /** The grid sits right of the hour column, past the hour labels. */
    const plotLeft = LAYOUT.sideWidth + LAYOUT.gap + GUTTER.left;
    const plotTop = GUTTER.top;
    const plotWidth = $derived(Math.max(1, width - plotLeft - GUTTER.right));
    const plotHeight = $derived(Math.max(1, height - plotTop - LAYOUT.gap - LAYOUT.bottomHeight));
    /** Top of the day panel, under the grid. */
    const stripTop = $derived(plotTop + plotHeight + LAYOUT.gap);
    const dayStripHeight = LAYOUT.bottomHeight - DAY_LABELS;
    /** The hour bars are anchored at the column's inner edge and grow away
     *  from the grid, exactly as the constellation draws them. */
    const sideAnchor = LAYOUT.sideWidth - SIDE_INSET;

    const view = $derived(
        window_ ?? {
            fromDay: 0,
            toDay: grid.dayCount,
            fromSlot: 0,
            toSlot: grid.slotsPerDay,
        }
    );

    /**
     * Each strip excludes its own axis's brush — the same rule the explorer's
     * pies follow. The day strip counts over the selected hours but spans every
     * day, and the hour strip the reverse, so both keep describing the whole
     * export while the selection rectangle sits on top of them. Zooming the
     * strips too would leave that rectangle pointing at nothing.
     */
    const stopValues = $derived(stops.map((s) => s.value));

    const dayStacks = $derived(
        bandStacks(grid, stopValues, {
            fromDay: 0,
            toDay: grid.dayCount,
            fromSlot: view.fromSlot,
            toSlot: view.toSlot,
        })
    );
    const slotStacks = $derived(
        bandStacks(grid, stopValues, {
            fromDay: view.fromDay,
            toDay: view.toDay,
            fromSlot: 0,
            toSlot: grid.slotsPerDay,
        })
    );

    const colorFor = $derived.by(() => {
        const scale = d3
            .scaleLinear<string>()
            .domain(stopValues)
            .range(stops.map((s) => s.color))
            .clamp(true)
            .interpolate(d3.interpolateRgb);
        return (value: number) => scale(value);
    });

    /**
     * The grid, painted once at its own resolution — one pixel per cell.
     *
     * Kept off-screen so redrawing the view is a scaled blit rather than a
     * repaint: brushing changes only the source rectangle handed to drawImage.
     */
    let source: HTMLCanvasElement | null = null;
    let sourceKey = '';

    function paintSource() {
        const key = `${grid.dayCount}x${grid.slotsPerDay}:${grid.filled}:${stops.map((s) => `${s.value}${s.color}`).join()}`;
        if (source && key === sourceKey) return source;
        if (grid.dayCount === 0) return null;

        const next = document.createElement('canvas');
        next.width = grid.dayCount;
        next.height = grid.slotsPerDay;
        const ctx = next.getContext('2d');
        if (!ctx) return null;

        const image = ctx.createImageData(grid.dayCount, grid.slotsPerDay);
        const pixels = image.data;
        // Cache one colour per integer step of the ramp: parsing a colour string
        // per cell is what would make 300k cells feel slow.
        const LEVELS = 256;
        const swatch: [number, number, number][] = [];
        for (let i = 0; i < LEVELS; i++) {
            const value = domain[0] + ((domain[1] - domain[0]) * i) / (LEVELS - 1);
            const { r, g, b } = d3.rgb(colorFor(value));
            swatch.push([r, g, b]);
        }
        const span = domain[1] - domain[0] || 1;

        for (let i = 0; i < grid.values.length; i++) {
            const value = grid.values[i];
            // A cell with no reading stays transparent: watch-off time has to
            // look like absence, not like a low value.
            if (Number.isNaN(value)) continue;
            const level = Math.max(
                0,
                Math.min(LEVELS - 1, Math.round(((value - domain[0]) / span) * (LEVELS - 1)))
            );
            const [r, g, b] = swatch[level];
            const p = i * 4;
            pixels[p] = r;
            pixels[p + 1] = g;
            pixels[p + 2] = b;
            pixels[p + 3] = 255;
        }

        ctx.putImageData(image, 0, 0);
        source = next;
        sourceKey = key;
        return source;
    }

    function draw() {
        if (!canvas) return;
        const dpr = window.devicePixelRatio || 1;
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, width, height);

        const src = paintSource();
        if (src) {
            const sw = Math.max(1, view.toDay - view.fromDay);
            const sh = Math.max(1, view.toSlot - view.fromSlot);
            // Nearest neighbour: a cell has nothing between it and the next, so
            // smoothing would invent readings that were never taken.
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(
                src,
                view.fromDay,
                view.fromSlot,
                sw,
                sh,
                plotLeft,
                plotTop,
                plotWidth,
                plotHeight
            );
        }

        drawMarginals(ctx);
        drawAxes(ctx);
    }

    /**
     * Both marginals, stacked by band: a bar's length is how many cells were
     * recorded there, its segments what they were made of. An hour that is half
     * rest and half effort shows as two colours rather than as one middling
     * value that never happened.
     */
    function drawMarginals(ctx: CanvasRenderingContext2D) {
        const bands = dayStacks.bandCount;

        // Under the grid, spanning every day — and the surface the day brush is
        // drawn on.
        const dayWidth = plotWidth / Math.max(1, grid.dayCount);
        const dayFloor = stripTop + dayStripHeight;
        const dayScale = dayStripHeight / Math.max(1, dayStacks.dayPeak);
        for (let day = 0; day < grid.dayCount; day++) {
            let y = dayFloor;
            for (let band = 0; band < bands; band++) {
                const count = dayStacks.byDay[day * bands + band];
                if (count <= 0) continue;
                const h = count * dayScale;
                y -= h;
                ctx.fillStyle = stops[band].color;
                ctx.fillRect(plotLeft + day * dayWidth, y, Math.max(1, dayWidth), Math.max(1, h));
            }
        }

        // Down the left, spanning the whole day: the shape of an average day,
        // which is the circadian profile for free.
        const slotHeight = plotHeight / Math.max(1, grid.slotsPerDay);
        const slotScale = (LAYOUT.sideWidth - SIDE_INSET * 2) / Math.max(1, slotStacks.slotPeak);
        for (let slot = 0; slot < grid.slotsPerDay; slot++) {
            let x = sideAnchor;
            for (let band = 0; band < bands; band++) {
                const count = slotStacks.bySlot[slot * bands + band];
                if (count <= 0) continue;
                const w = count * slotScale;
                x -= w;
                ctx.fillStyle = stops[band].color;
                ctx.fillRect(
                    x,
                    plotTop + slot * slotHeight,
                    Math.max(1, w),
                    Math.max(1, slotHeight)
                );
            }
        }

        ctx.strokeStyle = chartColors().axis;
        ctx.beginPath();
        ctx.moveTo(plotLeft, dayFloor + 0.5);
        ctx.lineTo(plotLeft + plotWidth, dayFloor + 0.5);
        ctx.stroke();
    }

    function drawAxes(ctx: CanvasRenderingContext2D) {
        ctx.fillStyle = chartColors().muted;
        ctx.font = chartFont();

        // Hours down the left edge, every three.
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        const slotHeight = plotHeight / Math.max(1, view.toSlot - view.fromSlot);
        for (let slot = view.fromSlot; slot < view.toSlot; slot++) {
            const hour = hourAt(grid, slot);
            if (!Number.isInteger(hour) || hour % 3 !== 0) continue;
            ctx.fillText(
                `${String(hour).padStart(2, '0')}h`,
                plotLeft - 6,
                plotTop + (slot - view.fromSlot + 0.5) * slotHeight
            );
        }

        // Dates along the bottom.
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        const y = stripTop + dayStripHeight + 6;
        const ticks = 6;
        for (let i = 0; i <= ticks; i++) {
            const day = (grid.dayCount * i) / ticks;
            const at = new Date(dayAt(grid, Math.floor(day)));
            const x = plotLeft + (plotWidth * i) / ticks;
            ctx.fillText(
                at.toLocaleDateString(undefined, { month: 'short', year: '2-digit' }),
                Math.max(plotLeft + 18, Math.min(plotLeft + plotWidth - 18, x)),
                y
            );
        }

        ctx.textAlign = 'left';
        const zoomed =
            view.fromDay > 0 || view.toDay < grid.dayCount
                ? ` — ${new Date(dayAt(grid, view.fromDay)).toLocaleDateString()} → ${new Date(dayAt(grid, Math.max(view.fromDay, view.toDay - 1))).toLocaleDateString()}`
                : '';
        if (label || zoomed) ctx.fillText(`${label}${zoomed}`, plotLeft, plotTop - 2);
    }

    // --- Brushing ---------------------------------------------------------
    // Two d3 brushes on their own SVG layers, exactly as the constellation does
    // it. On a grid the inversion is arithmetic on indices rather than a scale
    // inversion, so a selection always lands on whole days and whole slots.
    let suppress = false;

    /** Strip pixel → day index. The strips always span the whole grid. */
    function dayFromStrip(px: number): number {
        return ((px - plotLeft) / plotWidth) * grid.dayCount;
    }

    function slotFromStrip(py: number): number {
        return ((py - plotTop) / plotHeight) * grid.slotsPerDay;
    }

    /** Main-area pixel → day index, which does follow the zoom. */
    function dayFromPlot(px: number): number {
        const t = (px - plotLeft) / plotWidth;
        return view.fromDay + t * (view.toDay - view.fromDay);
    }

    function slotFromPlot(py: number): number {
        const t = (py - plotTop) / plotHeight;
        return view.fromSlot + t * (view.toSlot - view.fromSlot);
    }

    function initBrushes() {
        if (!xBrushLayer || !yBrushLayer) return;

        const xBrush = d3
            .brushX()
            .handleSize(2)
            .extent([
                [plotLeft, stripTop],
                [plotLeft + plotWidth, stripTop + dayStripHeight],
            ])
            .on('brush end', (event) => {
                if (suppress) return;
                if (!event.selection) {
                    window_ = { ...view, fromDay: 0, toDay: grid.dayCount };
                    draw();
                    return;
                }
                const [a, b] = event.selection as [number, number];
                const fromDay = Math.max(0, Math.floor(dayFromStrip(a)));
                const toDay = Math.min(grid.dayCount, Math.ceil(dayFromStrip(b)));
                if (toDay - fromDay < 1) return;
                window_ = { ...view, fromDay, toDay };
                draw();
            });

        const yBrush = d3
            .brushY()
            .handleSize(2)
            .extent([
                [SIDE_INSET, plotTop],
                [sideAnchor, plotTop + plotHeight],
            ])
            .on('brush end', (event) => {
                if (suppress) return;
                if (!event.selection) {
                    window_ = { ...view, fromSlot: 0, toSlot: grid.slotsPerDay };
                    draw();
                    return;
                }
                const [a, b] = event.selection as [number, number];
                const fromSlot = Math.max(0, Math.floor(slotFromStrip(a)));
                const toSlot = Math.min(grid.slotsPerDay, Math.ceil(slotFromStrip(b)));
                if (toSlot - fromSlot < 1) return;
                window_ = { ...view, fromSlot, toSlot };
                draw();
            });

        d3.select(xBrushLayer).call(xBrush as never);
        d3.select(yBrushLayer).call(yBrush as never);
    }

    export function reset() {
        window_ = null;
        suppress = true;
        if (xBrushLayer) d3.select(xBrushLayer).call(d3.brushX().move as never, null);
        if (yBrushLayer) d3.select(yBrushLayer).call(d3.brushY().move as never, null);
        suppress = false;
        draw();
    }

    function onMove(event: PointerEvent) {
        if (!canvas || grid.dayCount === 0) return;
        const rect = canvas.getBoundingClientRect();
        const px = event.clientX - rect.left;
        const py = event.clientY - rect.top;
        if (
            px < plotLeft ||
            px > plotLeft + plotWidth ||
            py < plotTop ||
            py > plotTop + plotHeight
        ) {
            hover = null;
            return;
        }

        const day = Math.floor(dayFromPlot(px));
        const slot = Math.floor(slotFromPlot(py));
        const value = valueAt(grid, day, slot);
        const hour = hourAt(grid, slot);
        hover = {
            x: px,
            y: py,
            lines: [
                new Date(dayAt(grid, day)).toLocaleDateString(),
                `${String(Math.floor(hour)).padStart(2, '0')}:${String(Math.round((hour % 1) * 60)).padStart(2, '0')}`,
                Number.isNaN(value) ? 'nothing recorded' : formatValue(value),
            ],
        };
    }

    $effect(() => {
        void grid;
        void domain;
        void width;
        void height;
        void view;
        // The axes are painted in the theme's ink.
        void themeStore.theme;
        draw();
    });

    $effect(() => {
        void plotWidth;
        void plotHeight;
        void grid.dayCount;
        initBrushes();
    });
</script>

<div class="raster" style:width="{width}px" style:height="{height}px">
    <canvas bind:this={canvas} onpointermove={onMove} onpointerleave={() => (hover = null)}
    ></canvas>
    <svg {width} {height}>
        <g bind:this={xBrushLayer}></g>
        <g bind:this={yBrushLayer}></g>
    </svg>
    {#if hover}
        <div class="chart-tooltip" style:left="{hover.x + 12}px" style:top="{hover.y + 12}px">
            {#each hover.lines as line, i (i)}
                {#if i === 2}<strong>{line}</strong>{:else}<span>{line}</span>{/if}
            {/each}
        </div>
    {/if}
</div>

<style>
    .raster {
        position: relative;
    }

    canvas,
    svg {
        position: absolute;
        inset: 0;
    }

    svg {
        pointer-events: none;
    }

    svg :global(.selection) {
        fill: hsl(var(--foreground));
        fill-opacity: 0.08;
        stroke: hsl(var(--muted-foreground));
        stroke-width: 1;
    }

    svg :global(.overlay),
    svg :global(.handle) {
        pointer-events: all;
    }
</style>
