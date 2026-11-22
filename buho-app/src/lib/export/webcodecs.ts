/**
 * Recording a chart as MP4, frame by frame, with WebCodecs.
 *
 * This is the preferred path and `video.ts` is the fallback, for two reasons
 * that both matter more than they sound.
 *
 * **It produces a file that opens.** `MediaRecorder` will not encode H.264 on
 * Firefox — Mozilla does not ship the patented encoder — so that path yields
 * WebM there, which QuickTime will not play and which X, Instagram, WhatsApp
 * and iMessage all reject. `VideoEncoder` goes through the *platform's* encoder
 * (VideoToolbox on macOS, Media Foundation on Windows), which is the same
 * H.264 the machine already uses everywhere else.
 *
 * **It knows what time it is.** `MediaRecorder` stamps frames with the wall
 * clock, so `video.ts` has to let the clock drive the playhead and drop frames
 * when rendering falls behind. Here every frame carries a timestamp this code
 * assigns, so the render can take as long as it likes: the clip is exactly the
 * requested length, at exactly the requested rate, on a fast machine and a slow
 * one alike.
 *
 * Availability is asked, never assumed — `isConfigSupported` is the only honest
 * answer, since it depends on the OS and the GPU as much as on the browser.
 */

import type { Composer } from './compose';
import { avcBitrate, avcCodec } from './h264';
import { clipFps } from './pacing';
import { type CaptureOptions, type ShareAnimation, throwIfAborted } from './types';

/** How many frames the encoder may be behind before the loop waits for it. */
const QUEUE_LIMIT = 6;

function configFor(width: number, height: number, fps: number): VideoEncoderConfig {
    return {
        // The level in the codec string is a promise about frame size *and* rate,
        // so both are computed from what this clip will actually be — a 60 fps
        // export needs a higher level than the same plate at 30.
        codec: avcCodec(width, height, fps),
        width,
        height,
        bitrate: avcBitrate(width, height, fps),
        framerate: fps,
        // Length-prefixed samples with the parameter sets in the container, which
        // is what an MP4 wants; Annex B is for streaming.
        avc: { format: 'avc' },
    };
}

/** Whether the API exists at all. Cheap, and enough to offer the button. */
export function hasVideoEncoder(): boolean {
    return typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined';
}

/**
 * Whether this browser, on this machine, can encode a plate of this size.
 *
 * Asked per size because the answer genuinely varies with it: a hardware
 * encoder has a ceiling, and a chart plate can be far taller than any video
 * the machine was built to handle.
 */
export async function canEncodeMp4(
    width: number,
    height: number,
    fps = clipFps()
): Promise<boolean> {
    if (!hasVideoEncoder()) return false;
    try {
        const support = await VideoEncoder.isConfigSupported(configFor(width, height, fps));
        return support.supported === true;
    } catch {
        return false;
    }
}

export async function recordMp4(
    composer: Composer,
    animation: ShareAnimation,
    options: CaptureOptions = {}
): Promise<Blob> {
    const { onProgress, signal } = options;
    const { width, height } = composer;

    const fps = clipFps(animation.speed);
    const frames = Math.max(2, Math.round((animation.durationMs / 1000) * fps));
    const frameDurationUs = Math.round(1_000_000 / fps);

    // The muxer is fetched on the first clip rather than with every page that
    // offers the share button; the service worker keeps it for offline use.
    const { BufferTarget, EncodedPacket, EncodedVideoPacketSource, Mp4OutputFormat, Output } =
        await import('mediabunny');

    // The file is assembled in an ArrayBuffer, in this tab: nothing is written
    // anywhere until the visitor saves or shares the finished clip.
    const target = new BufferTarget();
    const output = new Output({
        // The index goes at the front of the file. Without it a player has to
        // fetch the whole thing before it can show a single frame, which is the
        // difference between a link that previews and one that spins.
        format: new Mp4OutputFormat({ fastStart: 'in-memory' }),
        target,
    });
    // The muxer only stores packets; the encoder stays ours, so it runs with the
    // exact config `canEncodeMp4` asked the platform about.
    const track = new EncodedVideoPacketSource('avc');
    output.addVideoTrack(track, { frameRate: fps });
    await output.start();

    let failure: Error | null = null;
    const fail = (error: unknown) => {
        failure ??= error instanceof Error ? error : new Error(String(error));
    };
    // The encoder hands chunks over synchronously and the muxer takes them
    // asynchronously, so each waits for the one before it to keep decode order.
    let muxing = Promise.resolve();
    const encoder = new VideoEncoder({
        output: (chunk, meta) => {
            const packet = EncodedPacket.fromEncodedChunk(chunk);
            muxing = muxing.then(() => (failure ? undefined : track.add(packet, meta))).catch(fail);
        },
        error: fail,
    });

    try {
        encoder.configure(configFor(width, height, fps));

        animation.begin?.();
        try {
            for (let i = 0; i < frames; i++) {
                throwIfAborted(signal);
                if (failure) throw failure;

                await animation.seek(i / (frames - 1));
                await composer.paint();

                const frame = new VideoFrame(composer.canvas, {
                    timestamp: i * frameDurationUs,
                    duration: frameDurationUs,
                });
                // A keyframe every two seconds: enough for a player to seek and for a
                // social network's re-encoder to cut cleanly, without paying for one
                // on every frame.
                encoder.encode(frame, { keyFrame: i % (fps * 2) === 0 });
                frame.close();

                // Rendering is faster than encoding on a big plate, and an unbounded
                // queue is how a twenty-second clip turns into a gigabyte of pending
                // frames.
                while (encoder.encodeQueueSize > QUEUE_LIMIT && !failure) {
                    await nextTask();
                }

                onProgress?.(((i + 1) / frames) * 0.9);
            }
        } finally {
            animation.end?.();
        }

        await encoder.flush();
        encoder.close();
        await muxing;
        if (failure) throw failure;
        await output.finalize();
    } catch (error) {
        // An abort or a failure mid-clip: release the encoder and drop the
        // half-built file rather than leaving either to the garbage collector.
        if (encoder.state !== 'closed') encoder.close();
        await output.cancel();
        throw error;
    }

    if (!target.buffer) throw new Error('The clip could not be encoded.');
    onProgress?.(1);
    return new Blob([target.buffer], { type: 'video/mp4' });
}

function nextTask(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
}
