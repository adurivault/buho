import { render } from '@testing-library/svelte';
import { describe, it, expect, vi } from 'vitest';
import ChartFrame from './ChartFrame.svelte';

describe('ChartFrame', () => {
    it('mounts the element returned by the chart function', () => {
        const mockElement = document.createElement('div');
        mockElement.setAttribute('data-testid', 'mock-chart');
        const mockChartFn = vi.fn().mockReturnValue(mockElement);

        const { getByTestId } = render(ChartFrame, { chartFn: mockChartFn, data: [] });

        expect(mockChartFn).toHaveBeenCalled();
        expect(getByTestId('mock-chart')).toBeInTheDocument();
    });

    it('passes data to the chart function', () => {
        const mockElement = document.createElement('div');
        const mockChartFn = vi.fn().mockReturnValue(mockElement);
        const options = { width: 500, height: 300 };

        render(ChartFrame, { chartFn: mockChartFn, data: options });

        expect(mockChartFn).toHaveBeenCalledWith(options);
    });

    it('replaces the previous chart when data changes', async () => {
        const mockElement1 = document.createElement('div');
        mockElement1.setAttribute('data-id', 'chart-1');
        const mockElement2 = document.createElement('div');
        mockElement2.setAttribute('data-id', 'chart-2');

        const mockChartFn = vi
            .fn()
            .mockReturnValueOnce(mockElement1)
            .mockReturnValueOnce(mockElement2);

        const { rerender, container } = render(ChartFrame, {
            chartFn: mockChartFn,
            data: { val: 1 },
        });

        expect(container.querySelector('[data-id="chart-1"]')).toBeInTheDocument();

        await rerender({ chartFn: mockChartFn, data: { val: 2 } });

        expect(mockChartFn).toHaveBeenCalledTimes(2);
        // data-id="chart-1" should be removed because we clear innerHTML
        expect(container.querySelector('[data-id="chart-1"]')).not.toBeInTheDocument();
        expect(container.querySelector('[data-id="chart-2"]')).toBeInTheDocument();
    });
});
