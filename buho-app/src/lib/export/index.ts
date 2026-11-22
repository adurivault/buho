/**
 * Charts, out of the browser and into a file.
 *
 * Everything here runs on the main thread of the tab that already holds the
 * data: a still is a canvas, a clip is encoded by the machine's own video
 * encoder, a GIF is quantised in JavaScript. Nothing is uploaded, nothing is
 * rendered server-side, and there is no service to fall back to — which is the
 * only implementation compatible with the promise on the front page.
 *
 * Video has two implementations and the order matters. WebCodecs
 * (`webcodecs.ts`) comes first: it reaches the platform's H.264 encoder, so it
 * produces an MP4 everywhere the machine can make one — Firefox included, where
 * `MediaRecorder` refuses H.264 outright — and it timestamps frames itself, so
 * the clip's length does not depend on how fast the chart renders.
 * `MediaRecorder` (`video.ts`) stays behind it for browsers without WebCodecs.
 */

import { createComposer, type ComposeOptions, type Composer } from './compose';
import { GIF_MAX_SECONDS, gifFps, gifScale, recordGif } from './gif';
import { clipFps } from './pacing';
import { canRecordVideo, pickVideoFormat, recordVideo } from './video';
import { canEncodeMp4, hasVideoEncoder, recordMp4 } from './webcodecs';
import { exportFilename } from './share';
import {
    type CaptureOptions,
    type CaptureResult,
    type ShareFormat,
    type ShareSource,
} from './types';

export { CaptureAborted } from './types';
export type { CaptureResult, ShareFormat, ShareSource, ShareAnimation } from './types';
export {
    canShareFile,
    downloadBlob,
    exportFilename,
    formatBytes,
    shareBlob,
    slugify,
} from './share';
export { GIF_MAX_SECONDS } from './gif';
export { MAX_CLIP_MS, MIN_CLIP_MS, clipDurationMs, clipFps } from './pacing';
export {
    APP_PITCH,
    APP_URL,
    SHARE_CHANNELS,
    canCopyImage,
    canCopyText,
    copyImageToClipboard,
    copyText,
    type ShareChannel,
} from './promote';

/** Widest still we will hand out; past this the file is large and no sharper. */
const STILL_MAX_WIDTH = 2400;
/** Widest clip. 1280 is what every chat app re-encodes to anyway. */
const VIDEO_MAX_WIDTH = 1280;
/** Margin around the chart on the exported plate, in CSS pixels. */
const PLATE_PADDING = 24;

export function formatIsAvailable(format: ShareFormat, source: ShareSource): boolean {
    if (format === 'png') return true;
    if (!source.animation) return false;
    if (format === 'gif') return true;
    return hasVideoEncoder() || canRecordVideo();
}

/** What a format's clip will actually last, once the caps are applied. */
export function clipSeconds(format: ShareFormat, source: ShareSource): number {
    const ms = source.animation?.durationMs ?? 0;
    const seconds = ms / 1000;
    return format === 'gif' ? Math.min(GIF_MAX_SECONDS, seconds) : seconds;
}

/** The rate a format will run at, which the two of them arrive at differently. */
export function clipRate(format: ShareFormat, source: ShareSource): number {
    const speed = source.animation?.speed;
    return format === 'gif' ? gifFps(speed) : clipFps(speed);
}

/**
 * Which container a clip of this chart would come out in.
 *
 * Answered by building the plate and asking the encoder about that exact size,
 * because the answer genuinely depends on it — hardware encoders have a frame
 * ceiling, and a chart plate can be far taller than any video the machine was
 * designed around. Used only to label the menu honestly; `capture` makes the
 * same decision again for itself.
 */
export async function planVideoFormat(source: ShareSource): Promise<'mp4' | 'webm' | null> {
    const element = source.element();
    if (!element) return null;

    const composer = videoComposer(element, source);
    const fps = clipFps(source.animation?.speed);
    if (await canEncodeMp4(composer.width, composer.height, fps)) return 'mp4';
    return pickVideoFormat()?.ext ?? null;
}

export async function capture(
    source: ShareSource,
    format: ShareFormat,
    options: CaptureOptions = {}
): Promise<CaptureResult> {
    const element = source.element();
    if (!element) throw new Error('The chart is not on screen yet.');

    if (format === 'png') {
        const composer = createComposer(element, {
            ...plateFor(source),
            scale: Math.min(2, STILL_MAX_WIDTH / plateWidth(element)),
        });
        await composer.paint();
        options.onProgress?.(1);
        return {
            blob: await canvasToPng(composer.canvas),
            filename: exportFilename(source.name, 'png'),
        };
    }

    const animation = source.animation;
    if (!animation) throw new Error('This chart does not animate.');

    if (format === 'gif') {
        const composer = createComposer(element, {
            ...plateFor(source),
            scale: gifScale(plateWidth(element)),
        });
        const blob = await recordGif(
            composer,
            cappedTo(animation, GIF_MAX_SECONDS * 1000),
            options
        );
        return { blob, filename: exportFilename(source.name, 'gif') };
    }

    const composer = videoComposer(element, source);

    // The machine's own H.264 encoder, wherever it will take a frame this size
    // at this rate.
    if (await canEncodeMp4(composer.width, composer.height, clipFps(animation.speed))) {
        const blob = await recordMp4(composer, animation, options);
        return { blob, filename: exportFilename(source.name, 'mp4') };
    }

    if (!pickVideoFormat()) throw new Error('This browser cannot record video.');
    const { blob, ext } = await recordVideo(composer, animation, options);
    return { blob, filename: exportFilename(source.name, ext) };
}

/** The plate a clip is drawn on. Built the same way by the probe and the capture. */
function videoComposer(element: HTMLElement, source: ShareSource): Composer {
    return createComposer(element, {
        ...plateFor(source),
        scale: Math.min(2, VIDEO_MAX_WIDTH / plateWidth(element)),
    });
}

function plateFor(source: ShareSource): ComposeOptions {
    return {
        padding: PLATE_PADDING,
        title: source.title,
        caption: source.caption,
        prepare: source.prepare?.bind(source),
    };
}

/**
 * The width the *plate* will be, not the chart's.
 *
 * The caps are on the file that comes out, and the padding is part of it. The
 * scrolled extent is used rather than the visible one: several charts are wider
 * than a phone and live in their own horizontal scroller.
 */
function plateWidth(element: HTMLElement): number {
    const chart = Math.max(element.getBoundingClientRect().width, element.scrollWidth, 1);
    return chart + PLATE_PADDING * 2;
}

/**
 * The same animation, played to its end in at most `maxMs`.
 *
 * A GIF is capped by frame count, so a twenty-minute race has to be *shown*
 * faster rather than cut short — a clip that stops two thirds of the way
 * through a ranking is worse than one that hurries.
 */
function cappedTo(animation: ShareSource['animation'] & {}, maxMs: number) {
    return animation.durationMs <= maxMs ? animation : { ...animation, durationMs: maxMs };
}

function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
    return new Promise((resolve, reject) => {
        canvas.toBlob(
            (blob) => (blob ? resolve(blob) : reject(new Error('The image could not be encoded.'))),
            'image/png'
        );
    });
}
