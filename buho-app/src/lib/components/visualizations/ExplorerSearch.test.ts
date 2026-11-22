import { render, screen, fireEvent } from '@testing-library/svelte';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import ExplorerSearch from './ExplorerSearch.svelte';

describe('ExplorerSearch', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    const field = () => screen.getByRole('searchbox');

    test('commits after a pause in the typing, not on every key', async () => {
        const onChange = vi.fn();
        render(ExplorerSearch, { props: { value: '', onChange, placeholder: 'Search' } });

        await fireEvent.input(field(), { target: { value: 'piz' } });
        await fireEvent.input(field(), { target: { value: 'pizza' } });
        expect(onChange).not.toHaveBeenCalled();

        vi.runAllTimers();
        expect(onChange).toHaveBeenCalledTimes(1);
        expect(onChange).toHaveBeenCalledWith('pizza');
    });

    test('commits at once on Enter', async () => {
        const onChange = vi.fn();
        render(ExplorerSearch, { props: { value: '', onChange, placeholder: 'Search' } });

        await fireEvent.input(field(), { target: { value: 'lol' } });
        await fireEvent.keyDown(field(), { key: 'Enter' });
        expect(onChange).toHaveBeenCalledWith('lol');
    });

    test('empties on Escape, and clears from its button', async () => {
        const onChange = vi.fn();
        render(ExplorerSearch, { props: { value: 'lol', onChange, placeholder: 'Search' } });

        await fireEvent.keyDown(field(), { key: 'Escape' });
        expect(onChange).toHaveBeenLastCalledWith('');
        expect(field()).toHaveValue('');

        await fireEvent.input(field(), { target: { value: 'mdr' } });
        vi.runAllTimers();
        await fireEvent.click(screen.getByRole('button', { name: 'Clear the search' }));
        expect(onChange).toHaveBeenLastCalledWith('');
    });

    test('follows the store when the query is changed elsewhere', async () => {
        const { rerender } = render(ExplorerSearch, {
            props: { value: 'haha, lol', onChange: vi.fn(), placeholder: 'Search' },
        });
        expect(field()).toHaveValue('haha, lol');

        // "Clear all filters", or a term removed from the legend.
        await rerender({ value: 'haha', onChange: vi.fn(), placeholder: 'Search' });
        expect(field()).toHaveValue('haha');
    });

    test('takes the focus on "/", but not while typing somewhere else', async () => {
        const onWarm = vi.fn();
        render(ExplorerSearch, {
            props: { value: '', onChange: vi.fn(), placeholder: 'Search', onWarm },
        });

        await fireEvent.keyDown(window, { key: '/' });
        expect(field()).toHaveFocus();
        expect(onWarm).toHaveBeenCalled();

        field().blur();
        const other = document.createElement('input');
        document.body.appendChild(other);
        other.focus();
        await fireEvent.keyDown(other, { key: '/' });
        expect(other).toHaveFocus();
        other.remove();
    });
});
