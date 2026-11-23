import { render, screen, within } from '@testing-library/svelte';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, test } from 'vitest';
import { resolve } from '$app/paths';
import SourcePage from './+page.svelte';
import { entries, load } from './+page.ts';
import { CATALOG_SOURCES, modulesFilledBy, type CatalogSource } from '#lib/data/sources/catalog.ts';
import { dataStore } from '#lib/stores/dataStore.svelte.ts';

const spotify = CATALOG_SOURCES.find((source) => source.id === 'spotify')!;

function renderSource(source: CatalogSource) {
    return render(SourcePage, { props: { params: { source: source.id }, data: { source } } });
}

describe('source detail page', () => {
    afterEach(() => {
        dataStore.reset();
    });

    test('one page is generated per catalog source', () => {
        expect(entries()).toEqual(CATALOG_SOURCES.map((source) => ({ source: source.id })));
    });

    test('load hands the page its source, by id', () => {
        // @ts-expect-error — only `params` is read, so the full LoadEvent is noise.
        expect(load({ params: { source: 'deezer' } }).source.label).toBe('Deezer');
    });

    test('an unknown export is a 404, not an empty page', () => {
        // @ts-expect-error — see above.
        expect(() => load({ params: { source: 'napster' } })).toThrow();
    });

    test('the export is named, with what arrives and how long it takes', () => {
        renderSource(spotify);

        expect(screen.getByRole('heading', { level: 1, name: /Spotify/ })).toBeInTheDocument();

        const facts = within(document.querySelector('.facts')!);
        expect(facts.getByText(spotify.format)).toBeInTheDocument();
        expect(facts.getByText(spotify.delay)).toBeInTheDocument();
        expect(facts.getByText(spotify.size)).toBeInTheDocument();
    });

    /** Get it, wait for it, drop it — each a heading under the export's name. */
    test('the guide is three stages under the title', () => {
        renderSource(spotify);

        const stages = screen
            .getAllByRole('heading', { level: 2 })
            .map((h) => h.textContent?.trim());
        expect(stages).toEqual([spotify.guide.get, spotify.guide.wait.title, 'Drop it here']);
        expect(screen.getByText(spotify.guide.intro)).toBeInTheDocument();
    });

    test('the steps to get it are rendered, in order', () => {
        renderSource(spotify);

        const steps = screen.getAllByRole('listitem').map((item) => item.textContent ?? '');
        // The catalog writes them with inline emphasis, so the rendered text is
        // the markup stripped: match on a distinctive phrase from each.
        expect(steps.some((text) => text.includes('Extended streaming history'))).toBe(true);
        expect(steps.some((text) => text.includes('Request data'))).toBe(true);
    });

    /**
     * The archive is not described file by file any more, and must not creep
     * back: every file is routed by what is inside it, so which one holds what
     * is something nobody has to know — it was two screens of reference between
     * somebody holding a zip and the place to drop it.
     */
    test('it does not describe the archive file by file', () => {
        renderSource(spotify);

        expect(screen.queryByRole('heading', { name: 'Walked past' })).not.toBeInTheDocument();
        expect(screen.queryByText('Streaming_History_Video_2020.json')).not.toBeInTheDocument();
    });

    /**
     * What a module is for is the module's own page to say. This one links to
     * it — one link per module the export fills — and stops there.
     */
    test('the modules it fills are linked, and not re-explained', () => {
        const garmin = CATALOG_SOURCES.find((source) => source.id === 'garmin')!;
        renderSource(garmin);

        // The one export feeding three modules — all have to be reachable.
        for (const module of modulesFilledBy(garmin)) {
            const links = screen.getAllByRole('link', { name: new RegExp(module.label) });
            expect(links.length).toBe(1);
            expect(links[0]).toHaveAttribute('href', resolve(module.href));
            expect(screen.queryByText(module.table)).not.toBeInTheDocument();
        }
    });

    /**
     * "Fills Positions" was a heading in a vocabulary nobody had been taught.
     * The same fact has to read as a sentence, with the modules listed the way
     * a sentence lists things.
     */
    test('where the data ends up reads as a sentence', () => {
        const garmin = CATALOG_SOURCES.find((source) => source.id === 'garmin')!;
        renderSource(garmin);

        const text = document.querySelector('.destination')!.textContent!.replace(/\s+/g, ' ');
        expect(text).toContain('Its data goes into Positions, Steps and Health.');
    });

    test('the export link opens in a new tab, safely', () => {
        renderSource(spotify);

        const link = screen.getByRole('link', { name: new RegExp(spotify.link!.label) });
        expect(link).toHaveAttribute('href', spotify.link!.href);
        expect(link).toHaveAttribute('rel', 'noreferrer');
    });

    /**
     * Every guide's last step is some wording of "drop it here", so the page
     * has to hold a here — a zone that takes a drop, not a button that opens a
     * dialog holding one.
     */
    test('the last step of the guide has somewhere to land', () => {
        renderSource(spotify);

        const zone = document.querySelector('.zone');
        expect(zone).not.toBeNull();
        expect(within(zone as HTMLElement).getByText(/Drop your export here/)).toBeInTheDocument();
        expect(
            within(zone as HTMLElement).getByRole('button', { name: 'Choose files' })
        ).toBeInTheDocument();
        // The promise sits where the file is handed over, not three sections down.
        expect(within(zone as HTMLElement).getByText(/without uploading/i)).toBeInTheDocument();
    });

    test('the other exports are reachable, and the page does not link to itself', () => {
        renderSource(spotify);

        const others = within(document.querySelector('.others')!)
            .getAllByRole('link')
            .map((link) => link.getAttribute('href'));

        expect(others).toHaveLength(CATALOG_SOURCES.length - 1);
        expect(others).not.toContain('/sources/spotify');
        expect(others).toContain('/sources/deezer');
    });

    test('nothing imported: the page says nothing about holding data', () => {
        renderSource(spotify);
        expect(screen.queryByText(/Already loaded/)).not.toBeInTheDocument();
    });

    test('it says so when the module this export feeds already holds data', () => {
        dataStore.loadUserData('listening');
        renderSource(spotify);
        expect(screen.getByText(/Already loaded/)).toBeInTheDocument();
    });
});
