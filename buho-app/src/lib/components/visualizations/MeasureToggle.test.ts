import { render, screen, fireEvent } from '@testing-library/svelte';
import '@testing-library/jest-dom/vitest';
import { describe, expect, test, vi } from 'vitest';
import MeasureToggle from './MeasureToggle.svelte';

const OPTIONS = [
    { key: 'messages', label: 'Messages', hint: 'One unit per message' },
    { key: 'words', label: 'Words', hint: 'Weighted by words written' },
    { key: 'chars', label: 'Characters', hint: 'Weighted by characters typed' },
];

describe('MeasureToggle', () => {
    test('marks the active measure and labels the group', () => {
        render(MeasureToggle, {
            props: { options: OPTIONS, value: 'messages', onChange: vi.fn() },
        });

        expect(screen.getByRole('group', { name: 'Measure' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Messages' })).toHaveAttribute(
            'aria-pressed',
            'true',
        );
        expect(screen.getByRole('button', { name: 'Words' })).toHaveAttribute(
            'aria-pressed',
            'false',
        );
    });

    test('spells out what the active measure counts', () => {
        render(MeasureToggle, {
            props: { options: OPTIONS, value: 'words', onChange: vi.fn() },
        });

        // Without this, switching measure looks like nothing happened.
        expect(screen.getByText('Weighted by words written')).toBeInTheDocument();
        expect(screen.queryByText('One unit per message')).not.toBeInTheDocument();
    });

    test('reports the key that was picked', async () => {
        const onChange = vi.fn();
        render(MeasureToggle, {
            props: { options: OPTIONS, value: 'messages', onChange },
        });

        await fireEvent.click(screen.getByRole('button', { name: 'Characters' }));
        expect(onChange).toHaveBeenCalledWith('chars');
    });
});
