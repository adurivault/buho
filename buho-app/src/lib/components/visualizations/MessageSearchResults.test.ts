import { render, screen, fireEvent } from '@testing-library/svelte';
import '@testing-library/jest-dom/vitest';
import { describe, expect, test, vi } from 'vitest';
import MessageSearchResults, { type MessageHit } from './MessageSearchResults.svelte';
import { parseSearch } from '#lib/explorer/search.ts';

const hit = (over: Partial<MessageHit> & { id: number }): MessageHit => ({
    sentAt: '2024-03-02 10:00:00',
    contact: 'Ana',
    sender: 'Ana',
    direction: 'Received',
    isGroup: false,
    text: 'pizza tonight?',
    ...over,
});

const HITS = [
    hit({ id: 1, direction: 'Sent', sender: 'Me', text: 'we said pizza' }),
    hit({ id: 2, contact: 'Crew', isGroup: true, sender: 'Bo', text: 'Pizza!' }),
    hit({ id: 3 }),
];

const props = (over: Record<string, unknown> = {}) => ({
    hits: HITS,
    total: 3,
    terms: parseSearch('pizza'),
    colors: ['#c98bdb'],
    onOpen: vi.fn(),
    onShowMore: vi.fn(),
    ...over,
});

describe('MessageSearchResults', () => {
    test('lists every hit with the match marked', () => {
        const { container } = render(MessageSearchResults, { props: props() });

        expect(screen.getByText('3 messages')).toBeInTheDocument();
        expect([...container.querySelectorAll('mark')].map((m) => m.textContent)).toEqual([
            'pizza',
            'Pizza',
            'pizza',
        ]);
    });

    test('says who wrote a hit where the row alone would not', () => {
        render(MessageSearchResults, { props: props() });

        // Mine, and a group member's; a one-to-one reply needs no name.
        expect(screen.getByText('You')).toBeInTheDocument();
        expect(screen.getByText('Bo')).toBeInTheDocument();
    });

    test('opens the conversation a row belongs to', async () => {
        const onOpen = vi.fn();
        render(MessageSearchResults, { props: props({ onOpen }) });

        await fireEvent.click(screen.getByText('Crew'));
        expect(onOpen).toHaveBeenCalledWith(HITS[1]);
    });

    test('owns up to the cap, and offers the older ones', async () => {
        const onShowMore = vi.fn();
        render(MessageSearchResults, { props: props({ total: 250, onShowMore }) });

        expect(screen.getByText('newest 3 of 250')).toBeInTheDocument();
        await fireEvent.click(screen.getByRole('button', { name: /Show older/ }));
        expect(onShowMore).toHaveBeenCalled();
    });

    test('says so when nothing matches', () => {
        render(MessageSearchResults, { props: props({ hits: [], total: 0 }) });

        expect(screen.getByText(/No message matches/)).toBeInTheDocument();
    });
});
