import * as d3 from 'd3';
import type { ModuleId } from '#lib/data/modules.ts';
import { rampPosition } from '#lib/visualizations/themeColors.ts';

/**
 * The one chart style every D3 chart is built from.
 *
 * Colours are CSS rather than hex: written into SVG attributes they follow the
 * light/dark toggle without a redraw, and the exporter resolves them when it
 * rasterises. The `--chart-*` roles are aliases defined in app.css; the type
 * comes from `.chart-svg`, so a chart is on the app's face and type scale
 * without setting either.
 */
export const CHART = {
    surface: 'var(--chart-surface)',
    ink: 'var(--chart-ink)',
    muted: 'var(--chart-muted)',
    grid: 'var(--chart-grid)',
    axis: 'var(--chart-axis)',
} as const;

/** A module's colour for areas and runs of bars, as CSS (`--fill-*` in app.css). */
export const fillVar = (module: ModuleId) => `var(--fill-${module})`;

/** A module's dense step, as CSS (`--peak-*`): dots, lines, the strong end of a ramp. */
export const peakVar = (module: ModuleId) => `var(--peak-${module})`;

/** The two sides of a conversation: "you" in the messages peak, "them" neutral. */
export const YOU_COLOR = peakVar('messages');
export const THEM_COLOR = 'var(--them)';

/** Mark specs, fixed across every chart. */
export const MARK = {
    /** Smallest dot radius: an 8px mark. */
    dotRadius: 4,
    /** The surface-coloured ring that keeps overlapping dots apart. */
    ring: 1.5,
    /** Rounding on a bar's data end; the baseline end stays square. */
    barRadius: 4,
    /** No bar is thicker than this, whatever room its band has. */
    barMax: 24,
    /** The surface gap between touching marks. */
    gap: 2,
    line: 2,
    /** The one dashed line a chart may carry: an even split, a median. */
    referenceDash: '4 3',
} as const;

export type Margin = { top: number; right: number; bottom: number; left: number };

export type SvgSelection = d3.Selection<SVGSVGElement, unknown, null, undefined>;
export type GroupSelection = d3.Selection<SVGGElement, unknown, null, undefined>;

export interface ChartTooltip {
    /** Shows `title` in ink over `lines`, next to the pointer. */
    show(event: { clientX: number; clientY: number }, title: string, lines?: string[]): void;
    hide(): void;
}

export interface Chart {
    /** What the factory returns: the legend, the SVG and the tooltip, together. */
    root: HTMLDivElement;
    svg: SvgSelection;
    /** The plotting area, already shifted by the margins. */
    plot: GroupSelection;
    width: number;
    height: number;
    innerWidth: number;
    innerHeight: number;
    margin: Margin;
    tooltip: ChartTooltip;
}

export function createChart(options: {
    width: number;
    height: number;
    margin: Margin;
    /** The accessible name of the picture. */
    label: string;
    legend?: HTMLElement | null;
}): Chart {
    const { width, height, margin, label, legend } = options;
    const root = document.createElement('div');
    root.className = 'chart';
    if (legend) root.appendChild(legend);

    const svg = d3
        .select(root)
        .append('svg')
        .attr('class', 'chart-svg')
        .attr('width', width)
        .attr('height', height)
        .attr('viewBox', `0 0 ${width} ${height}`)
        .attr('role', 'img')
        .attr('aria-label', label);

    const plot = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    return {
        root,
        svg,
        plot,
        width,
        height,
        innerWidth: Math.max(0, width - margin.left - margin.right),
        innerHeight: Math.max(0, height - margin.top - margin.bottom),
        margin,
        tooltip: createTooltip(root),
    };
}

/** Placeholder shown instead of a chart when there is nothing to draw. */
export function emptyChart(message: string, minHeight = 240): HTMLElement {
    const root = document.createElement('div');
    root.className = 'chart-empty';
    root.style.minHeight = `${minHeight}px`;
    root.textContent = message;
    return root;
}

function createTooltip(root: HTMLElement): ChartTooltip {
    const el = document.createElement('div');
    el.className = 'chart-tooltip';
    el.hidden = true;
    // The share export repaints the chart as it stands; a stray tooltip is not
    // part of the picture.
    el.dataset.exportHide = '';
    root.appendChild(el);

    return {
        show(event, title, lines = []) {
            const heading = document.createElement('strong');
            heading.textContent = title;
            const rows = lines.map((line) => {
                const row = document.createElement('span');
                row.textContent = line;
                return row;
            });
            el.replaceChildren(heading, ...rows);
            el.hidden = false;

            const box = root.getBoundingClientRect();
            const offset = 14;
            let x = event.clientX - box.left + offset;
            let y = event.clientY - box.top + offset;
            if (x + el.offsetWidth > box.width)
                x = event.clientX - box.left - el.offsetWidth - offset;
            if (y + el.offsetHeight > box.height) {
                y = event.clientY - box.top - el.offsetHeight - offset;
            }
            el.style.left = `${Math.max(0, x)}px`;
            el.style.top = `${Math.max(0, y)}px`;
        },
        hide() {
            el.hidden = true;
        },
    };
}

