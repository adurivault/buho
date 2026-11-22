import { render, screen, fireEvent } from '@testing-library/svelte';
import '@testing-library/jest-dom/vitest';
import { describe, expect, test, vi } from 'vitest';
import SearchLegend from './SearchLegend.svelte';

const ENTRIES = [
    { label: 'haha', count: 1204, color: '#c98bdb' },
    { label: 'lol', count: 3, color: '#4cc38a' },
];

const props = (over: Record<string, unknown> = {}) => ({
    entries: ENTRIES,
    countLabel: 'messages',
    colorByActive: true,
    onToggleColorBy: vi.fn(),
    onRemove: vi.fn(),
    vizId: 'messages-explorer',
    ...over,
});

describe('SearchLegend', () => {
    test('names each term with its count, in the browser locale', () => {
        render(SearchLegend, { props: props() });

        // Testing Library folds the locale's (narrow, no-break) spaces to plain ones.
        const count = (1204).toLocaleString().replace(/\s/g, ' ');
        expect(screen.getByText('haha')).toBeInTheDocument();
        expect(screen.getByText(count)).toBeInTheDocument();
        expect(screen.getByTitle(`${count} messages`)).toBeInTheDocument();
    });

    test('removes a term', async () => {
        const onRemove = vi.fn();
        render(SearchLegend, { props: props({ onRemove }) });

        await fireEvent.click(screen.getByRole('button', { name: 'Remove lol from the search' }));
        expect(onRemove).toHaveBeenCalledWith('lol');
    });

    test('switches the term coloring, and says whether it is on', async () => {
        const onToggleColorBy = vi.fn();
        render(SearchLegend, { props: props({ colorByActive: false, onToggleColorBy }) });

        const toggle = screen.getByRole('switch', { name: /Color by term/ });
        expect(toggle).toHaveAttribute('aria-checked', 'false');
        await fireEvent.click(toggle);
        expect(onToggleColorBy).toHaveBeenCalled();
    });

    test('keeps its controls out of an exported image', () => {
        const { container } = render(SearchLegend, { props: props() });

        const hidden = container.querySelectorAll('[data-export-hide]');
        expect(hidden).toHaveLength(ENTRIES.length + 1);
    });

    test('draws nothing without a search', () => {
        const { container } = render(SearchLegend, { props: props({ entries: [] }) });

        expect(container.querySelector('.legend')).toBeNull();
    });
});
