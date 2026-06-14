import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/svelte';
import ConstellationChart from './ConstellationChart.svelte';

describe('ConstellationChart', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
            // Mock RAF minimally to prevent infinite loops in tests but allow one render
            return setTimeout(() => cb(Date.now()), 0) as unknown as number;
        });
        vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
            clearTimeout(id as number);
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    const mockData = [
        { x: 1672531200000, y: 12.5, matched: true, metadata: { track: 'A', artist: 'B', playedAt: '2023-01-01', trackUri: null } }
    ];

    it('mounts without crashing and draws to canvas proxy', () => {
        const { container } = render(ConstellationChart, {
            data: mockData,
            width: 800,
            height: 600,
            timeDomain: [1672530000000, 1672540000000] as [number, number],
        });

        const canvases = container.querySelectorAll('canvas');
        expect(canvases.length).toBe(3); // y-area, main-area, x-area

        const mainCanvas = container.querySelector('.main-area canvas');
        expect(mainCanvas).toBeTruthy();
        expect(mainCanvas?.getAttribute('width')).toBe('700'); // 800 - 92(sideWidth) - 8(gap)
        expect(mainCanvas?.getAttribute('height')).toBe('490'); // 600 - 102(bottomHeight) - 8(gap)

        const resetBtn = container.querySelector('.reset-btn');
        expect(resetBtn).toBeTruthy();
        expect(resetBtn?.textContent).toBe('Reset view');
    });
});
