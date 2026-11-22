/**
 * Types for `gifenc`, which ships as plain JavaScript.
 *
 * Only the three entry points this repo uses are declared, and only with the
 * options actually passed — a fuller transcription of the library's surface
 * would be a second thing to keep in sync with it for no benefit.
 */
declare module 'gifenc' {
    export type GifPalette = number[][];
    export type GifPixelFormat = 'rgb565' | 'rgb444' | 'rgba4444';

    export function quantize(
        rgba: Uint8Array | Uint8ClampedArray,
        maxColors: number,
        options?: { format?: GifPixelFormat; oneBitAlpha?: boolean; clearAlpha?: boolean }
    ): GifPalette;

    export function applyPalette(
        rgba: Uint8Array | Uint8ClampedArray,
        palette: GifPalette,
        format?: GifPixelFormat
    ): Uint8Array<ArrayBuffer>;

    export interface GifWriteFrameOptions {
        palette?: GifPalette;
        /** Milliseconds this frame stays up. */
        delay?: number;
        /** 0 = forever. */
        repeat?: number;
        /** GIF disposal method; 2 clears the frame before the next one. */
        dispose?: number;
        transparent?: boolean;
        transparentIndex?: number;
    }

    export interface GifEncoderInstance {
        writeFrame(
            index: Uint8Array,
            width: number,
            height: number,
            options?: GifWriteFrameOptions
        ): void;
        finish(): void;
        bytes(): Uint8Array<ArrayBuffer>;
        bytesView(): Uint8Array<ArrayBuffer>;
        reset(): void;
    }

    export function GIFEncoder(options?: {
        auto?: boolean;
        initialCapacity?: number;
    }): GifEncoderInstance;
}
