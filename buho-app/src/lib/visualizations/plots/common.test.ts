import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DARK_THEME, emptyPlot, ridgelinePlot } from './common';

const SERIES = [
    { key: 'A', month: '2024-01-01', value: 10 },
    { key: 'A', month: '2024-02-01', value: 80 },
    { key: 'A', month: '2024-03-01', value: 20 },
    { key: 'A', month: '2024-04-01', value: 60 },
];

/** Path data of one mark type. Plot labels each mark's group with its name. */
function pathsOf(node: SVGElement, mark: 'area' | 'line'): string[] {
    return [...node.querySelectorAll(`g[aria-label="${mark}"] path`)].map(
        (p) => p.getAttribute('d') ?? '',
    );
}

function ridge(data = SERIES) {
    const node = ridgelinePlot(data, { width: 600 }) as SVGElement;
    return { areas: pathsOf(node, 'area'), lines: pathsOf(node, 'line') };
}

describe('ridgelinePlot', () => {
    it('draws the fill as one path per series, not one per interval', () => {
        // A per-point channel on the area makes Plot split it into segments,
        // which silently replaces the curve with straight lines.
        expect(ridge().areas).toHaveLength(1);
    });

    it('traces the outline over exactly the surface it fills', () => {
        const { areas, lines } = ridge();
        const [area] = areas;
        const [line] = lines;

        // The area walks its top edge first, then closes back along the
        // baseline: the outline must be that leading run, character for
        // character. Any curve mismatch shows up here.
        expect(area.startsWith(line)).toBe(true);
        expect(line).toContain('C'); // genuinely curved, not a polyline
    });

    it('keeps one ridge per series', () => {
        const { areas, lines } = ridge([
            ...SERIES,
            { key: 'B', month: '2024-01-01', value: 5 },
            { key: 'B', month: '2024-02-01', value: 40 },
        ]);
        expect(areas).toHaveLength(2);
        expect(lines).toHaveLength(2);
    });

    it('falls back to a placeholder rather than an empty chart', () => {
        const node = ridgelinePlot([], { emptyMessage: 'Nothing here' });
        expect((node as HTMLElement).textContent).toBe('Nothing here');
    });
});

describe('emptyPlot', () => {
    it('renders the message', () => {
        expect(emptyPlot('No data').textContent).toBe('No data');
    });
});

describe('chart theming', () => {
    it('inherits the page colour instead of pinning one', () => {
        // A fixed hex here is a pale grey on white: readable on the dark theme
        // only. `currentColor` follows whichever theme is showing.
        expect(DARK_THEME.style.color).toBe('currentColor');
    });

    it('leaves no theme-locked colour in the plot factories', () => {
        const dir = join(process.cwd(), 'src/lib/visualizations/plots');
        const offenders: string[] = [];

        for (const file of readdirSync(dir)) {
            if (!file.endsWith('.ts') || file.endsWith('.test.ts')) continue;
            const source = readFileSync(join(dir, file), 'utf-8');
            for (const [i, line] of source.split('\n').entries()) {
                // Text and hairlines must ride on currentColor, and separators on
                // the page background; a literal near-black or near-white is
                // invisible in one of the two themes.
                if (/(fill|stroke):\s*"#(e0e6ed|0f172a|1f2937|cbd5e1|94a3b8)"/i.test(line)) {
                    offenders.push(`${file}:${i + 1} ${line.trim()}`);
                }
            }
        }

        expect(offenders).toEqual([]);
    });
});
