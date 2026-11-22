/**
 * The year's clock: the open year laid round a clock face, the 1st of January
 * just right of the top and the 31st of December just left of it, a gap
 * between them where the year turns. Each day is a spoke from midnight at the
 * inner edge to midnight at the rim, cut into quarter-hours like the day's
 * tracks, so a time of day is a ring and a habit runs round the year. It
 * shows every module at once, a quarter-hour in the colour of what happened
 * in it, or one module alone, each quarter-hour shaded by how much it held.
 *
 * Pure (no DB, no DOM).
 */
import type { ModuleId } from '#lib/data/modules.ts';
import { QUARTERS_PER_DAY } from './timeline';

/**
 * The order the modules are painted in when they share the dial, each over the
 * ones before: what runs on for a while — walking, travelling — underneath,
 * and what happens in an instant — a play, a search, a message — on top, so a
 * message sent on the way somewhere still shows.
 */
export const DIAL_ORDER: ModuleId[] = ['steps', 'positions', 'listening', 'activity', 'messages'];

/** One quarter-hour of one day, and how much a module did in it. */
export interface QuarterCell {
    /** 'YYYY-MM-DD' */
    date: string;
    /** 0–95: the quarter-hour of the record's own wall clock. */
    quarter: number;
    value: number;
}

export interface DialGeometry {
    cx: number;
    cy: number;
    /** Radius of the day's first minute, 00:00. */
    inner: number;
    /** Radius of its last, 24:00. */
    outer: number;
    days: number;
    /** Share of the turn left empty at the top, between the year's last day and its first. */
    gap: number;
}

/** Fraction of a turn, clockwise from the top, of a point at offset (dx, dy) from the centre. */
export function turnAt(dx: number, dy: number): number {
    const turn = (Math.atan2(dy, dx) + Math.PI / 2) / (2 * Math.PI);
    return turn < 0 ? turn + 1 : turn >= 1 ? turn - 1 : turn;
}

/**
 * Where fraction `time` of day `day` lies. `day` may fall between days —
 * `day + 0.5` is a day's middle, `day` its edge before — and `time` outside
 * 0–1, in the dial's hole or past its rim.
 */
export function dialPoint(g: DialGeometry, day: number, time: number): [number, number] {
    const turn = g.gap / 2 + (day / g.days) * (1 - g.gap);
    const r = g.inner + (g.outer - g.inner) * time;
    const angle = turn * 2 * Math.PI - Math.PI / 2;
    return [g.cx + r * Math.cos(angle), g.cy + r * Math.sin(angle)];
}

/**
 * The day (its index in the year) under a point, and how far through it the
 * point is; null in the hole, past the rim, or in the gap at the top.
 */
export function dialAt(
    g: DialGeometry,
    x: number,
    y: number
): { day: number; time: number } | null {
    const r = Math.hypot(x - g.cx, y - g.cy);
    if (r < g.inner || r > g.outer) return null;
    const turn = turnAt(x - g.cx, y - g.cy);
    const day = Math.floor(((turn - g.gap / 2) / (1 - g.gap)) * g.days);
    if (day < 0 || day >= g.days) return null;
    return { day, time: (r - g.inner) / (g.outer - g.inner) };
}

/**
 * Where a module's quarter-hours step up from one shade to the next, cut at
 * quantiles of the year's own values, so each shade holds about as many
 * quarter-hours as the next and the dial never ends up one colour. A
 * quarter-hour lies on step `k` when its value is above `k` of the cuts. Cuts
 * that fall together, as small counts do, are kept once, so a module with few
 * distinct values gets fewer steps, none of them empty.
 */
export function quarterSteps(cells: QuarterCell[], steps: number): number[] {
    const values = cells
        .map((cell) => cell.value)
        .filter((value) => value > 0)
        .sort((a, b) => a - b);
    if (values.length === 0) return [];
    const top = values[values.length - 1];
    const cuts: number[] = [];
    for (let k = 1; k < steps; k++) {
        const cut = values[Math.ceil((k * values.length) / steps) - 1];
        if (cut < top && cut !== cuts[cuts.length - 1]) cuts.push(cut);
    }
    return cuts;
}

/**
 * A module's quarter-hours, `days.length × 96`: 0 where it recorded nothing,
 * `1 + k` where it recorded something on step `k` of `cuts`. Quarter-hours
 * outside `days` are ignored.
 */
export function quarterGrid(cells: QuarterCell[], days: string[], cuts: number[]): Uint8Array {
    const grid = new Uint8Array(days.length * QUARTERS_PER_DAY);
    const index = new Map(days.map((day, i) => [day, i]));
    for (const cell of cells) {
        const i = index.get(cell.date);
        if (i === undefined || cell.quarter < 0 || cell.quarter >= QUARTERS_PER_DAY) continue;
        if (cell.value <= 0) continue;
        grid[i * QUARTERS_PER_DAY + cell.quarter] =
            1 + cuts.filter((cut) => cell.value > cut).length;
    }
    return grid;
}

/**
 * How far each day's wedges run on over the next day, in days, so that two
 * days side by side close up without a hairline between them.
 */
const OVERLAP = 0.2;

/**
 * A grid as SVG path data, one path per step: each run of quarter-hours on
 * the same step is one wedge of its day's spoke, to be filled in that step's
 * shade. A path of many wedges per step, rather than an element per
 * quarter-hour, keeps a year of them light for the page.
 */
export function dialPaths(grid: Uint8Array, g: DialGeometry, steps: number): string[] {
    const parts: string[][] = Array.from({ length: steps }, () => []);
    const point = (day: number, quarter: number) => {
        const [x, y] = dialPoint(g, day, quarter / QUARTERS_PER_DAY);
        return `${x.toFixed(2)},${y.toFixed(2)}`;
    };
    for (let day = 0; day < g.days; day++) {
        const row = day * QUARTERS_PER_DAY;
        const next = Math.min(g.days, day + 1 + OVERLAP);
        let quarter = 0;
        while (quarter < QUARTERS_PER_DAY) {
            const step = grid[row + quarter];
            if (!step) {
                quarter += 1;
                continue;
            }
            let end = quarter + 1;
            while (end < QUARTERS_PER_DAY && grid[row + end] === step) end += 1;
            parts[step - 1]?.push(
                `M${point(day, quarter)}L${point(day, end)}L${point(next, end)}L${point(next, quarter)}Z`
            );
            quarter = end;
        }
    }
    return parts.map((wedges) => wedges.join(''));
}
