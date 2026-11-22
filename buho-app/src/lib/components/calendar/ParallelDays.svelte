<script lang="ts">
    import Icon from '#lib/components/Icon.svelte';
    import { moduleById, type ModuleId } from '#lib/data/modules.ts';
    import type { YearDays } from '#lib/calendar/days.ts';
    import { CALENDAR_ORDER, axisTopText, type FigureContext } from '#lib/calendar/figures.ts';
    import { hexToRgb, peakColor, themeHsl } from '#lib/visualizations/themeColors.ts';
    import { themeStore } from '#lib/stores/themeStore.svelte.ts';

    /**
     * Every day of the open year as one line across six axes, coloured by the
     * module it stood out in. Each axis is its module's lane turned upright —
     * the same scale, so a line crosses it at the height of that day's bar,
     * and the figure at the top is what fills the lane. A day busy everywhere
     * runs along the top; a quiet day along the bottom; a day that was all one
     * thing spikes. Clicking a line opens that day.
     *
     * While the pointer is on a module elsewhere on the page, that module's
     * axis lights up in its colour. Each axis is named by its module's icon
     * alone; its name is the icon's tooltip.
     */
    interface Props {
        days: YearDays;
        loaded: Record<ModuleId, boolean>;
        selected: string | null;
        /** The day under the pointer, here or in the year's other charts. */
        hovered: string | null;
        context: FigureContext;
        onPick: (day: string) => void;
        onHover: (day: string | null) => void;
        /** The module whose axis to light up. */
        module: ModuleId | null;
        /** The module whose axis name the pointer is on; null once it is off the names. */
        onModule: (module: ModuleId | null) => void;
    }

    let { days, loaded, selected, hovered, context, onPick, onHover, module, onModule }: Props =
        $props();

    const HEIGHT = 96;
    /** How near a line the pointer has to be to pick it, in pixels. */
    const REACH = 6;

    let width = $state(0);
    let canvas = $state<HTMLCanvasElement | null>(null);
    /** Where the pointer is while it is near a line of this chart. */
    let pointer = $state<{ x: number; y: number } | null>(null);

    const year = $derived(days.year);

    const axes = $derived(
        CALENDAR_ORDER.map((id, k) => {
            const live = loaded[id] && (days.values[id] ?? []).some((value) => value !== null);
            return {
                id,
                live,
                top: live ? axisTopText(id, days.tops[id] ?? 0, context.measure) : '',
                share: (30 + (k * 940) / (CALENDAR_ORDER.length - 1)) / 1000,
                label: id === 'activity' ? 'Activity' : moduleById(id).label,
                tip: !loaded[id] ? 'Not imported' : live ? '' : `No data in ${year}`,
            };
        })
    );

    /** Height on the plot of a day's height in its lane, 0–1. */
    const y = (fill: number) => ((192 - fill * 184) / 200) * HEIGHT;

    /** Each day's line, as points across the axes it has a figure on. */
    const lines = $derived(
        days.days.map((_, i) => {
            const points: [number, number][] = [];
            for (const axis of axes) {
                const fill = axis.live ? days.fills[axis.id]?.[i] : null;
                if (fill != null) points.push([axis.share * width, y(fill)]);
            }
            return { module: days.standout[i]?.module ?? null, points };
        })
    );

    /** The module whose axis lights up, when it has anything on it. */
    const focus = $derived(module && axes.some((a) => a.id === module && a.live) ? module : null);

    const selectedIndex = $derived(selected ? days.days.indexOf(selected) : -1);
    const hoveredIndex = $derived(hovered ? days.days.indexOf(hovered) : -1);

    /** The marks where a day's line crosses each axis, with the figure behind each. */
    function crossings(index: number) {
        if (index < 0) return [];
        return axes.flatMap((axis) => {
            const fill = axis.live ? days.fills[axis.id]?.[index] : null;
            const value = days.values[axis.id]?.[index];
            if (fill == null || value == null) return [];
            return [
                {
                    id: axis.id,
                    left: axis.share * 100,
                    top: (y(fill) / HEIGHT) * 100,
                },
            ];
        });
    }

    const dots = $derived(crossings(selectedIndex));
    const hoverDots = $derived(hoveredIndex === selectedIndex ? [] : crossings(hoveredIndex));

    function rgba(module: ModuleId, alpha: number): string {
        const [r, g, b] = hexToRgb(peakColor(module));
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }

    function trace(ctx: CanvasRenderingContext2D, points: [number, number][]) {
        ctx.beginPath();
        points.forEach(([px, py], k) => (k === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)));
        ctx.stroke();
    }

    function draw() {
        if (!canvas || width <= 0) return;
        const dpr = window.devicePixelRatio || 1;
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(HEIGHT * dpr);
        canvas.style.width = `${width}px`;
        canvas.style.height = `${HEIGHT}px`;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, width, HEIGHT);
        ctx.lineJoin = 'round';

        ctx.strokeStyle = themeHsl('--border-strong', '#8a8a8a');
        ctx.lineWidth = 1;
        for (const axis of axes) {
            ctx.setLineDash(axis.live ? [] : [3, 4]);
            const x = Math.round(axis.share * width) + 0.5;
            ctx.beginPath();
            ctx.moveTo(x, y(1));
            ctx.lineTo(x, y(0));
            ctx.stroke();
        }
        ctx.setLineDash([]);

        // While a day is hovered the rest of the year steps back further, so
        // the one line under the pointer reads out of the mass.
        const hovering = hoveredIndex >= 0 && hoveredIndex !== selectedIndex;
        lines.forEach((line, i) => {
            if (!line.module || line.points.length < 2) return;
            if (i === selectedIndex || i === hoveredIndex) return;
            ctx.strokeStyle = rgba(line.module, hovering ? 0.1 : 0.22);
            ctx.lineWidth = 1;
            trace(ctx, line.points);
        });

        // The axis of the module pointed at elsewhere, over the year's lines.
        const lit = axes.find((axis) => axis.id === focus);
        if (lit && focus) {
            const x = Math.round(lit.share * width) + 0.5;
            ctx.strokeStyle = peakColor(focus);
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(x, y(1));
            ctx.lineTo(x, y(0));
            ctx.stroke();
        }

        // The hovered day over the rest, the selected one over everything,
        // each on a halo of the page's colour that parts it from the lines
        // it crosses.
        const halo = themeHsl('--background', '#16130f');
        const emphasise = (index: number, lineWidth: number) => {
            const line = lines[index];
            if (!line?.module || line.points.length < 2) return;
            ctx.strokeStyle = halo;
            ctx.lineWidth = lineWidth + 3;
            trace(ctx, line.points);
            ctx.strokeStyle = rgba(line.module, 1);
            ctx.lineWidth = lineWidth;
            trace(ctx, line.points);
        };
        if (hovering) emphasise(hoveredIndex, 2.5);
        if (selectedIndex >= 0) emphasise(selectedIndex, 3);
    }

    function distance(px: number, py: number, a: [number, number], b: [number, number]): number {
        const dx = b[0] - a[0];
        const dy = b[1] - a[1];
        const length = dx * dx + dy * dy;
        const t =
            length === 0
                ? 0
                : Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / length));
        return Math.hypot(px - (a[0] + t * dx), py - (a[1] + t * dy));
    }

    /** The day whose line passes nearest the pointer, within reach. */
    function nearest(px: number, py: number): number | null {
        let best: number | null = null;
        let bestDistance = REACH;
        lines.forEach((line, i) => {
            if (!line.module) return;
            for (let k = 1; k < line.points.length; k++) {
                const d = distance(px, py, line.points[k - 1], line.points[k]);
                if (d < bestDistance) {
                    bestDistance = d;
                    best = i;
                }
            }
        });
        return best;
    }

    function onMove(event: PointerEvent) {
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        const px = event.clientX - rect.left;
        const py = event.clientY - rect.top;
        const index = nearest(px, py);
        const day = index === null ? null : days.days[index];
        pointer = index === null ? null : { x: px, y: py };
        if (day !== hovered) onHover(day);
    }

    function onLeave() {
        pointer = null;
        onHover(null);
    }

    function onClick() {
        if (pointer && hovered) onPick(hovered);
    }

    $effect(() => {
        void themeStore.theme;
        void lines;
        void focus;
        void hoveredIndex;
        void selectedIndex;
        draw();
    });
