import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
    createChart,
    emptyChart,
    horizontalBar,
    logTicks,
    rampLegend,
    sequentialRamp,
    swatchLegend,
} from './chart';

describe('createChart', () => {
    it('builds the SVG on the shared chart class, with an accessible name', () => {
        const chart = createChart({
            width: 400,
            height: 200,
            margin: { top: 10, right: 10, bottom: 20, left: 30 },
            label: 'A chart',
        });
        const svg = chart.root.querySelector('svg');
        expect(svg?.getAttribute('class')).toBe('chart-svg');
        expect(svg?.getAttribute('aria-label')).toBe('A chart');
        expect(chart.innerWidth).toBe(360);
        expect(chart.innerHeight).toBe(170);
    });

    it('keeps the tooltip hidden and out of exports until it is shown', () => {
        const chart = createChart({
            width: 100,
            height: 100,
            margin: { top: 0, right: 0, bottom: 0, left: 0 },
            label: 'x',
        });
        const tip = chart.root.querySelector<HTMLElement>('.chart-tooltip');
        expect(tip?.hidden).toBe(true);
        expect(tip?.dataset.exportHide).toBe('');

        chart.tooltip.show({ clientX: 10, clientY: 10 }, 'Title', ['A line']);
        expect(tip?.hidden).toBe(false);
        expect(tip?.querySelector('strong')?.textContent).toBe('Title');
        expect(tip?.textContent).toContain('A line');
    });
});

describe('logTicks', () => {
    it('steps 1, 3, 10, 30 inside the domain', () => {
        expect(logTicks([20, 4000])).toEqual([30, 100, 300, 1000, 3000]);
    });
});

describe('horizontalBar', () => {
    it('rounds only the end it is asked to', () => {
        const right = horizontalBar(0, 100, 0, 20, { right: true });
        // Square on the left: the path starts at the very corner and runs
        // straight down the left edge.
        expect(right.startsWith('M0,0')).toBe(true);
        expect(right).toContain('Q100,0');
        expect(right).not.toContain('Q0,');
    });
});

describe('sequentialRamp', () => {
    it('steps from the module tint towards its peak', () => {
        const ramp = sequentialRamp('listening', 6);
        expect(ramp).toHaveLength(6);
        expect(ramp.at(-1)).toContain('var(--peak-listening) 100%');
        expect(ramp[0]).toContain('var(--accent-listening-soft)');
    });
});

describe('legends and placeholders', () => {
    it('names every swatch in text', () => {
        const legend = swatchLegend([
            { label: 'Me', color: 'blue' },
            { label: 'Them', color: 'grey' },
        ]);
        expect(legend.textContent).toBe('MeThem');
    });

    it('puts a threshold between every two steps of a ramp', () => {
        const legend = rampLegend({
            title: 'Minutes',
            colors: ['a', 'b', 'c'],
            thresholds: [5, 10],
        });
        expect(legend.querySelectorAll('.chart-ramp-ticks > span')).toHaveLength(2);
    });

    it('renders the empty message', () => {
        expect(emptyChart('No data').textContent).toBe('No data');
    });
});

describe('chart theming', () => {
    it('leaves no fixed colour in the D3 chart factories', () => {
        // Every colour a chart paints is a token, so it follows the theme; a
        // literal is right in one of the two themes at best.
        const dir = join(process.cwd(), 'src/lib/visualizations/d3');
        const offenders: string[] = [];
        for (const file of readdirSync(dir)) {
            if (!file.endsWith('.ts') || file.endsWith('.test.ts')) continue;
            const source = readFileSync(join(dir, file), 'utf-8');
            for (const [i, line] of source.split('\n').entries()) {
                if (/['"]#[0-9a-f]{3,8}['"]|rgba?\(\d/i.test(line)) {
                    offenders.push(`${file}:${i + 1} ${line.trim()}`);
                }
            }
        }
        expect(offenders).toEqual([]);
    });
});
