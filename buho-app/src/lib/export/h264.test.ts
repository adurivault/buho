import { describe, expect, it } from 'vitest';
import { avcBitrate, avcCodec } from './h264';

describe('avcCodec', () => {
    it('always names constrained baseline, the profile everything decodes', () => {
        expect(avcCodec(640, 360, 30)).toMatch(/^avc1\.42E0/);
    });

    it('stays at level 3.1 for a 720p frame', () => {
        expect(avcCodec(1280, 720, 30)).toBe('avc1.42E01f');
    });

    it('climbs when a chart plate is taller than any video shape', () => {
        // 1280×1400 is an ordinary ridgeline export and blows past 3.1's frame
        // ceiling; claiming 3.1 anyway is what makes a player refuse the file.
        const level = avcCodec(1280, 1400, 30);
        expect(level).not.toBe('avc1.42E01f');
        expect(parseInt(level.slice(-2), 16)).toBeGreaterThan(0x1f);
    });

    it('counts a partial macroblock as a whole one', () => {
        // 1282 wide is 81 macroblocks, not 80.15.
        expect(avcCodec(1282, 720, 30)).toBe(avcCodec(1296, 720, 30));
    });

    it('never runs out of levels', () => {
        expect(avcCodec(7680, 4320, 60)).toMatch(/^avc1\.42E0[0-9a-f]{2}$/);
    });
});

describe('avcBitrate', () => {
    it('holds a floor, so a small chart keeps its thin strokes', () => {
        expect(avcBitrate(320, 200, 30)).toBe(3_000_000);
    });

    it('holds a ceiling, so a huge plate stays sendable', () => {
        expect(avcBitrate(3840, 2160, 30)).toBe(16_000_000);
    });

    it('scales with the pixels in between', () => {
        expect(avcBitrate(1280, 720, 30)).toBeGreaterThan(3_000_000);
        expect(avcBitrate(1280, 720, 30)).toBeLessThan(16_000_000);
    });
});
