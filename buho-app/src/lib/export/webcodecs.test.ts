/**
 * The MP4 path, with the platform encoder played by a stand-in.
 *
 * jsdom has no WebCodecs, so `VideoEncoder` is replaced by one that turns each
 * frame into a one-byte chunk and announces a real H.264 decoder config. What
 * runs for real is everything around it — the frame loop, its timestamps and
 * keyframes, and the muxer — and the file that comes out is read back with
 * Mediabunny's own demuxer, as a player would.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ALL_FORMATS, BufferSource, EncodedPacketSink, Input } from 'mediabunny';
import type { Composer } from './compose';
import { avcCodec } from './h264';
import { clipFps } from './pacing';
import { CaptureAborted, type ShareAnimation } from './types';
import { recordMp4 } from './webcodecs';

const SIZE = 64;

/** An AVCDecoderConfigurationRecord holding the SPS and PPS of a real 64×64 baseline stream. */
const AVCC = new Uint8Array([
    // version, profile, compatibility, level, 4-byte lengths, one SPS
    0x01, 0x42, 0xc0, 0x0a, 0xff, 0xe1, 0x00, 0x17,
    // SPS
    0x67, 0x42, 0xc0, 0x0a, 0xd9, 0x04, 0x26, 0xc0, 0x44, 0x00, 0x00, 0x03, 0x00, 0x04, 0x00, 0x00,
    0x03, 0x00, 0x50, 0x3c, 0x48, 0x99, 0x20,
    // one PPS
    0x01, 0x00, 0x05, 0x68, 0xcb, 0x83, 0xcb, 0x20,
]);

class FakeChunk {
    readonly type: EncodedVideoChunkType;
    readonly timestamp: number;
    readonly duration: number | null;
    readonly byteLength: number;
    readonly #data: Uint8Array;

    constructor(init: EncodedVideoChunkInit) {
        this.type = init.type;
        this.timestamp = init.timestamp;
        this.duration = init.duration ?? null;
        this.#data = new Uint8Array(init.data as ArrayBuffer);
        this.byteLength = this.#data.byteLength;
    }

    copyTo(destination: Uint8Array) {
        destination.set(this.#data);
    }
}

class FakeFrame {
    readonly timestamp: number;
    readonly duration: number;
    constructor(_source: unknown, init: { timestamp: number; duration: number }) {
        this.timestamp = init.timestamp;
        this.duration = init.duration;
    }
    close() {}
}

class FakeEncoder {
    static last: FakeEncoder;
    /** Frame index at which the encoder reports a failure, if any. */
    static failAt: number | null = null;

    state: CodecState = 'unconfigured';
    encodeQueueSize = 0;
    config: VideoEncoderConfig | null = null;
    readonly keyFrames: boolean[] = [];
    readonly #init: VideoEncoderInit;

    constructor(init: VideoEncoderInit) {
        this.#init = init;
        FakeEncoder.last = this;
    }

    configure(config: VideoEncoderConfig) {
        this.config = config;
        this.state = 'configured';
    }

    encode(frame: FakeFrame, options?: VideoEncoderEncodeOptions) {
        const index = this.keyFrames.length;
        if (index === FakeEncoder.failAt) {
            this.state = 'closed';
            this.#init.error(new DOMException('The encoder gave up.', 'EncodingError'));
            return;
        }
        const key = options?.keyFrame === true;
        this.keyFrames.push(key);
        // A four-byte length, then a one-byte IDR or non-IDR slice header.
        const chunk = new FakeChunk({
            type: key ? 'key' : 'delta',
            timestamp: frame.timestamp,
            duration: frame.duration,
            data: new Uint8Array([0, 0, 0, 1, key ? 0x65 : 0x41]).buffer,
        });
        const meta =
            index === 0
                ? {
                      decoderConfig: {
                          codec: 'avc1.42c00a',
                          codedWidth: SIZE,
                          codedHeight: SIZE,
                          description: AVCC,
                      },
                  }
                : undefined;
        this.#init.output(chunk as unknown as EncodedVideoChunk, meta);
    }

    async flush() {}