</script>

<div class="parallel">
    <div class="tops">
        {#each axes as axis (axis.id)}
            {#if axis.top}
                <span class="top" style:left="{axis.share * 100}%">{axis.top}</span>
            {/if}
        {/each}
    </div>

    <div class="plot" bind:clientWidth={width} style:height="{HEIGHT}px">
        <canvas
            bind:this={canvas}
            class:picking={pointer !== null}
            onpointermove={onMove}
            onpointerleave={onLeave}
            onclick={onClick}
        ></canvas>
        {#each hoverDots as dot (dot.id)}
            <span
                class="dot small"
                style:left="{dot.left}%"
                style:top="{dot.top}%"
                style:background="var(--peak-{dot.id})"
            ></span>
        {/each}
        {#each dots as dot (dot.id)}
            <span
                class="dot"
                style:left="{dot.left}%"
                style:top="{dot.top}%"
                style:background="var(--peak-{dot.id})"
            ></span>
        {/each}
    </div>

    <div class="axes" role="presentation" onpointerleave={() => onModule(null)}>
        {#each axes as axis (axis.id)}
            <span
                class="axis"
                class:off={!axis.live}
                style:left="{axis.share * 100}%"
                data-module={axis.id}
                title={axis.tip ? `${axis.label} · ${axis.tip}` : axis.label}
                aria-label={axis.label}
                role="presentation"
                onpointerenter={() => onModule(axis.live ? axis.id : null)}
            >
                <Icon name={moduleById(axis.id).icon} size={14} />
            </span>
        {/each}
    </div>
</div>

<style>
    .parallel {
        flex: 1 1 360px;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 8px;
    }

    .tops {
        position: relative;
        height: 12px;
        margin-bottom: -6px;
    }

    .top {
        position: absolute;
        transform: translateX(-50%);
        font-family: var(--font-mono);
        font-size: 0.62rem;
        line-height: 12px;
        white-space: nowrap;
        color: hsl(var(--muted-foreground));
    }

    .plot {
        position: relative;
    }

    canvas {
        position: absolute;
        inset: 0;
    }

    canvas.picking {
        cursor: pointer;
    }

    .dot {
        position: absolute;
        width: 8px;
        height: 8px;
        border-radius: 999px;
        transform: translate(-50%, -50%);
        box-shadow: 0 0 0 2px hsl(var(--background));
    }

    .dot.small {
        width: 6px;
        height: 6px;
        pointer-events: none;
    }

    .axes {
        position: relative;
        height: 18px;
    }

    .axis {
        position: absolute;
        transform: translateX(-50%);
        display: inline-flex;
        align-items: center;
        gap: 5px;
        font-size: var(--text-label);
        line-height: 18px;
        white-space: nowrap;
        color: hsl(var(--muted-foreground));
    }

    .axis :global(svg) {
        color: var(--module-accent);
    }

    .axis.off {
        opacity: 0.45;
    }
</style>
