import { hsl, interpolateLab, rgb } from 'd3';
import type { ModuleId } from '#lib/data/modules.ts';
/**
 * Reads the theme tokens (defined in HSL in app.css) from the DOM, so that the
 * Canvas/D3 visualizations — which manipulate color strings, not CSS — follow the
 * light/dark toggle. Call it at render time; on the chart side, depending on
 * `themeStore.theme` inside the render effect is enough to re-render on toggle.
 */
function readToken(token: string): string {
    if (typeof document === 'undefined') return '';
    return getComputedStyle(document.documentElement).getPropertyValue(token).trim();
}

/** Returns a color token as `hsl(...)` (or a fallback if unavailable). */
export function themeHsl(token: string, fallback = 'transparent'): string {
    const v = readToken(token);
    return v ? `hsl(${v})` : fallback;
}

/**
 * A theme token as `#rrggbb`, for code that parses colours (d3, WebGL) rather
 * than handing them to CSS: d3 does not read the space-separated `hsl()` the
 * tokens are written in.
 */
export function themeHex(token: string, fallback: string): string {
    const [h, s, l] = readToken(token)
        .split(/[\s%]+/)
        .filter(Boolean)
        .map(Number);
    if (![h, s, l].every(Number.isFinite)) return fallback;
    return hsl(h, s / 100, l / 100).formatHex();
}

/** Common theme colors for the visualizations. */
export function vizColors() {
    return {
        background: themeHsl('--background', '#16130f'),
        foreground: themeHsl('--foreground', '#e7e2da'),
        border: themeHsl('--border', 'rgb(71 85 105 / 0.45)'),
        muted: themeHsl('--muted', '#2e2922'),
        mutedForeground: themeHsl('--muted-foreground', '#988e80'),
    };
}

/*
 * A module's colours as the current theme paints them, for the charts that draw
 * on a canvas or in WebGL and so cannot take `var(--fill-…)` themselves. SVG
 * charts should use the variables directly: they follow the theme without a
 * re-render, and the exporter resolves them. A chart paints a module in its
 * fill or its peak; the accent itself is for text.
 *
 * Like {@link themeHsl}, read them at render time and depend on
 * `themeStore.theme` to redraw on a toggle. The fallbacks are the light values,
 * for the server render and for tests.
 */

/** The module's `-soft` tint, the pale end of its sequential ramp. */
export function accentSoftColor(module: ModuleId): string {
    return readToken(`--accent-${module}-soft`) || LIGHT_SOFT_ACCENTS[module];
}

/**
 * The module's colour for an area or a run of bars (`--fill-*` in app.css):
 * a pastel on paper, the accent itself on ink.
 */
export function fillColor(module: ModuleId): string {
    return readToken(`--fill-${module}`) || LIGHT_FILLS[module];
}

/**
 * The module's dense step (`--peak-*`): the strong end of its ramp, and the
 * colour of the marks too thin to carry a pastel — lines, ticks, dots.
 */
export function peakColor(module: ModuleId): string {
    return readToken(`--peak-${module}`) || LIGHT_PEAKS[module];
}

/**
 * The chart roles (see `--chart-*` in app.css), resolved as hex for a canvas or
 * WebGL. Read at render time and redraw on `themeStore.theme`, like {@link themeHsl}.
 */
export function chartColors() {
    return {
        surface: themeHex('--card', '#ffffff'),
        ink: themeHex('--foreground', '#242424'),
        muted: themeHex('--muted-foreground', '#636363'),
        grid: themeHex('--border', '#dcdcdc'),
        axis: themeHex('--border-strong', '#8a8a8a'),
    };
}

/**
 * A canvas font on the app's type scale: `--text-label` for ticks, `--text-small`
 * for the labels that name things. A canvas cannot take `var()`, so the face and
 * the size are read off the root and the rem turned into pixels.
 */
export function chartFont(step: 'label' | 'small' = 'label', weight = 400): string {
    const family = readToken('--font-sans') || 'system-ui, sans-serif';
    const rem = parseFloat(readToken(`--text-${step}`)) || (step === 'label' ? 0.72 : 0.78);
    const rootPx =
        typeof document === 'undefined'
            ? 16
            : parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    return `${weight} ${Math.round(rem * rootPx * 10) / 10}px ${family}`;
}

/**
 * Where step `i` of an `n`-step sequential ramp sits between a module's tint (0)
 * and its accent (1). The first step starts a little into the ramp, so the
 * smallest value still shows against the surface.
 */
export function rampPosition(i: number, n: number): number {
    return n <= 1 ? 1 : 0.12 + 0.88 * (i / (n - 1));
}

/**
 * The same ramp as `sequentialRamp` in `d3/chart.ts`, resolved for a canvas:
 * mixed in CIELAB, as the CSS `color-mix(in lab, …)` there is. The tint is pale
 * on paper and deep on ink, so high values stand out from the surface in both.
 */
export function sequentialColors(module: ModuleId, steps = 6): string[] {
    const mix = interpolateLab(accentSoftColor(module), peakColor(module));
    return Array.from({ length: steps }, (_, i) => rgb(mix(rampPosition(i, steps))).formatHex());
}

/**
 * The light theme's ramp, for a surface that stays paper in both themes (the
 * zone map's white land): the same tint-to-peak steps, fixed to their light
 * values.
 */
export function paperRamp(module: ModuleId, steps = 5): string[] {
    const mix = interpolateLab(LIGHT_SOFT_ACCENTS[module], LIGHT_PEAKS[module]);
    return Array.from({ length: steps }, (_, i) => rgb(mix(rampPosition(i, steps))).formatHex());
}

const LIGHT_SOFT_ACCENTS: Record<ModuleId, string> = {
    listening: '#f5ecfe',
    positions: '#feece5',
    messages: '#e5f2ff',
    activity: '#fceeda',
    steps: '#e7f5e2',
    health: '#ffeaf1',
};

const LIGHT_FILLS: Record<ModuleId, string> = {
    listening: '#c89af1',
    positions: '#f69370',
    messages: '#6fb6fe',
    activity: '#ebb353',
    steps: '#87c571',
    health: '#f28db4',
};

const LIGHT_PEAKS: Record<ModuleId, string> = {
    listening: '#9658c6',
    positions: '#c94c18',
    messages: '#017dd6',
    activity: '#b87501',
    steps: '#3f9015',
    health: '#c3457e',
};

/** `#rrggbb` to its channels, for WebGL layers that take numbers. */
export function hexToRgb(hex: string): [number, number, number] {
    const value = hex.replace('#', '');
    return [0, 2, 4].map((at) => parseInt(value.slice(at, at + 2), 16)) as [number, number, number];
}