export interface AxisOptions {
    /** Draws the ticks across the plot as hairline gridlines. */
    grid?: boolean;
    /** The axis title, in muted ink: at the right end below, at the top left. */
    label?: string;
}

/**
 * Axis ink, the same on every chart: no domain line and no tick marks, labels
 * in the muted ink, and the ticks drawn across the plot as the grid when asked.
 * d3's own font attributes are dropped so `.chart-svg` sets the type.
 */
export function styleAxis(g: GroupSelection, grid = false) {
    g.attr('font-size', null).attr('font-family', null);
    g.select('.domain').remove();
    g.selectAll('.tick line').attr('stroke', grid ? CHART.grid : 'none');
    g.selectAll('.tick text').attr('fill', 'currentColor');
}

export function bottomAxis<D extends d3.AxisDomain>(
    chart: Chart,
    axis: d3.Axis<D>,
    options: AxisOptions = {}
): GroupSelection {
    const g = chart.plot
        .append('g')
        .attr('class', 'chart-axis')
        .attr('transform', `translate(0,${chart.innerHeight})`)
        .call(
            axis
                .tickSizeOuter(0)
                .tickPadding(8)
                .tickSize(options.grid ? -chart.innerHeight : 0)
        );
    styleAxis(g, Boolean(options.grid));
    if (options.label) {
        g.append('text')
            .attr('x', chart.innerWidth)
            .attr('y', chart.margin.bottom - 8)
            .attr('text-anchor', 'end')
            .attr('fill', 'currentColor')
            .text(options.label);
    }
    return g;
}

export function leftAxis<D extends d3.AxisDomain>(
    chart: Chart,
    axis: d3.Axis<D>,
    options: AxisOptions = {}
): GroupSelection {
    const g = chart.plot
        .append('g')
        .attr('class', 'chart-axis')
        .call(
            axis
                .tickSizeOuter(0)
                .tickPadding(8)
                .tickSize(options.grid ? -chart.innerWidth : 0)
        );
    styleAxis(g, Boolean(options.grid));
    if (options.label) {
        g.append('text')
            .attr('x', -chart.margin.left + 4)
            .attr('y', -12)
            .attr('text-anchor', 'start')
            .attr('fill', 'currentColor')
            .text(options.label);
    }
    return g;
}

/**
 * Ticks for a log axis at 1, 3, 10, 30… — few enough that every one is
 * labelled and every gridline names a value.
 */
export function logTicks([lo, hi]: [number, number]): number[] {
    const ticks: number[] = [];
    for (let k = Math.floor(Math.log10(lo)); k <= Math.ceil(Math.log10(hi)); k++) {
        for (const m of [1, 3]) {
            const v = m * 10 ** k;
            if (v >= lo && v <= hi) ticks.push(v);
        }
    }
    return ticks;
}

/** Counts as an axis reads them: in full under 10,000, compact past it. */
export function formatTick(value: number): string {
    return Math.abs(value) >= 10_000
        ? value.toLocaleString(undefined, { notation: 'compact', maximumFractionDigits: 1 })
        : Math.round(value).toLocaleString();
}

/**
 * A horizontal bar as a path, rounded only on the ends asked for: the data end
 * of a bar is rounded, the end on the baseline stays square.
 */
export function horizontalBar(
    x0: number,
    x1: number,
    y: number,
    height: number,
    round: { left?: boolean; right?: boolean }
): string {
    const w = Math.max(0, x1 - x0);
    const r = Math.min(MARK.barRadius, w / 2, height / 2);
    const rl = round.left ? r : 0;
    const rr = round.right ? r : 0;
    const y1 = y + height;
    return [
        `M${x0 + rl},${y}`,
        `H${x1 - rr}`,
        rr ? `Q${x1},${y} ${x1},${y + rr}` : '',
        `V${y1 - rr}`,
        rr ? `Q${x1},${y1} ${x1 - rr},${y1}` : '',
        `H${x0 + rl}`,
        rl ? `Q${x0},${y1} ${x0},${y1 - rl}` : '',
        `V${y + rl}`,
        rl ? `Q${x0},${y} ${x0 + rl},${y}` : '',
        'Z',
    ].join('');
}

/** A column grown from the baseline at `y0`, rounded at its top. */
export function verticalBar(x: number, width: number, y0: number, y1: number): string {
    const h = Math.max(0, y0 - y1);
    const r = Math.min(MARK.barRadius, width / 2, h);
    return [
        `M${x},${y0}`,
        `V${y1 + r}`,
        r ? `Q${x},${y1} ${x + r},${y1}` : '',
        `H${x + width - r}`,
        r ? `Q${x + width},${y1} ${x + width},${y1 + r}` : '',
        `V${y0}`,
        'Z',
    ].join('');
}

