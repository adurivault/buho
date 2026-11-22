import { describe, expect, it, vi } from 'vitest';
import {
    MAX_CLIP_MS,
    MIN_CLIP_MS,
    clipDurationMs,
    clipFps,
    clipSeconds,
    formatIsAvailable,
} from './index';
import type { ShareSource } from './types';
import { GIF_MAX_SECONDS } from './gif';

const still: ShareSource = { name: 'still', element: () => null };
const moving: ShareSource = {
    name: 'moving',
    element: () => null,
    animation: { durationMs: 60_000, seek: () => {} },
};

describe('formatIsAvailable', () => {
    it('always offers a still', () => {
        expect(formatIsAvailable('png', still)).toBe(true);
        expect(formatIsAvailable('png', moving)).toBe(true);
    });

    it('offers no clip for a chart that does not move', () => {
        expect(formatIsAvailable('gif', still)).toBe(false);
        expect(formatIsAvailable('video', still)).toBe(false);
    });

    it('offers a GIF for anything that moves', () => {
        expect(formatIsAvailable('gif', moving)).toBe(true);
    });

    it('offers video only where something can encode it', () => {
        // jsdom has neither VideoEncoder nor MediaRecorder, which is exactly the
        // case the menu has to hide the button in rather than fail on the click.
        expect(formatIsAvailable('video', moving)).toBe(false);
    });

    it('offers video once WebCodecs is present, without MediaRecorder', () => {
        vi.stubGlobal('VideoEncoder', class {});
        vi.stubGlobal('VideoFrame', class {});
        try {
            expect(formatIsAvailable('video', moving)).toBe(true);
        } finally {
            vi.unstubAllGlobals();
        }
    });
});

describe('clipSeconds', () => {
    it('reports the video at its full length', () => {
        expect(clipSeconds('video', moving)).toBe(60);
    });

    it('reports the GIF at its capped length', () => {
        expect(clipSeconds('gif', moving)).toBe(GIF_MAX_SECONDS);
    });

    it('reports nothing for a still chart', () => {
        expect(clipSeconds('gif', still)).toBe(0);
    });
});

describe('clipDurationMs', () => {
    it('leaves the base duration alone at 1×', () => {
        expect(clipDurationMs(12_000)).toBe(12_000);
    });

    it('shortens the clip by the speed the reader picked', () => {
        expect(clipDurationMs(12_000, 2)).toBe(6_000);
        expect(clipDurationMs(12_000, 4)).toBe(3_000);
    });

    it('never goes below a length worth watching', () => {
        expect(clipDurationMs(12_000, 16)).toBe(MIN_CLIP_MS);
    });

    it('never goes past a length worth sending', () => {
        expect(clipDurationMs(240_000)).toBe(MAX_CLIP_MS);
    });

    it('treats a nonsensical speed as no speed at all', () => {
        expect(clipDurationMs(12_000, 0)).toBe(MAX_CLIP_MS);
    });
});

describe('clipFps', () => {
    it('holds the ordinary rate at 1×', () => {
        expect(clipFps(1)).toBe(30);
    });

    it('adds frames as the clip gets shorter, which is where they are missed', () => {
        expect(clipFps(2)).toBe(40);
        expect(clipFps(4)).toBe(50);
    });

    it('stops at a rate every player and re-encoder still takes', () => {
        expect(clipFps(8)).toBe(60);
        expect(clipFps(16)).toBe(60);
    });

    it('never drops below the base for a nonsensical speed', () => {
        expect(clipFps(0)).toBe(30);
        expect(clipFps(0.25)).toBe(30);
    });

    it('is a rate whose frame duration divides cleanly', () => {
        for (const speed of [1, 2, 4, 8, 16]) {
            expect(clipFps(speed) % 5).toBe(0);
        }
    });
});
