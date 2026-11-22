import { render, screen } from '@testing-library/svelte';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRawSnippet } from 'svelte';
import Scrolly from './Scrolly.svelte';

// Controllable IntersectionObserver: captures the callback and every observed
// node, so a test can say "this step is now on the reader's eye line".
let ioCallback: IntersectionObserverCallback | null = null;
let observed: Element[] = [];

class ControllableIntersectionObserver {
    constructor(callback: IntersectionObserverCallback) {
        ioCallback = callback;
    }
    observe = (node: Element) => {
        observed.push(node);
    };
    unobserve = vi.fn();
    disconnect = vi.fn();
    takeRecords = vi.fn();
}

function textSnippet(text: string) {
    return createRawSnippet(() => ({ render: () => `<p>${text}</p>` }));
}

function renderScrolly() {
    return render(Scrolly, {
        props: {
            steps: [textSnippet('one'), textSnippet('two'), textSnippet('three')],
            graphic: textSnippet('the chart'),
        },
    });
}

function enter(index: number) {
    ioCallback!(
        [{ target: observed[index], isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver
    );
}

function leave(index: number) {
    ioCallback!(
        [{ target: observed[index], isIntersecting: false } as IntersectionObserverEntry],
        {} as IntersectionObserver
    );
}

describe('Scrolly', () => {
    beforeEach(() => {
        ioCallback = null;
        observed = [];
        vi.stubGlobal('IntersectionObserver', ControllableIntersectionObserver);
    });

    it('renders every step and the graphic, starting on the first step', () => {
        renderScrolly();

        expect(screen.getByText('one')).toBeInTheDocument();
        expect(screen.getByText('three')).toBeInTheDocument();
        expect(screen.getByText('the chart')).toBeInTheDocument();
        expect(screen.getByTestId('scrolly-step-0')).toHaveAttribute('aria-current', 'step');
        expect(observed).toHaveLength(3);
    });

    it('activates the step that reaches the eye line', async () => {
        renderScrolly();

        enter(2);

        expect(await screen.findByTestId('scrolly-step-2')).toHaveAttribute('aria-current', 'step');
        expect(screen.getByTestId('scrolly-step-0')).not.toHaveAttribute('aria-current');
    });

    it('keeps the last step active in the gap between two steps', async () => {
        renderScrolly();

        enter(1);
        expect(await screen.findByTestId('scrolly-step-1')).toHaveAttribute('aria-current', 'step');

        leave(1);

        // Nothing on the eye line: the reader has not gone back to the start.
        expect(screen.getByTestId('scrolly-step-1')).toHaveAttribute('aria-current', 'step');
    });

    it('shows the finished state when IntersectionObserver is unavailable', async () => {
        vi.stubGlobal('IntersectionObserver', undefined);

        renderScrolly();

        expect(await screen.findByTestId('scrolly-step-2')).toHaveAttribute('aria-current', 'step');
        expect(screen.getByText('one')).toBeInTheDocument();
    });
});