/**
 * A sequential ramp from a module's `-soft` tint to its peak, as CSS. The
 * tint is pale on paper and deep on ink, so in both themes the high values
 * are the ones that stand out from the surface. Mixed in CIELAB, like
 * `sequentialColors` in themeColors.ts, which resolves the same steps for a
 * canvas.
 */
export function sequentialRamp(module: ModuleId, steps = 6): string[] {
    return d3.range(steps).map((i) => {
        const at = Math.round(rampPosition(i, steps) * 100);
        return `color-mix(in lab, var(--peak-${module}) ${at}%, var(--accent-${module}-soft))`;
    });
}

/** A legend of named colours: a swatch beside each name, text in ink. */
export function swatchLegend(items: Array<{ label: string; color: string }>): HTMLDivElement {
    const root = document.createElement('div');
    root.className = 'chart-legend';
    for (const { label, color } of items) {
        const item = document.createElement('span');
        item.className = 'chart-legend-item';
        const swatch = document.createElement('span');
        swatch.className = 'chart-legend-swatch';
        swatch.style.background = color;
        const name = document.createElement('span');
        name.textContent = label;
        item.append(swatch, name);
        root.appendChild(item);
    }
    return root;
}

/** The legend of a stepped ramp: its title, one block per step, the thresholds between. */
export function rampLegend(options: {
    title: string;
    colors: string[];
    thresholds: number[];
    format?: (value: number) => string;
}): HTMLDivElement {
    const { title, colors, thresholds, format = formatTick } = options;
    const STEP = 34; // block width plus the gap, as `.chart-ramp-steps` lays them out
    const root = document.createElement('div');
    root.className = 'chart-legend';

    const ramp = document.createElement('div');
    ramp.className = 'chart-ramp';
    const heading = document.createElement('span');
    heading.className = 'chart-legend-title';
    heading.textContent = title;

    const steps = document.createElement('div');
    steps.className = 'chart-ramp-steps';
    for (const color of colors) {
        const block = document.createElement('span');
        block.style.background = color;
        steps.appendChild(block);
    }

    const ticks = document.createElement('div');
    ticks.className = 'chart-ramp-ticks';
    ticks.style.width = `${colors.length * STEP}px`;
    thresholds.forEach((value, i) => {
        const tick = document.createElement('span');
        tick.style.left = `${(i + 1) * STEP - 1}px`;
        tick.textContent = format(value);
        ticks.appendChild(tick);
    });

    ramp.append(heading, steps, ticks);
    root.appendChild(ramp);
    return root;
}

/**
 * Hover for dense dots: the nearest point within reach answers, so the pointer
 * never has to land on an 8px mark. The hovered dot takes an ink ring.
 */
export function hoverNearest<T>(
    chart: Chart,
    points: T[],
    position: (d: T) => [number, number],
    radius: (d: T) => number,
    describe: (d: T) => { title: string; lines?: string[] },
    reach = 24
) {
    if (points.length === 0) return;
    const coords = points.map(position);
    const delaunay = d3.Delaunay.from(coords);
    const ring = chart.plot
        .append('circle')
        .attr('fill', 'none')
        .attr('stroke', CHART.ink)
        .attr('stroke-width', 1.5)
        .attr('pointer-events', 'none')
        .attr('visibility', 'hidden');

    chart.plot
        .append('rect')
        .attr('width', chart.innerWidth)
        .attr('height', chart.innerHeight)
        .attr('fill', 'transparent')
        .on('pointermove', (event: PointerEvent) => {
            const [mx, my] = d3.pointer(event);
            const i = delaunay.find(mx, my);
            const [px, py] = coords[i];
            const d = points[i];
            if (Math.hypot(px - mx, py - my) > reach + radius(d)) {
                ring.attr('visibility', 'hidden');
                chart.tooltip.hide();
                return;
            }
            ring.attr('cx', px)
                .attr('cy', py)
                .attr('r', radius(d) + 2)
                .attr('visibility', 'visible');
            const { title, lines } = describe(d);
            chart.tooltip.show(event, title, lines);
        })
        .on('pointerleave', () => {
            ring.attr('visibility', 'hidden');
            chart.tooltip.hide();
        });
}

/** Text that stays legible over marks: ink on a ring of the surface colour. */
export function haloText<T extends d3.BaseType, D>(
    selection: d3.Selection<T, D, d3.BaseType, unknown>
) {
    return selection
        .attr('fill', CHART.ink)
        .attr('stroke', CHART.surface)
        .attr('stroke-width', 3)
        .attr('stroke-linejoin', 'round')
        .attr('paint-order', 'stroke');
}
