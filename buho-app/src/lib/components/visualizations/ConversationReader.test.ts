import { render, screen, fireEvent } from '@testing-library/svelte';
import '@testing-library/jest-dom/vitest';
import { describe, expect, test, vi } from 'vitest';
import ConversationReader, { type ReaderMessage } from './ConversationReader.svelte';
import { parseSearch } from '#lib/explorer/search.ts';

function message(over: Partial<ReaderMessage> & { id: number }): ReaderMessage {
    return {
        sentAt: '2024-03-02 10:00:00',
        sender: 'Ana',
        direction: 'Received',
        text: 'hello',
        mediaKind: 'none',
        reactions: '',
        ...over,
    };
}

const CONVERSATION = [
    message({ id: 1, sentAt: '2024-03-01 09:00:00', text: 'you around?' }),
    message({ id: 2, sentAt: '2024-03-01 09:01:00', text: 'still there?' }),
    message({
        id: 3,
        sentAt: '2024-03-01 09:05:00',
        sender: 'Me',
        direction: 'Sent',
        text: 'here',
    }),
    message({ id: 4, sentAt: '2024-03-02 21:30:00', text: 'tomorrow then' }),
];

describe('ConversationReader', () => {
    test('lays the thread out with a side per author', () => {
        const { container } = render(ConversationReader, {
            props: { contact: 'Ana', messages: CONVERSATION, total: 4 },
        });

        expect(container.querySelectorAll('.bubble')).toHaveLength(4);
        // One run per (author, day): Ana's two openers merge, mine stands alone,
        // and the next day starts over.
        const runs = [...container.querySelectorAll('.run')];
        expect(runs).toHaveLength(3);
        expect(runs[1].classList.contains('mine')).toBe(true);
        expect(runs[0].classList.contains('mine')).toBe(false);
    });

    test('separates the days', () => {
        const { container } = render(ConversationReader, {
            props: { contact: 'Ana', messages: CONVERSATION, total: 4 },
        });

        expect(container.querySelectorAll('.day')).toHaveLength(2);
    });

    test('names the author in a group, and nobody in a one-to-one', () => {
        const { rerender, container } = render(ConversationReader, {
            props: { contact: 'Crew', messages: CONVERSATION, total: 4, isGroup: true },
        });

        // Only the incoming runs are labelled: on my own side the name is the
        // position, not the text.
        expect(container.querySelectorAll('.sender')).toHaveLength(2);
        expect(screen.getAllByText('Ana').length).toBeGreaterThan(0);

        rerender({ contact: 'Ana', messages: CONVERSATION, total: 4, isGroup: false });
        expect(container.querySelectorAll('.sender')).toHaveLength(0);
    });

    test('says an attachment happened when it carried no text', () => {
        render(ConversationReader, {
            props: {
                contact: 'Ana',
                messages: [message({ id: 9, text: '', mediaKind: 'voice' })],
                total: 1,
            },
        });

        expect(screen.getByText('[voice]')).toBeInTheDocument();
    });

    test('owns up to the display cap instead of implying the thread is short', () => {
        render(ConversationReader, {
            props: { contact: 'Ana', messages: CONVERSATION, total: 900 },
        });

        expect(screen.getByText(/last 4 of 900/)).toBeInTheDocument();
    });

    test('offers to walk further back, and says how much is left', async () => {
        const onLoadEarlier = vi.fn();
        render(ConversationReader, {
            props: {
                contact: 'Ana',
                messages: CONVERSATION,
                total: 900,
                onLoadEarlier,
            },
        });

        expect(screen.getByText('896 left')).toBeInTheDocument();
        await fireEvent.click(screen.getByRole('button', { name: /Load earlier messages/ }));
        expect(onLoadEarlier).toHaveBeenCalled();
    });

    test('drops the offer once the whole thread is shown', () => {
        render(ConversationReader, {
            props: { contact: 'Ana', messages: CONVERSATION, total: 4 },
        });

        expect(
            screen.queryByRole('button', { name: /Load earlier messages/ })
        ).not.toBeInTheDocument();
    });

    test('reports an empty conversation as filtered out, not as missing', () => {
        render(ConversationReader, {
            props: { contact: 'Ana', messages: [], total: 0 },
        });

        expect(
            screen.getByText('No message in this conversation matches the filters.')
        ).toBeInTheDocument();
    });

    test('closes on request', async () => {
        const onClose = vi.fn();
        render(ConversationReader, {
            props: { contact: 'Ana', messages: CONVERSATION, total: 4, onClose },
        });

        await fireEvent.click(screen.getByRole('button', { name: 'Close conversation' }));
        expect(onClose).toHaveBeenCalled();
    });

    describe('during a search', () => {
        const searching = (over: Record<string, unknown> = {}) => ({
            contact: 'Ana',
            messages: CONVERSATION,
            total: 4,
            terms: parseSearch('there, tomorrow'),
            colors: ['#c98bdb', '#4cc38a'],
            hits: [2, 4],
            ...over,
        });

        test('marks the matches in their term color, around the rest of the thread', () => {
            const { container } = render(ConversationReader, { props: searching() });

            // The whole thread is there, not only the hits.
            expect(container.querySelectorAll('.bubble')).toHaveLength(4);
            const marks = [...container.querySelectorAll('mark')];
            expect(marks.map((m) => m.textContent)).toEqual(['there', 'tomorrow']);
            expect((marks[1] as HTMLElement).style.getPropertyValue('--mark-color')).toBe(
                '#4cc38a'
            );
        });

        test('rings the message it was opened on', () => {
            const { container } = render(ConversationReader, { props: searching({ focusId: 4 }) });

            const focused = container.querySelectorAll('.bubble.focused');
            expect(focused).toHaveLength(1);
            expect(focused[0].textContent).toContain('tomorrow then');
        });

        test('steps from one match to the next, and says where it is', async () => {
            const onFocus = vi.fn();
            render(ConversationReader, { props: searching({ focusId: 4, onFocus }) });

            expect(screen.getByText('match 2 of 2')).toBeInTheDocument();
            expect(screen.getByRole('button', { name: 'Next match' })).toBeDisabled();
            await fireEvent.click(screen.getByRole('button', { name: 'Previous match' }));
            expect(onFocus).toHaveBeenCalledWith(2);
        });

        test('counts the matches before one is picked, and steps back from the end', async () => {
            const onFocus = vi.fn();
            render(ConversationReader, { props: searching({ onFocus }) });

            expect(screen.getByText('2 matches')).toBeInTheDocument();
            await fireEvent.click(screen.getByRole('button', { name: 'Previous match' }));
            expect(onFocus).toHaveBeenCalledWith(4);
        });

        test('says so when this conversation holds no match', () => {
            render(ConversationReader, { props: searching({ hits: [] }) });

            expect(screen.getByText('no match')).toBeInTheDocument();
            expect(screen.getByRole('button', { name: 'Previous match' })).toBeDisabled();
        });
    });

    test('offers the messages after a window opened further back', async () => {
        const onLoadLater = vi.fn();
        render(ConversationReader, {
            props: { contact: 'Ana', messages: CONVERSATION, total: 900, later: 300, onLoadLater },
        });

        expect(screen.getByText('4 of 900')).toBeInTheDocument();
        // Earlier and later split what is not shown between them.
        expect(screen.getByText('596 left')).toBeInTheDocument();
        expect(screen.getByText('300 left')).toBeInTheDocument();
        await fireEvent.click(screen.getByRole('button', { name: /Load later messages/ }));
        expect(onLoadLater).toHaveBeenCalled();
    });
});
