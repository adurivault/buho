import { describe, it, expect } from 'vitest';
import * as d3 from 'd3';
import { createSunburstColorScale, SUNBURST_PALETTE, type ColorNode } from './sunburstColors';

/** One ring down, as the only child — the simplest possible descent. */
const only = (depth: number): ColorNode => ({ depth, index: 0, siblings: 1 });

describe('spectrum mode', () => {
    it('paints a whole branch in its ring-1 color', () => {
        const scale = createSunburstColorScale('spectrum');
        const root = scale.color('Artist A', []);
        expect(scale.color('Artist A', [only(2)])).toBe(root);
        expect(scale.color('Artist A', [only(2), only(3)])).toBe(root);
    });

    it('gives different categories different colors, in palette order', () => {
        const scale = createSunburstColorScale('spectrum');
        expect(scale.color('Artist A', [])).toBe(SUNBURST_PALETTE[0]);
        expect(scale.color('Artist B', [])).toBe(SUNBURST_PALETTE[1]);
        // Colour follows the entity, not the order it is asked for again.
        expect(scale.color('Artist A', [])).toBe(SUNBURST_PALETTE[0]);
    });
});

describe('branch mode', () => {
    it('keeps a category on its slot whatever else is on screen', () => {
        const a = createSunburstColorScale('branch');
        const b = createSunburstColorScale('branch');
        // Same first-seen order ⇒ same slot; the scale is per-chart, and within
        // one chart the domain only ever grows.
        expect(a.color('youtube', [])).toBe(b.color('youtube', []));
        a.color('search', []);
        expect(a.color('youtube', [])).toBe(b.color('youtube', []));
    });

    it('has its own steps per surface', () => {
        const light = createSunburstColorScale('branch', 'light');
        const dark = createSunburstColorScale('branch', 'dark');
        expect(light.color('youtube', [])).not.toBe(dark.color('youtube', []));
    });

    it('lightens as rings go outwards, so depth reads without the labels', () => {
        const scale = createSunburstColorScale('branch');
        const l = (path: ColorNode[]) => d3.hcl(scale.color('youtube', path)).l;
        expect(l([only(2)])).toBeGreaterThan(l([]));
        expect(l([only(2), only(3)])).toBeGreaterThan(l([only(2)]));
    });

    /**
     * The point of the mode: a descendant must stay recognisably in its parent's
     * family, so the hue may drift but never wander into another slot's.
     */
    it('keeps a descendant inside its ancestor hue family', () => {
        const scale = createSunburstColorScale('branch');
        const base = d3.hcl(scale.color('youtube', []));
        const other = d3.hcl(scale.color('search', []));

        const deep = d3.hcl(
            scale.color('youtube', [
                { depth: 2, index: 0, siblings: 6 },
                { depth: 3, index: 5, siblings: 6 },
            ])
        );

        const gap = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);
        expect(gap(deep.h, base.h)).toBeLessThan(30);
        // …and still much closer to its own root than to a neighbouring one.
        expect(gap(deep.h, base.h)).toBeLessThan(gap(deep.h, other.h));
    });

    it('fans siblings to either side of their parent, leaving an only child on it', () => {
        const scale = createSunburstColorScale('branch');
        const parent = d3.hcl(scale.color('youtube', []));
        const hueOf = (index: number, siblings: number) =>
            d3.hcl(scale.color('youtube', [{ depth: 2, index, siblings }])).h;

        // Within a degree, not exactly: the color round-trips through a hex
        // string, so sRGB quantisation nudges the hue a fraction on the way back.
        expect(Math.abs(hueOf(0, 1) - parent.h)).toBeLessThan(1);
        expect(hueOf(0, 5)).toBeLessThan(parent.h);
        expect(hueOf(4, 5)).toBeGreaterThan(parent.h);
    });

    it('narrows the fan on every further ring', () => {
        const scale = createSunburstColorScale('branch');
        const parent = d3.hcl(scale.color('youtube', []));
        const spread = (depth: number) => {
            const path = Array.from({ length: depth - 1 }, (_, i) => ({
                depth: i + 2,
                index: i === depth - 2 ? 0 : 0,
                siblings: i === depth - 2 ? 5 : 1,
            }));
            return Math.abs(d3.hcl(scale.color('youtube', path)).h - parent.h);
        };
        expect(spread(3)).toBeLessThan(spread(2));
    });
});
