import { describe, expect, it, vi, afterEach } from 'vitest';
import { exportFilename, formatBytes, slugify } from './share';

describe('slugify', () => {
    it('lowercases and hyphenates', () => {
        expect(slugify('Top Artists')).toBe('top-artists');
    });

    it('strips accents rather than dropping the letters', () => {
        expect(slugify('Écoutes du mois')).toBe('ecoutes-du-mois');
    });

    it('never starts or ends on a separator', () => {
        expect(slugify('— totals —')).toBe('totals');
    });

    it('falls back to a name when nothing survives', () => {
        expect(slugify('***')).toBe('chart');
    });
});

describe('exportFilename', () => {
    afterEach(() => vi.useRealTimers());

    it('stamps the day and the extension', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(2026, 7, 25, 12));
        expect(exportFilename('Top Artists', 'mp4')).toBe('buho-top-artists-2026-08-25.mp4');
    });
});

describe('formatBytes', () => {
    it('reads out small sizes in bytes', () => {
        expect(formatBytes(512)).toBe('512 B');
    });

    it('switches unit as it grows', () => {
        expect(formatBytes(2048)).toBe('2.0 kB');
        expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
    });

    it('drops the decimal once the number is wide enough to read', () => {
        expect(formatBytes(14 * 1024 * 1024)).toBe('14 MB');
    });
});
