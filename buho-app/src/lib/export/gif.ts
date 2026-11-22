/**
 * Recording a moving chart as a GIF.
 *
 * Worse than the video on every technical axis — 256 colours, no inter-frame
 * motion compensation, files an order of magnitude larger — and kept anyway,
 * because a GIF is the one moving image that pastes into a Slack message, a
 * GitHub issue or a blog post and simply plays.
 *
 * Unlike the video recorder this one is *deterministic*: a GIF carries an
 * explicit delay per frame, so the clock never has to be guessed from the wall.
 * Every stop is rendered exactly, however long that takes, and the result plays
 * at the intended speed on a slow machine and a fast one alike.
 *
 * The palette is built once, from frames sampled across the whole animation,
 * rather than per frame. A per-frame palette is marginally sharper and makes
 * the background shimmer between frames, which on a dark chart is the only
 * thing anyone notices.
 */

import { GIFEncoder, quantize, applyPalette } from 'gifenc';
import type { Composer } from './compose';
import { type CaptureOptions, type ShareAnimation, throwIfAborted } from './types';

/** The presets. A GIF has to stay pasteable, so it is capped, not scaled. */
export const GIF_MAX_WIDTH = 560;
export const GIF_MAX_SECONDS = 8;

/**
 * A frame's delay, in hundredths of a second.
 *
 * The unit is the format's, not a choice: GIF89a stores the delay as a 16-bit
 * count of centiseconds, so only rates of the form 100/n exist. Asking for 30
 * fps would be written as 3cs and played back at 33⅓ — the drift shows up as a
 * clip that finishes early against the video of the same chart.
 *
 * Faster settings get a shorter delay, for the reason in `pacing.ts`, but not
 * below 4cs: a good many renderers still apply the old rule that a delay under
 * 2cs means "as fast as you like", and some round anything small up to 10cs.
 */
export function gifDelayCs(speed = 1): number {
    if (speed >= 8) return 4; // 25 fps
    if (speed >= 4) return 5; // 20 fps
    if (speed >= 2) return 6; // ~16.7 fps
    return 8; // 12.5 fps
}

export function gifFps(speed = 1): number {
    return 100 / gifDelayCs(speed);
}

/** How many frames a GIF of this animation will hold. */
export function gifFrameCount(durationMs: number, speed = 1): number {
    const seconds = Math.min(GIF_MAX_SECONDS, Math.max(1, durationMs / 1000));
    return Math.max(2, Math.round(seconds * gifFps(speed)));
}

/** Output pixels per CSS pixel that keep a chart of `cssWidth` under the cap. */
export function gifScale(cssWidth: number): number {
    return Math.min(1, GIF_MAX_WIDTH / Math.max(1, cssWidth));
}

export async function recordGif(
    composer: Composer,
    animation: ShareAnimation,
    options: CaptureOptions = {}
): Promise<Blob> {
    const { onProgress, signal } = options;
    const frames = gifFrameCount(animation.durationMs, animation.speed);
    const delay = gifDelayCs(animation.speed) * 10;

    const ctx = composer.canvas.getContext('2d');
    if (!ctx) throw new Error('This browser refused a 2D canvas for the export.');

    animation.begin?.();
    const captured: Uint8ClampedArray[] = [];

    try {
        for (let i = 0; i < frames; i++) {
            throwIfAborted(signal);
            await animation.seek(i / (frames - 1));
            await composer.paint();
            captured.push(ctx.getImageData(0, 0, composer.width, composer.height).data);
            // Rendering is the long pole; handing the main thread back keeps the
            // progress bar moving and the cancel button clickable.
            onProgress?.(((i + 1) / frames) * 0.75);
            await yieldToBrowser();
        }
    } finally {
        animation.end?.();
    }

    throwIfAborted(signal);

    const palette = quantize(sampleFrames(captured, composer.width * composer.height), 256, {
        format: 'rgb565',
    });

    const encoder = GIFEncoder();
    for (let i = 0; i < captured.length; i++) {
        throwIfAborted(signal);
        const indexed = applyPalette(captured[i], palette, 'rgb565');
        encoder.writeFrame(indexed, composer.width, composer.height, {
            palette,
            delay,
            // Every frame is a full plate, so nothing has to be carried over.
            dispose: 2,
            repeat: 0,
        });
        onProgress?.(0.75 + ((i + 1) / captured.length) * 0.25);
        if (i % 4 === 3) await yieldToBrowser();
    }
    encoder.finish();

    return new Blob([encoder.bytes()], { type: 'image/gif' });
}

/**
 * A handful of frames spread across the animation, concatenated, as the input
 * to one global palette.
 *
 * Sampled rather than exhaustive: quantising 96 frames' worth of pixels costs
 * seconds and buys nothing — the colours a chart uses are established in the
 * first pass and the last, not discovered somewhere in the middle.
 */
function sampleFrames(frames: Uint8ClampedArray[], pixels: number): Uint8Array {
    const picks = Math.min(frames.length, 5);
    const out = new Uint8Array(picks * pixels * 4);
    for (let i = 0; i < picks; i++) {
        const index = Math.round((i / Math.max(1, picks - 1)) * (frames.length - 1));
        out.set(frames[index], i * pixels * 4);
    }
    return out;
}

function yieldToBrowser(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
}
