/**
 * Recording a moving chart, with nothing but `MediaRecorder`.
 *
 * The subtle part is time. `MediaRecorder` stamps every frame with the wall
 * clock, so a naive "render frame 1, frame 2, frame 3…" loop produces a clip
 * whose duration is however long the *rendering* took — several times the
 * animation on a busy dataset. So the loop is inverted: the wall clock drives
 * the playhead, and each pass shows wherever the chart should be *now*. A slow
 * renderer then costs frames, which reads as a slightly choppier clip, instead
 * of costing accuracy, which reads as a chart that lies about how long a year
 * of listening took.
 *
 * `captureStream(0)` rather than `captureStream(fps)`: at a fixed rate the
 * browser samples the canvas on its own schedule and can catch it mid-repaint.
 * At 0, nothing is captured until `requestFrame()` says the plate is finished.
 */

import type { Composer } from './compose';
import { avcBitrate } from './h264';
import { BASE_FPS, clipFps } from './pacing';
import { type CaptureOptions, type ShareAnimation, throwIfAborted } from './types';

type VideoFormat = { mime: string; ext: 'mp4' | 'webm' };

/**
 * In preference order. MP4 leads because it is the one file every phone, chat
 * app and social network takes without a re-encode; WebM is the fallback that
 * has been in Chrome and Firefox for a decade.
 */
const CANDIDATES: VideoFormat[] = [
    { mime: 'video/mp4;codecs=avc1.4d002a', ext: 'mp4' },
    { mime: 'video/mp4', ext: 'mp4' },
    { mime: 'video/webm;codecs=vp9', ext: 'webm' },
    { mime: 'video/webm;codecs=vp8', ext: 'webm' },
    { mime: 'video/webm', ext: 'webm' },
];

/** The best container this browser can record, or `null` if it cannot. */
export function pickVideoFormat(): VideoFormat | null {
    if (typeof MediaRecorder === 'undefined') return null;
    return (
        CANDIDATES.find((candidate) => {
            try {
                return MediaRecorder.isTypeSupported(candidate.mime);
            } catch {
                return false;
            }
        }) ?? null
    );
}

export function canRecordVideo(): boolean {
    if (pickVideoFormat() === null) return false;
    if (typeof HTMLCanvasElement === 'undefined') return false;
    const proto = HTMLCanvasElement.prototype as unknown as CapturableCanvas;
    return (
        typeof proto.captureStream === 'function' || typeof proto.webkitCaptureStream === 'function'
    );
}

export async function recordVideo(
    composer: Composer,
    animation: ShareAnimation,
    options: CaptureOptions = {}
): Promise<{ blob: Blob; ext: string }> {
    const format = pickVideoFormat();
    if (!format) throw new Error('This browser cannot record video from a canvas.');

    const { onProgress, signal } = options;

    animation.begin?.();
    try {
        // The stream must start from a finished plate: an empty canvas at track
        // creation is what makes some browsers emit a black first frame.
        await animation.seek(0);
        await composer.paint();

        const fps = clipFps(animation.speed);
        const { stream, pushFrame } = openStream(composer.canvas, fps);

        const recorder = new MediaRecorder(stream, {
            mimeType: format.mime,
            // The same budget the MP4 path uses. VP9 does more with it than H.264
            // does, which on a chart only means a little headroom to spare.
            videoBitsPerSecond: avcBitrate(composer.width, composer.height, fps),
        });

        const chunks: Blob[] = [];
        recorder.ondataavailable = (event) => {
            if (event.data.size > 0) chunks.push(event.data);
        };
        const finished = new Promise<void>((resolve, reject) => {
            recorder.onstop = () => resolve();
            recorder.onerror = () => reject(new Error('The recorder stopped unexpectedly.'));
        });
        // A cancelled export never awaits this promise, so it is marked handled
        // up front; the `await` below still sees whatever it settles with.
        void finished.catch(() => {});

        const minGap = 1000 / fps;

        try {
            recorder.start();
            pushFrame();

            const startedAt = performance.now();
            let lastFrameAt = startedAt;
            let t = 0;

            while (t < 1) {
                await nextRepaint();
                throwIfAborted(signal);

                const now = performance.now();
                if (now - lastFrameAt < minGap) continue;
                lastFrameAt = now;

                t = Math.min(1, (now - startedAt) / animation.durationMs);
                await animation.seek(t);
                await composer.paint();
                pushFrame();
                onProgress?.(t);
            }

            // The last `requestFrame` needs a beat to reach the encoder, and a
            // frame with no successor has no duration — without this the final
            // state, which is the whole point of a race, is missing from the file.
            await hold(minGap * 3);
            pushFrame();
            await hold(minGap * 6);
        } finally {
            // A cancelled export must not leave a recorder and a capture track
            // running against a canvas nobody will look at again.
            if (recorder.state !== 'inactive') recorder.stop();
            stream.getTracks().forEach((each) => each.stop());
        }

        await finished;
        return { blob: new Blob(chunks, { type: format.mime }), ext: format.ext };
    } finally {
        animation.end?.();
    }
}

/** The canvas surface a capture stream can be opened on. */
type CapturableCanvas = {
    captureStream?: (frameRate?: number) => MediaStream;
    /** Older WebKit shipped the method under its prefix. */
    webkitCaptureStream?: (frameRate?: number) => MediaStream;
};

/**
 * A capture stream, plus the way to advance it on this browser.
 *
 * Two dialects, and the difference is not cosmetic. Chrome and Firefox expose
 * `requestFrame()`, which lets the plate be published only once it is finished
 * — no half-drawn frame can ever reach the encoder. WebKit does not implement
 * it at all, so there the browser is asked to sample at a fixed rate and does
 * so on its own schedule.
 *
 * Timing survives either way: the loop that calls this is paced by the wall
 * clock, so what a fixed-rate sampler catches is still the chart at the moment
 * it is meant to be at. The only thing given up on WebKit is the guarantee
 * against sampling mid-repaint.
 */
export function openStream(
    canvas: CapturableCanvas,
    fps = BASE_FPS
): {
    stream: MediaStream;
    pushFrame: () => void;
} {
    const capture = (rate?: number): MediaStream => {
        const fn = canvas.captureStream ?? canvas.webkitCaptureStream;
        if (!fn) throw new Error('This browser cannot record video from a canvas.');
        return fn.call(canvas, rate);
    };

    // Asked for at 0 first: a stream nothing publishes to is inert, which is
    // exactly what is wanted if it turns out frames can be driven by hand.
    const manual = capture(0);

    // The standard puts `requestFrame()` on the track; Firefox has always had it
    // on the stream instead, and still does. Both are checked, because reaching
    // for only one of them is how this ended up throwing on Firefox.
    const track = manual.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack | undefined;
    if (track && typeof track.requestFrame === 'function') {
        return { stream: manual, pushFrame: () => track.requestFrame() };
    }
    const legacy = manual as MediaStream & { requestFrame?: () => void };
    if (typeof legacy.requestFrame === 'function') {
        return { stream: manual, pushFrame: () => legacy.requestFrame!() };
    }

    // Nothing would ever be published to a 0 fps stream here, so it is dropped
    // and reopened at a rate the browser will sample on its own.
    manual.getTracks().forEach((each) => each.stop());
    return { stream: capture(fps), pushFrame: () => {} };
}

function nextRepaint(): Promise<void> {
    return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function hold(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
