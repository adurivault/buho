import { describe, it, expect } from 'vitest';
import {
    buildCadenceDistribution,
    inCadenceSelection,
    roundedCadence,
    shiftSpan,
    spanFromBars,
    type CadenceSeries,
} from './cadenceDistribution';

/** One counter's (cadence, weight) pairs, as the explorer feeds them in. */
function series(pairs: [number, number][], key = 'walking'): CadenceSeries {
    return {
        key,
        label: key,
        cadences: Float64Array.from(pairs.map(([c]) => c)),
        weights: Float64Array.from(pairs.map(([, w]) => w)),
    };
}

/** The common case: a single counter, so the shape is the whole story. */
function only(pairs: [number, number][]) {
    return [series(pairs)];
}

describe('roundedCadence', () => {
    it('reads a raw ratio to the nearest whole step per minute', () => {
        expect(roundedCadence(112.4)).toBe(112);
        expect(roundedCadence(112.5)).toBe(113);
    });

    it('has no reading for a packet that recorded no active time', () => {
        expect(roundedCadence(null)).toBeNaN();
        expect(roundedCadence(NaN)).toBeNaN();
    });
});

describe('buildCadenceDistribution', () => {
    it('gives every whole cadence its own column, ungrouped', () => {
        const dist = buildCadenceDistribution(
            only([
                [112.4, 100],
                [113.2, 300],
            ])
        );

        expect(dist.columns[112]).toBe(100);
        expect(dist.columns[113]).toBe(300);
        expect(dist.columns[111]).toBe(0);
    });

    it('weights columns by the measure, not by the number of packets', () => {
        const dist = buildCadenceDistribution(
            only([
                [110, 5000],
                [30, 10],
                [30, 10],
                [30, 10],
            ])
        );

        expect(dist.columns[110]).toBeGreaterThan(dist.columns[30]);
    });

    it('reports packets with no active time separately from the shape', () => {
        const dist = buildCadenceDistribution(
            only([
                [100, 100],
                [NaN, 400],
            ])
        );

        expect(dist.unknown).toBe(400);
        expect(dist.total).toBe(100);
        expect(dist.columns.reduce((sum, v) => sum + v, 0)).toBe(100);
    });

    it('carries the axis past the fastest reading it draws', () => {
        const pairs: [number, number][] = [];
        for (let i = 0; i < 2000; i++) pairs.push([100, 10]);
        // A single sprint stays on the axis: the fast end is half the reason to
        // look at a cadence distribution at all.
        pairs.push([164, 10]);
        const dist = buildCadenceDistribution(only(pairs));

        expect(dist.domain[1]).toBeGreaterThanOrEqual(164);
        expect(dist.columns[164]).toBe(10);
        expect(dist.overflow).toBe(0);
        expect(dist.columns.length).toBe(dist.domain[1] + 1);
    });

    it('stops at 200 spm however fast the readings get', () => {
        const dist = buildCadenceDistribution(
            only([
                [100, 1000],
                [196, 30],
                [240, 50],
            ])
        );

        expect(dist.domain[1]).toBe(200);
        expect(dist.columns[196]).toBe(30);
        // Truncated, not folded into the last bar — and still accounted for.
        expect(dist.overflow).toBe(50);
        expect(dist.columns[dist.columns.length - 1]).toBe(0);
    });

    it('leaves the pile of counter artefacts off the axis', () => {
        const pairs: [number, number][] = [];
        for (let i = 0; i < 2000; i++) pairs.push([100, 10]);
        // 200 steps against one second of active time — arithmetic, not gait.
        pairs.push([9000, 10]);
        const dist = buildCadenceDistribution(only(pairs));

        expect(dist.overflow).toBe(10);
        const drawn = dist.columns.reduce((sum, v) => sum + v, 0);
        expect(drawn + dist.overflow).toBe(dist.total);
        // The last column must stay a column, not a bin for everything beyond it.
        expect(dist.columns[dist.columns.length - 1]).toBe(0);
    });

    it('splits band shares exactly where selecting a band would', () => {
        const dist = buildCadenceDistribution(
            only([
                [59.4, 100],
                [59.6, 200],
                [139.6, 300],
                [140, 400],
            ])
        );
        const share = (label: string) => dist.bands.find((b) => b.label === label)?.value;

        // 59.6 reads as 60, so it belongs to the band that starts at 60 — the
        // same reading inCadenceSelection matches on.
        expect(share('< 60')).toBe(100);
        expect(share('60–100')).toBe(200);
        expect(share('140–160')).toBe(700);
        expect(dist.bands.reduce((sum, b) => sum + b.value, 0)).toBe(dist.total);
    });

    it('survives an empty selection', () => {
        const dist = buildCadenceDistribution(only([]));

        expect(dist.total).toBe(0);
        expect(dist.peak).toBe(0);
        expect(dist.domain[1]).toBeGreaterThan(0);
        expect(dist.bands.every((b) => b.value === 0)).toBe(true);
    });
});

