import { describe, expect, it, vi } from 'vitest';
import { openStream } from './video';
import { BASE_FPS } from './pacing';

/** A stand-in for a canvas capture stream, with the frame hook made optional. */
function fakeStream(options: { onTrack?: () => void; onStream?: () => void }) {
    const track = { stop: vi.fn() } as Record<string, unknown>;
    if (options.onTrack) track.requestFrame = options.onTrack;

    const stream = {
        getVideoTracks: () => [track],
        getTracks: () => [track],
    } as Record<string, unknown>;
    if (options.onStream) stream.requestFrame = options.onStream;

    return { stream, track };
}

function fakeCanvas(streams: Array<ReturnType<typeof fakeStream>>) {
    const rates: Array<number | undefined> = [];
    let call = 0;
    return {
        rates,
        canvas: {
            captureStream(rate?: number) {
                rates.push(rate);
                return streams[Math.min(call++, streams.length - 1)].stream as never;
            },
        },
    };
}

describe('openStream', () => {
    it('drives frames by hand where the track offers it', () => {
        const onTrack = vi.fn();
        const { canvas, rates } = fakeCanvas([fakeStream({ onTrack })]);

        const { pushFrame } = openStream(canvas);
        pushFrame();

        expect(rates).toEqual([0]);
        expect(onTrack).toHaveBeenCalledOnce();
    });

    it('finds requestFrame on the stream, which is where Firefox keeps it', () => {
        const onStream = vi.fn();
        const { canvas, rates } = fakeCanvas([fakeStream({ onStream })]);

        const { pushFrame } = openStream(canvas);
        pushFrame();

        expect(rates).toEqual([0]);
        expect(onStream).toHaveBeenCalledOnce();
    });

    it('falls back to a browser-paced stream when neither offers it', () => {
        const manual = fakeStream({});
        const auto = fakeStream({});
        const { canvas, rates } = fakeCanvas([manual, auto]);

        const { stream, pushFrame } = openStream(canvas);

        expect(rates).toEqual([0, BASE_FPS]);
        expect(stream).toBe(auto.stream);
        // The inert stream must not be left holding the canvas.
        expect(manual.track.stop).toHaveBeenCalled();
        expect(() => pushFrame()).not.toThrow();
    });

    it('accepts the prefixed spelling older WebKit shipped', () => {
        const onTrack = vi.fn();
        const { stream } = fakeStream({ onTrack });
        const opened = openStream({
            webkitCaptureStream: () => stream as never,
        });
        opened.pushFrame();
        expect(onTrack).toHaveBeenCalledOnce();
    });

    it('says so plainly when the browser cannot capture a canvas at all', () => {
        expect(() => openStream({})).toThrow(/cannot record video/i);
    });
});
