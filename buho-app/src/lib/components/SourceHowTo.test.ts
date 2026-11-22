import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/svelte';
import '@testing-library/jest-dom/vitest';
import SourceHowTo from './SourceHowTo.svelte';
import { CATALOG_SOURCES } from '#lib/data/sources/catalog.ts';

afterEach(cleanup);

function sourceById(id: string) {
    const source = CATALOG_SOURCES.find((s) => s.id === id);
    if (!source) throw new Error(`no catalog source ${id}`);
    return source;
}

function useTracker() {
    const track = vi.fn();
    (window as unknown as { umami?: unknown }).umami = { track };
    return track;
}

describe('SourceHowTo', () => {
    beforeEach(() => {
        delete (window as unknown as { umami?: unknown }).umami;
    });

    /**
     * The click that leaves for Garmin (or Spotify, or Takeout) is the last
     * thing we can see of an import that will only come back days later — every
     * other funnel event fires after the file is already on disk.
     */
    it('reports leaving for the provider, and which export was asked for', async () => {
        const track = useTracker();
        render(SourceHowTo, { props: { source: sourceById('garmin') } });

        const link = screen.getAllByRole('link')[0];
        link.removeAttribute('href'); // jsdom cannot navigate
        link.click();

        expect(track).toHaveBeenCalledWith(
            'export-open',
            expect.objectContaining({ service: 'garmin', link: 'export' })
        );
    });

    /** The second download a few services split their data across. */
    it('tells the extra download from the main destination', () => {
        const track = useTracker();
        const source = sourceById('messenger');
        expect(source.guide.extra).toBeDefined();

        render(SourceHowTo, { props: { source } });

        const links = screen.getAllByRole('link');
        const extra = links[links.length - 1];
        extra.removeAttribute('href');
        extra.click();

        expect(track).toHaveBeenCalledWith(
            'export-open',
            expect.objectContaining({ service: 'messenger', link: 'extra' })
        );
    });

    it('renders without a tracker, as it does in dev and behind a blocker', () => {
        render(SourceHowTo, { props: { source: sourceById('spotify') } });

        const link = screen.getAllByRole('link')[0];
        link.removeAttribute('href');
        expect(() => link.click()).not.toThrow();
    });
});