describe('buildCadenceDistribution, split by counter', () => {
    const walking = series(
        [
            [110, 800],
            [112, 200],
        ],
        'walking'
    );
    const running = series(
        [
            [168, 300],
            [170, 100],
        ],
        'running'
    );

    it('keeps each counter’s weight where that counter actually ran', () => {
        const dist = buildCadenceDistribution([walking, running]);
        const columns = (key: string) => dist.series.find((s) => s.key === key)?.columns;

        // The running mass sits at running pace, not blended into the walking
        // mode — which is the only reason to read the counters apart.
        expect(columns('walking')?.[110]).toBe(800);
        expect(columns('walking')?.[168]).toBe(0);
        expect(columns('running')?.[168]).toBe(300);
        expect(columns('running')?.[110]).toBe(0);
    });

    it('stacks the counters into the silhouette, on a shared axis', () => {
        const dist = buildCadenceDistribution([walking, running]);

        expect(dist.columns[110]).toBe(800);
        expect(dist.columns[168]).toBe(300);
        expect(dist.total).toBe(1400);
        for (const s of dist.series) expect(s.columns.length).toBe(dist.columns.length);
        expect(dist.series.reduce((sum, s) => sum + s.total, 0)).toBe(dist.total);
    });

    it('lets one counter set the axis for both', () => {
        const dist = buildCadenceDistribution([walking, running]);

        // The running mode has to stay on the axis, thin as it is next to the
        // walking mass — cropping it would hide the entire second curve.
        expect(dist.domain[1]).toBeGreaterThanOrEqual(170);
    });

    it('keeps a counter that recorded nothing, rather than dropping its row', () => {
        const dist = buildCadenceDistribution([walking, series([], 'running')]);

        expect(dist.series).toHaveLength(2);
        expect(dist.series[1].total).toBe(0);
        expect(dist.series[1].columns.every((v) => v === 0)).toBe(true);
    });
});

describe('spanFromBars', () => {
    const domain: [number, number] = [0, 200];

    it('holds both bars, half-open on the upper end', () => {
        expect(spanFromBars(100, 120, domain)).toEqual({ from: 100, to: 121 });
        expect(spanFromBars(120, 100, domain)).toEqual({ from: 100, to: 121 });
    });

    it('leaves the anchor where it is, on either side of it', () => {
        // Dragging one handle must never shift the other, including across it:
        // the anchored bar stays inside every span the drag produces.
        const anchor = 120;
        for (const bar of [140, 130, 120, 110, 90, 121, 119]) {
            const span = spanFromBars(anchor, bar, domain);
            expect(span.from).toBeLessThanOrEqual(anchor);
            expect(span.to).toBeGreaterThan(anchor);
        }
    });

    it('never collapses below one bar', () => {
        expect(spanFromBars(75, 75, domain)).toEqual({ from: 75, to: 76 });
    });

    it('stays on the axis', () => {
        expect(spanFromBars(-40, 300, domain)).toEqual({ from: 0, to: 201 });
    });
});

describe('shiftSpan', () => {
    const domain: [number, number] = [0, 200];

    it('slides a span without changing its width', () => {
        expect(shiftSpan({ from: 100, to: 120 }, 60, domain)).toEqual({ from: 60, to: 80 });
    });

    it('stops at each end of the axis instead of shrinking', () => {
        expect(shiftSpan({ from: 100, to: 120 }, -30, domain)).toEqual({ from: 0, to: 20 });
        expect(shiftSpan({ from: 100, to: 120 }, 400, domain)).toEqual({ from: 181, to: 201 });
    });
});

describe('inCadenceSelection', () => {
    it('is half-open, so adjacent bands never share a reading', () => {
        expect(inCadenceSelection(100, 60, 100)).toBe(false);
        expect(inCadenceSelection(99.6, 60, 100)).toBe(false);
        expect(inCadenceSelection(99.4, 60, 100)).toBe(true);
        expect(inCadenceSelection(100, 100, 140)).toBe(true);
    });

    it('treats a missing bound as open-ended', () => {
        expect(inCadenceSelection(400, 180, null)).toBe(true);
        expect(inCadenceSelection(20, null, 60)).toBe(true);
    });

    it('never places a packet with no cadence inside a selection', () => {
        expect(inCadenceSelection(null, 0, 1000)).toBe(false);
        expect(inCadenceSelection(null, null, null)).toBe(false);
    });
});
