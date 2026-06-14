import { render } from '@testing-library/svelte';
import { describe, it, expect, vi } from 'vitest';
import PlotChart from './PlotChart.svelte';

describe('PlotChart', () => {
    it('mounts the element returned by the plot function', () => {
        const mockElement = document.createElement('div');
        mockElement.setAttribute('data-testid', 'mock-plot');
        const mockPlotFn = vi.fn().mockReturnValue(mockElement);

        const { getByTestId } = render(PlotChart, { plotFn: mockPlotFn });

        expect(mockPlotFn).toHaveBeenCalled();
        expect(getByTestId('mock-plot')).toBeInTheDocument();
    });

    it('passes data to the plot function', () => {
        const mockElement = document.createElement('div');
        const mockPlotFn = vi.fn().mockReturnValue(mockElement);
        const options = { width: 500, height: 300 };

        render(PlotChart, { plotFn: mockPlotFn, data: options });

        expect(mockPlotFn).toHaveBeenCalledWith(options);
    });

    it('cleans up previous plot when data changes', async () => {
        const mockElement1 = document.createElement('div');
        mockElement1.setAttribute('data-id', 'plot-1');
        const mockElement2 = document.createElement('div');
        mockElement2.setAttribute('data-id', 'plot-2');

        const mockPlotFn = vi.fn()
            .mockReturnValueOnce(mockElement1)
            .mockReturnValueOnce(mockElement2);

        const { rerender, container } = render(PlotChart, { plotFn: mockPlotFn, data: { val: 1 } });

        expect(container.querySelector('[data-id="plot-1"]')).toBeInTheDocument();

        await rerender({ plotFn: mockPlotFn, data: { val: 2 } });

        expect(mockPlotFn).toHaveBeenCalledTimes(2);
        // data-id="plot-1" should be removed because we clear innerHTML
        expect(container.querySelector('[data-id="plot-1"]')).not.toBeInTheDocument();
        expect(container.querySelector('[data-id="plot-2"]')).toBeInTheDocument();
    });
});
