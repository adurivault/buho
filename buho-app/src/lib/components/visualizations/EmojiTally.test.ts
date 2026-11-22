import { render, screen, fireEvent } from '@testing-library/svelte';
import '@testing-library/jest-dom/vitest';
import { describe, expect, test, vi } from 'vitest';
import EmojiTally from './EmojiTally.svelte';

describe('EmojiTally', () => {
    test('lists each emoji with its count', () => {
        const { container } = render(EmojiTally, {
            props: {
                emojis: [
                    { emoji: '\u{1F602}', count: 128 },
                    { emoji: '\u{2764}', count: 12 },
                ],
            },
        });

        const chips = [...container.querySelectorAll('.chip')];
        expect(chips).toHaveLength(2);
        expect(chips[0].textContent).toContain('\u{1F602}');
        expect(chips[0].textContent).toContain('128');
    });

    // The strip is permanent, so an empty selection has to say so rather than
    // vanish and take a row of the layout with it.
    test('says so instead of disappearing when nothing was typed', () => {
        const { container } = render(EmojiTally, { props: { emojis: [] } });

        expect(container.querySelector('.tally')).not.toBeNull();
        expect(container.querySelectorAll('.chip')).toHaveLength(0);
        expect(container.textContent).toContain('none typed here');
    });

    test('stays a row of figures when nothing listens for a click', () => {
        render(EmojiTally, { props: { emojis: [{ emoji: '\u{1F602}', count: 3 }] } });

        expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });

    test('searches for an emoji when clicked, and shows the ones already searched', async () => {
        const onSelect = vi.fn();
        render(EmojiTally, {
            props: {
                emojis: [
                    { emoji: '\u{1F602}', count: 128 },
                    { emoji: '\u{2764}', count: 12 },
                ],
                onSelect,
                termColor: (emoji: string) => (emoji === '\u{2764}' ? '#c98bdb' : null),
            },
        });

        const [laughing, heart] = screen.getAllByRole('button');
        expect(laughing).toHaveAttribute('aria-pressed', 'false');
        expect(heart).toHaveAttribute('aria-pressed', 'true');
        expect(heart.style.getPropertyValue('--term-color')).toBe('#c98bdb');

        await fireEvent.click(laughing);
        expect(onSelect).toHaveBeenCalledWith('\u{1F602}');
    });
});
