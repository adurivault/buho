/**
 * How long an exported clip runs, and how many frames it gets.
 *
 * Both answers come from the speed the reader picked, and they pull in opposite
 * directions: a faster setting makes the file *shorter*, and shortness is
 * exactly what makes a low frame rate visible. Thirty frames a second is ample
 * while a bar chart creeps; at 16× the same thirty frames have to carry sixteen
 * times the movement, and the race turns into a slideshow of eight positions.
 *
 * So the rate climbs as the duration falls. It costs nothing — a short clip at
 * a high rate still holds fewer frames than a long one at a low rate, so the
 * fastest setting is also the cheapest to encode.
 */

/**
 * Bounds on an exported clip.
 *
 * The floor keeps the fastest setting from producing a file too short to read;
 * the ceiling keeps the slowest from producing one nobody will sit through.
 */
export const MIN_CLIP_MS = 2_000;
export const MAX_CLIP_MS = 20_000;

/** The rate at 1×, and the ceiling every player and codec still takes happily. */
export const BASE_FPS = 30;
export const MAX_FPS = 60;

/**
 * How long a clip runs, at the pace the reader picked.
 *
 * A chart's speed control means "cross the timeline faster", and in a file the
 * only way to cross it faster is to be shorter — there is no playhead to move.
 * So the multiplier divides the duration rather than skipping frames, and the
 * whole timeline is always covered whichever setting is chosen. The menu shows
 * the number this returns, so the trade is visible before the click.
 */
export function clipDurationMs(baseMs: number, speed = 1): number {
    const scaled = baseMs / Math.max(speed, 0.01);
    return Math.min(MAX_CLIP_MS, Math.max(MIN_CLIP_MS, scaled));
}

/**
 * Frames per second for a clip played at `speed`.
 *
 * Ten more frames per doubling, not thirty times more: what the eye needs is
 * roughly the logarithm of the movement, and past 60 there is nothing to gain
 * that survives a social network's re-encode anyway.
 */
export function clipFps(speed = 1): number {
    const doublings = Math.max(0, Math.log2(Math.max(speed, 1)));
    const raw = BASE_FPS + doublings * 10;
    // Rounded to a multiple of five so a frame's duration stays a tidy number of
    // microseconds, which is the unit every timestamp in the MP4 is written in.
    return Math.min(MAX_FPS, Math.round(raw / 5) * 5);
}
