import { render, screen } from '@testing-library/svelte';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import LazySection from './LazySection.svelte';
import LoadingOverlay from './LoadingOverlay.svelte';

// Controllable IntersectionObserver mock: captures the callback so tests can
// simulate the section entering the viewport.
let ioCallback: IntersectionObserverCallback | null = null;
const observe = vi.fn();
const disconnect = vi.fn();

class ControllableIntersectionObserver {
    constructor(callback: IntersectionObserverCallback) {
        ioCallback = callback;
    }
    observe = observe;
    unobserve = vi.fn();
    disconnect = disconnect;
    takeRecords = vi.fn();
}

describe('LazySection', () => {
    beforeEach(() => {
        ioCallback = null;
        observe.mockClear();
        disconnect.mockClear();
        vi.stubGlobal('IntersectionObserver', ControllableIntersectionObserver);
    });

    it('does not mount the wrapped component before intersection', () => {
        render(LazySection, {
            props: { component: LoadingOverlay, props: { message: 'lazy-child' } }
        });

        expect(observe).toHaveBeenCalledTimes(1);
        expect(screen.queryByText('lazy-child')).not.toBeInTheDocument();
    });

    it('mounts the wrapped component once it intersects, then disconnects', async () => {
        render(LazySection, {
            props: { component: LoadingOverlay, props: { message: 'lazy-child' } }
        });

        expect(ioCallback).not.toBeNull();
        ioCallback!([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);

        expect(await screen.findByText('lazy-child')).toBeInTheDocument();
        expect(disconnect).toHaveBeenCalled();
    });

    it('stays unmounted when entries are not intersecting', () => {
        render(LazySection, {
            props: { component: LoadingOverlay, props: { message: 'lazy-child' } }
        });

        ioCallback!([{ isIntersecting: false } as IntersectionObserverEntry], {} as IntersectionObserver);

        expect(screen.queryByText('lazy-child')).not.toBeInTheDocument();
    });

    it('mounts immediately when IntersectionObserver is unavailable', async () => {
        vi.stubGlobal('IntersectionObserver', undefined);

        render(LazySection, {
            props: { component: LoadingOverlay, props: { message: 'lazy-child' } }
        });

        expect(await screen.findByText('lazy-child')).toBeInTheDocument();
    });
});
