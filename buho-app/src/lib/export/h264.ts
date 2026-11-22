/**
 * Picking an H.264 codec string a decoder will actually accept.
 *
 * `avc1.PPCCLL` names a profile, a set of constraint flags and a level. Getting
 * the level wrong is not cosmetic: it is the contract the file makes about how
 * much work decoding it takes, and a player that honours it will refuse a file
 * whose frames are larger than the level allows. Which is exactly what a chart
 * export is prone to — plates here are tall and odd-shaped, not 16:9.
 *
 * Constrained Baseline (`42E0…`) rather than High: it is the profile every
 * phone, chat app and social network has decoded for fifteen years, and none of
 * what High buys — CABAC, 8×8 transforms — is worth a file that will not open.
 */

/** Level, as the byte in the codec string, against the frame it can carry. */
const LEVELS: Array<{ byte: number; maxMacroblocks: number; maxMbPerSecond: number }> = [
    { byte: 0x1e, maxMacroblocks: 1620, maxMbPerSecond: 40_500 }, // 3.0
    { byte: 0x1f, maxMacroblocks: 3600, maxMbPerSecond: 108_000 }, // 3.1
    { byte: 0x20, maxMacroblocks: 5120, maxMbPerSecond: 216_000 }, // 3.2
    { byte: 0x28, maxMacroblocks: 8192, maxMbPerSecond: 245_760 }, // 4.0
    { byte: 0x2a, maxMacroblocks: 8704, maxMbPerSecond: 522_240 }, // 4.2
    { byte: 0x32, maxMacroblocks: 22_080, maxMbPerSecond: 589_824 }, // 5.0
    { byte: 0x33, maxMacroblocks: 36_864, maxMbPerSecond: 983_040 }, // 5.1
    { byte: 0x34, maxMacroblocks: 36_864, maxMbPerSecond: 2_073_600 }, // 5.2
];

/** The codec string for a frame of this size at this rate. */
export function avcCodec(width: number, height: number, fps: number): string {
    // A macroblock is 16×16, and a partial one still costs a whole block.
    const macroblocks = Math.ceil(width / 16) * Math.ceil(height / 16);
    const perSecond = macroblocks * fps;

    const level =
        LEVELS.find(
            (candidate) =>
                macroblocks <= candidate.maxMacroblocks && perSecond <= candidate.maxMbPerSecond
        ) ?? LEVELS[LEVELS.length - 1];

    return `avc1.42E0${level.byte.toString(16).padStart(2, '0')}`;
}

/**
 * Bits per second for chart footage.
 *
 * Charts are the easy case for a codec — large flat areas, no film grain, no
 * camera motion — but the hard case for *quality*, because what has to survive
 * is hairline strokes and 11px type, and those are the first thing a low
 * bitrate eats. So 0.15 bits per pixel per frame rather than the ~0.08 that
 * would be ample for camera footage: roughly 4 Mbit/s at 720p30, where a video
 * of the physical world would look fine on half that.
 */
export function avcBitrate(width: number, height: number, fps: number): number {
    return Math.min(16_000_000, Math.max(3_000_000, Math.round(width * height * fps * 0.15)));
}
