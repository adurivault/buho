import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
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

    /** The funnel step before leaving: which export's guide was put in front of someone. */
    it('reports the guide it shows, and again for the next one', async () => {
        const track = useTracker();
        const { rerender } = render(SourceHowTo, { props: { source: sourceById('garmin') } });
        expect(track).toHaveBeenCalledWith(
            'howto-open',
            expect.objectContaining({ service: 'garmin' })
        );

        await rerender({ source: sourceById('spotify') });
        const opened = track.mock.calls.filter((call) => call[0] === 'howto-open');
        expect(opened.map((call) => call[1].service)).toEqual(['garmin', 'spotify']);
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
        expect(source.guide.downloads).toHaveLength(2);

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

    /** Get it, wait for it, drop it: the stages every export goes through. */
    it('heads the guide with three stages, in this export’s own terms', () => {
        const source = sourceById('strava');
        render(SourceHowTo, { props: { source } });

        const headings = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
        expect(headings.map((text) => text?.trim())).toEqual([
            source.guide.get,
            source.guide.wait.title,
            'Drop it into Buho',
        ]);
    });

    /** Timeline is a feature many have never turned on: the steps assume it is. */
    it('explains the service before the stages, when it needs explaining', () => {
        const source = sourceById('google-timeline');
        render(SourceHowTo, { props: { source, intro: false } });

        const headings = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
        expect(headings[0]?.trim()).toBe(source.guide.background!.title);
        expect(headings[1]?.trim()).toBe(source.guide.get);
        expect(screen.getByText(/on your phone only/)).toBeInTheDocument();
    });

    it('takes the heading level of the surface it sits under', () => {
        render(SourceHowTo, { props: { source: sourceById('spotify'), headingLevel: 2 } });
        expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(3);
    });

    /** Messenger's and Instagram's steps say "set the three settings above". */
    it('states the settings before the steps that refer to them', () => {
        render(SourceHowTo, { props: { source: sourceById('instagram') } });

        const settings = screen.getByText('Set these before requesting');
        const step = screen.getByText(/Set the three settings above/);
        expect(settings.compareDocumentPosition(step) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
            Node.DOCUMENT_POSITION_FOLLOWING
        );
    });

    it('lays a split export out as its downloads, each with its own way there', () => {
        const source = sourceById('messenger');
        render(SourceHowTo, { props: { source } });

        for (const download of source.guide.downloads!) {
            expect(screen.getByText(download.title)).toBeInTheDocument();
            expect(
                screen.getByRole('link', { name: new RegExp(download.link.label) })
            ).toHaveAttribute('href', download.link.href);
        }
        expect(screen.getByText('Download 2 of 2')).toBeInTheDocument();
    });

    it('holds the drop zone of a surface that has one, as stage three', () => {
        const drop = createRawSnippet(() => ({ render: () => '<div data-testid="zone"></div>' }));
        render(SourceHowTo, { props: { source: sourceById('garmin'), drop } });

        expect(screen.getByRole('heading', { name: 'Drop it here' })).toBeInTheDocument();
        expect(screen.getByTestId('zone')).toBeInTheDocument();
        expect(screen.getByText(/ten thousand/)).toBeInTheDocument();
    });

    it('leaves the intro out when the surface states it itself', () => {
        const source = sourceById('strava');
        render(SourceHowTo, { props: { source, intro: false } });
        expect(screen.queryByText(source.guide.intro)).not.toBeInTheDocument();
    });
});
