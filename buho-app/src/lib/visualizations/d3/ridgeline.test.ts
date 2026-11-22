import { describe, it, expect } from 'vitest';
import { ridgelineChart, type RidgeRow } from './ridgeline';

const SERIES: RidgeRow[] = [
    { key: 'A', month: '2024-01-01', value: 10 },
    { key: 'A', month: '2024-02-01', value: 80 },
    { key: 'A', month: '2024-03-01', value: 20 },
    { key: 'A', month: '2024-04-01', value: 60 },
];

function ridge(data = SERIES) {
    const node = ridgelineChart(data, { width: 600, color: 'var(--accent-listening)' });
    const paths = (cls: string) =>
        [...node.querySelectorAll(`path.${cls}`)].map((p) => p.getAttribute('d') ?? '');
    return { areas: paths('ridge-area'), lines: paths('ridge-line') };
}

describe('ridgelineChart', () => {
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

    it('stacks the series in the order they first appear', () => {
        const node = ridgelineChart(
            [
                { key: 'Late', month: '2024-05-01', value: 3 },
                { key: 'Early', month: '2024-01-01', value: 3 },
            ],
            { color: 'red' }
        );
        const names = [...node.querySelectorAll('svg > g > g > text')]
            .map((t) => t.textContent)
            .filter((name) => name === 'Late' || name === 'Early');
        expect(names).toEqual(['Early', 'Late']);
    });

    it('falls back to a placeholder rather than an empty chart', () => {
        const node = ridgelineChart([], { color: 'red', emptyMessage: 'Nothing here' });
        expect(node.textContent).toBe('Nothing here');
    });
});