    close() {
        this.state = 'closed';
    }
}

function composer(): Composer {
    const canvas = document.createElement('canvas');
    canvas.width = SIZE;
    canvas.height = SIZE;
    return { canvas, width: SIZE, height: SIZE, paint: async () => {} };
}

/** jsdom's Blob has no `arrayBuffer()`, so this goes through a FileReader. */
function bytesOf(blob: Blob): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
        reader.onerror = () => reject(reader.error);
        reader.readAsArrayBuffer(blob);
    });
}

/** The four-letter types of the file's top-level boxes, in order. */
function topLevelBoxes(bytes: Uint8Array): string[] {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const types: string[] = [];
    for (let offset = 0; offset + 8 <= bytes.byteLength;) {
        let size = view.getUint32(offset);
        if (size === 1) size = Number(view.getBigUint64(offset + 8));
        types.push(String.fromCharCode(...bytes.subarray(offset + 4, offset + 8)));
        if (size === 0) break;
        offset += size;
    }
    return types;
}

beforeEach(() => {
    FakeEncoder.failAt = null;
    vi.stubGlobal('VideoEncoder', FakeEncoder);
    vi.stubGlobal('VideoFrame', FakeFrame);
    vi.stubGlobal('EncodedVideoChunk', FakeChunk);
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('recordMp4', () => {
    it('writes every frame at its own timestamp into a fast-start MP4', async () => {
        const animation: ShareAnimation = { durationMs: 3000, seek: vi.fn() };
        const fps = clipFps();
        const frames = 3 * fps;
        const progress: number[] = [];

        const blob = await recordMp4(composer(), animation, {
            onProgress: (fraction) => progress.push(fraction),
        });

        expect(blob.type).toBe('video/mp4');
        expect(FakeEncoder.last.config?.codec).toBe(avcCodec(SIZE, SIZE, fps));
        expect(FakeEncoder.last.config?.framerate).toBe(fps);
        expect(FakeEncoder.last.state).toBe('closed');
        expect(animation.seek).toHaveBeenCalledTimes(frames);
        expect(progress.at(-1)).toBe(1);

        const bytes = await bytesOf(blob);
        const boxes = topLevelBoxes(bytes);
        expect(boxes[0]).toBe('ftyp');
        expect(boxes.indexOf('moov')).toBeLessThan(boxes.indexOf('mdat'));

        const input = new Input({ formats: ALL_FORMATS, source: new BufferSource(bytes) });
        expect((await input.getFormat()).name).toBe('MP4');
        const track = await input.getPrimaryVideoTrack();
        expect(track?.codec).toBe('avc');
        expect(track?.codedWidth).toBe(SIZE);
        expect(track?.codedHeight).toBe(SIZE);

        const packets = [];
        for await (const packet of new EncodedPacketSink(track!).packets()) packets.push(packet);
        expect(packets).toHaveLength(frames);
        packets.forEach((packet, i) => {
            expect(packet.timestamp).toBeCloseTo(i / fps, 6);
            // A keyframe every two seconds, and only there.
            expect(packet.type).toBe(i % (fps * 2) === 0 ? 'key' : 'delta');
        });
        expect(await input.computeDuration()).toBeCloseTo(3, 6);
    });

    it('stops on abort, releases the encoder and restores the chart', async () => {
        const controller = new AbortController();
        const animation: ShareAnimation = {
            durationMs: 3000,
            seek: vi.fn((t: number) => {
                if (t > 0.1) controller.abort();
            }),
            begin: vi.fn(),
            end: vi.fn(),
        };

        await expect(
            recordMp4(composer(), animation, { signal: controller.signal })
        ).rejects.toBeInstanceOf(CaptureAborted);
        expect(FakeEncoder.last.state).toBe('closed');
        expect(animation.end).toHaveBeenCalledOnce();
    });

    it('surfaces an encoder failure instead of returning a broken file', async () => {
        FakeEncoder.failAt = 5;
        const animation: ShareAnimation = { durationMs: 3000, seek: vi.fn() };

        await expect(recordMp4(composer(), animation)).rejects.toThrow('The encoder gave up.');
        expect(animation.seek).toHaveBeenCalledTimes(6);
    });
});
