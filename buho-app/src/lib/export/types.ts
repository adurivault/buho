/** The contract a chart offers the share control. */

export type ShareAnimation = {
    /** How long one pass lasts in the exported clip, in milliseconds. */
    durationMs: number;
    /**
     * The speed multiplier the reader has selected, if the chart offers one.
     *
     * Carried separately from `durationMs` — which already accounts for it —
     * because the recorders need it for a second, opposite decision: a faster
     * setting packs more movement into each second, so it also needs more
     * frames in each second. See `pacing.ts`.
     */
    speed?: number;
    /**
     * Puts the chart at playhead `t` (0 → 1) and resolves once it has painted.
     *
     * Must be a *seek*, not a step: the recorders drive it out of order (a GIF
     * walks fixed stops, a video follows the wall clock and skips whatever it
     * has to), so a chart that only knows how to advance one frame cannot be
     * recorded faithfully.
     */
    seek(t: number): void | Promise<void>;
    /** Park live playback before a recording, and restore the view after it. */
    begin?(): void;
    end?(): void;
};

export type ShareSource = {
    /**
     * File-name stem, e.g. `top-artists`. Always a literal from the call site —
     * never data, which would leak an artist or a contact into a file name.
     */
    name: string;
    /** Drawn on the exported plate. */
    title?: string;
    caption?: string;
    /** The subtree to flatten. Read at capture time; the chart may not be up yet. */
    element(): HTMLElement | null | undefined;
    /**
     * Repaints the chart's own canvases, synchronously, just before they are
     * copied. Only needed by charts with a WebGL layer, whose drawing buffer is
     * gone by the time anything else asks for it.
     */
    prepare?(): void;
    /** Present only on charts that move. */
    animation?: ShareAnimation;
};

export type ShareFormat = 'png' | 'video' | 'gif';

export type CaptureResult = {
    blob: Blob;
    filename: string;
};

export type CaptureOptions = {
    /** 0 → 1, reported often enough to drive a progress bar. */
    onProgress?: (fraction: number) => void;
    signal?: AbortSignal;
};

export class CaptureAborted extends Error {
    constructor() {
        super('Export cancelled');
        this.name = 'CaptureAborted';
    }
}

export function throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) throw new CaptureAborted();
}
