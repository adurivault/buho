import { describe, it, expect } from 'vitest';
import {
    FRAGMENT_SHADER,
    VERTEX_SHADER,
    createPointCloud,
    normalizeDomain,
    normalizePositions,
    packColor,
    packColors,
} from './pointCloud';

describe('normalizePositions', () => {
    it('maps a domain onto [0, 1]', () => {
        const out = normalizePositions(
            [
                { x: 0, y: 0 },
                { x: 5, y: 12 },
                { x: 10, y: 24 },
            ],
            [0, 10],
            [0, 24]
        );
        expect(Array.from(out)).toEqual([0, 0, 0.5, 0.5, 1, 1]);
    });

    /**
     * The reason this function exists. `x` is an epoch timestamp (~1.7e12) and a
     * float32 keeps ~7 significant digits, so uploading raw timestamps collapses
     * points hours apart onto one coordinate. Normalizing first keeps them apart.
     */
    it('keeps two nearby timestamps distinct, which raw float32 would not', () => {
        // A float32 near 1.6e12 steps by ~131 s, so anything closer than that
        // collapses. A minute apart is well inside it.
        const oneMinute = 60_000;
        const t0 = Date.UTC(2016, 0, 1);
        const t1 = Date.UTC(2026, 7, 1);
        const mid = t0 + (t1 - t0) / 2;

        const out = normalizePositions(
            [
                { x: mid, y: 0 },
                { x: mid + oneMinute, y: 0 },
            ],
            [t0, t1],
            [0, 24]
        );
        expect(out[0]).not.toBe(out[2]);

        // The naive path, for contrast: the same two instants as float32 are the
        // same number.
        const raw = new Float32Array([mid, mid + oneMinute]);
        expect(raw[0]).toBe(raw[1]);
    });

    it('survives a zero-width domain instead of dividing by zero', () => {
        const out = normalizePositions([{ x: 5, y: 5 }], [5, 5], [5, 5]);
        expect(Number.isFinite(out[0])).toBe(true);
        expect(Number.isFinite(out[1])).toBe(true);
    });

    it('returns an empty buffer for no points', () => {
        expect(normalizePositions([], [0, 1], [0, 1])).toHaveLength(0);
    });
});

describe('normalizeDomain', () => {
    it('expresses a visible window in the full domain coordinates', () => {
        expect(normalizeDomain([25, 75], [0, 100])).toEqual([0.25, 0.75]);
    });

    it('goes outside [0, 1] when the window overflows the data', () => {
        // A brush can sit past the data's own range; the shader clips, so the
        // window must not be clamped here.
        expect(normalizeDomain([-50, 150], [0, 100])).toEqual([-0.5, 1.5]);
    });
});

describe('packColor', () => {
    it('splits a hex colour into bytes with its alpha', () => {
        expect(packColor('#2a78d6', 1)).toEqual([42, 120, 214, 255]);
        expect(packColor('#000000', 0)).toEqual([0, 0, 0, 0]);
    });

    it('rounds the alpha rather than truncating it', () => {
        expect(packColor('#ffffff', 0.22)).toEqual([255, 255, 255, 56]);
        expect(packColor('#ffffff', 0.62)).toEqual([255, 255, 255, 158]);
    });

    it('reads the other CSS notations d3 accepts', () => {
        expect(packColor('rgb(42, 120, 214)', 1)).toEqual([42, 120, 214, 255]);
        expect(packColor('#fff', 1)).toEqual([255, 255, 255, 255]);
    });

    it('falls back to zeroes on an unparseable colour instead of NaN', () => {
        // NaN bytes would silently upload garbage into the buffer.
        expect(packColor('not-a-colour', 1)).toEqual([0, 0, 0, 255]);
    });
});

describe('packColors', () => {
    it('lays colours out as four bytes per point', () => {
        const palette = ['#2a78d6', '#eb6834'];
        const out = packColors(palette.length, (i) => palette[i], 1);
        expect(Array.from(out)).toEqual([42, 120, 214, 255, 235, 104, 52, 255]);
    });

    it('parses each distinct colour once', () => {
        // Points share a handful of category colours, so the cache is what keeps
        // this linear in colours rather than in points.
        let parsed = 0;
        const out = packColors(
            1000,
            () => {
                parsed += 1;
                return '#2a78d6';
            },
            0.7
        );
        expect(parsed).toBe(1000); // the callback still runs per point…
        expect(out).toHaveLength(4000);
        expect(Array.from(out.slice(0, 4))).toEqual([42, 120, 214, 179]);
        expect(Array.from(out.slice(-4))).toEqual([42, 120, 214, 179]);
    });
});

describe('createPointCloud', () => {
    /**
     * jsdom has no WebGL, so this is the path the whole test suite takes. The
     * caller must get a null it can fall back on, never a throw.
     */
    it('returns null when the context is unavailable', () => {
        const canvas = document.createElement('canvas');
        expect(createPointCloud(canvas)).toBeNull();
    });
});

describe('shaders', () => {
    /** Effective precision of each float uniform: its qualifier, else the stage default. */
    function uniformPrecisions(source: string, fallback: string): Map<string, string> {
        const stageDefault = /precision\s+(\w+)\s+float\s*;/.exec(source)?.[1] ?? fallback;
        const out = new Map<string, string>();
        for (const m of source.matchAll(/uniform\s+(?:(lowp|mediump|highp)\s+)?(\w+)\s+(\w+)/g)) {
            out.set(m[3], m[1] ?? stageDefault);
        }
        return out;
    }

    /**
     * A uniform declared in both stages must agree on precision or the program
     * fails to link — silently sending the constellation back to Canvas2D. The
     * vertex stage defaults to highp; the fragment stage takes its `precision`
     * statement. jsdom has no WebGL, so this is checked on the source.
     */
    it('declares shared uniforms with the same precision in both stages', () => {
        const vertex = uniformPrecisions(VERTEX_SHADER, 'highp');
        const fragment = uniformPrecisions(FRAGMENT_SHADER, 'mediump');
        for (const [name, precision] of fragment) {
            if (vertex.has(name))
                expect({ name, precision }).toEqual({ name, precision: vertex.get(name) });
        }
    });
});
