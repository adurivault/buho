import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createComposer } from './compose';

/**
 * A 2D context that records what it was asked to do.
 *
 * The compositor's job is entirely geometric — where a plate ends, where a
 * layer lands on it, what is left out — and that is checkable without pixels.
 */
type Call = { op: string; args: unknown[] };

function recordingContext(calls: Call[]) {
    const record =
        (op: string) =>
        (...args: unknown[]) =>
            void calls.push({ op, args });

    return {
        setTransform: record('setTransform'),
        clearRect: record('clearRect'),
        fillRect: record('fillRect'),
        fillText: record('fillText'),
        drawImage: record('drawImage'),
        translate: record('translate'),
        save: record('save'),
        restore: record('restore'),
        beginPath: record('beginPath'),
        rect: record('rect'),
        roundRect: record('roundRect'),
        clip: record('clip'),
        fill: record('fill'),
        measureText: () => ({ width: 10, fontBoundingBoxAscent: 8, fontBoundingBoxDescent: 2 }),
        globalAlpha: 1,
        fillStyle: '',
        font: '',
        textAlign: 'left',
        textBaseline: 'alphabetic',
    };
}

/** jsdom lays nothing out, so every box in the test is stated outright. */
function place(el: Element, box: { x: number; y: number; width: number; height: number }) {
    el.getBoundingClientRect = () =>
        ({
            x: box.x,
            y: box.y,
            left: box.x,
            top: box.y,
            right: box.x + box.width,
            bottom: box.y + box.height,
            width: box.width,
            height: box.height,
            toJSON: () => ({}),
        }) as DOMRect;
}

let calls: Call[];

beforeEach(() => {
    calls = [];
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
        () => recordingContext(calls) as unknown as CanvasRenderingContext2D
    );
});

afterEach(() => vi.restoreAllMocks());

function chart() {
    const host = document.createElement('div');
    place(host, { x: 100, y: 50, width: 400, height: 200 });
    document.body.appendChild(host);
    return host;
}

describe('createComposer', () => {
    it('sizes the plate from the chart plus its padding', () => {
        const composer = createComposer(chart(), { scale: 1, padding: 20, credit: null });
        expect(composer.width).toBe(440);
        expect(composer.height).toBe(240);
    });

    it('scales the plate without changing its proportions', () => {
        const composer = createComposer(chart(), { scale: 2, padding: 20, credit: null });
        expect(composer.width).toBe(880);
        expect(composer.height).toBe(480);
    });

    it('always hands back even dimensions, which H.264 requires', () => {
        const host = chart();
        place(host, { x: 0, y: 0, width: 401, height: 201 });
        const composer = createComposer(host, { scale: 1, padding: 0, credit: null });
        expect(composer.width % 2).toBe(0);
        expect(composer.height % 2).toBe(0);
    });

    it('reserves a band for a title and a credit', () => {
        const plain = createComposer(chart(), { scale: 1, padding: 20, credit: null });
        const titled = createComposer(chart(), {
            scale: 1,
            padding: 20,
            title: 'Top artists',
            credit: 'buho-app.com',
        });
        expect(titled.height).toBeGreaterThan(plain.height);
        expect(titled.width).toBe(plain.width);
    });

    it('takes the scrolled width, not the visible one', () => {
        const host = chart();
        Object.defineProperty(host, 'scrollWidth', { value: 900, configurable: true });
        const composer = createComposer(host, { scale: 1, padding: 0, credit: null });
        expect(composer.width).toBe(900);
    });

    it('paints the background over the whole plate', async () => {
        const composer = createComposer(chart(), { scale: 1, padding: 20, credit: null });
        await composer.paint();
        expect(calls).toContainEqual({ op: 'fillRect', args: [0, 0, 440, 240] });
    });

    it('places a canvas layer at its offset inside the plate', async () => {
        const host = chart();
        const layer = document.createElement('canvas');
        layer.width = 400;
        layer.height = 200;
        place(layer, { x: 110, y: 60, width: 380, height: 180 });
        host.appendChild(layer);

        const composer = createComposer(host, { scale: 1, padding: 20, credit: null });
        await composer.paint();

        // The chart's own box starts at (100, 50); the layer sits 10px into it,
        // and the plate adds 20px of padding on both axes.
        expect(calls).toContainEqual({ op: 'drawImage', args: [layer, 110, 60, 380, 180] });
    });

    it('leaves out anything marked data-export-hide', async () => {
        const host = chart();
        const hidden = document.createElement('canvas');
        hidden.width = 10;
        hidden.height = 10;
        hidden.dataset.exportHide = '';
        place(hidden, { x: 100, y: 50, width: 10, height: 10 });
        host.appendChild(hidden);

        const composer = createComposer(host, { scale: 1, padding: 0, credit: null });
        await composer.paint();

        expect(calls.filter((c) => c.op === 'drawImage')).toHaveLength(0);
    });

    it('clips to the chart box, so an overflowing layer cannot bleed', async () => {
        const composer = createComposer(chart(), { scale: 1, padding: 20, credit: null });
        await composer.paint();
        expect(calls).toContainEqual({ op: 'rect', args: [20, 20, 400, 200] });
        expect(calls.some((c) => c.op === 'clip')).toBe(true);
    });
});
