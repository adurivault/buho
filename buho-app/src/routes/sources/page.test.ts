import { render, screen, within } from '@testing-library/svelte';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, test } from 'vitest';
import { resolve } from '$app/paths';
import SourcesPage from './+page.svelte';
import { CATALOG_SOURCES, modulesFilledBy, sourcesFilling } from '#lib/data/sources/catalog.ts';
import { DATA_MODULES } from '#lib/data/modules.ts';
import type { ModuleId } from '#lib/data/modules.ts';
import { dataStore } from '#lib/stores/dataStore.svelte.ts';

/** The panel of one dataset, found by its heading. */
function panel(label: string): HTMLElement {
    const heading = screen.getByRole('heading', { level: 2, name: label });
    const section = heading.closest('section');
    if (!section) throw new Error(`no panel for ${label}`);
    return section;
}

function moduleLabel(id: ModuleId): string {
    return DATA_MODULES.find((module) => module.id === id)!.label;
}

describe('sources page', () => {
    afterEach(() => {
        dataStore.reset();
    });

    test('one panel per dataset, in sidebar order', () => {
        render(SourcesPage);

        const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
        expect(headings.map((text) => text?.trim())).toEqual(
            DATA_MODULES.map((module) => module.label)
        );
    });

    test('a panel lists every export that feeds it, quickest first', () => {
        render(SourcesPage);

        for (const module of DATA_MODULES) {
            const links = within(panel(module.label))
                .getAllByRole('link')
                .map((link) => link.getAttribute('href'))
                .filter((href) => href?.startsWith('/sources/'));
            expect(links, `${module.label} lists the wrong exports`).toEqual(
                sourcesFilling(module.id).map((source) => `/sources/${source.id}`)
            );
        }
    });

    /**
     * Without a table, the many-to-many relationship lives here: an export
     * feeding three datasets is under each of them, naming the other two.
     */
    test('an export feeding several datasets says so in each of them', () => {
        render(SourcesPage);

        const garmin = CATALOG_SOURCES.find((source) => source.id === 'garmin')!;
        for (const module of modulesFilledBy(garmin)) {
            const row = within(panel(module.label)).getByRole('link', { name: /Garmin Connect/ });
            const others = modulesFilledBy(garmin).filter((other) => other.id !== module.id);
            expect(row).toHaveTextContent(
                `Also feeds ${others.map((other) => other.label).join(' and ')}`
            );
        }

        const spotify = within(panel(moduleLabel('listening'))).getByRole('link', {
            name: /Spotify/,
        });
        expect(spotify).not.toHaveTextContent('Also feeds');
    });

    test('a row says how long the export takes and what arrives', () => {
        render(SourcesPage);

        for (const source of CATALOG_SOURCES) {
            const [first] = modulesFilledBy(source);
            const row = within(panel(first.label)).getByRole('link', {
                name: new RegExp(source.label),
            });
            expect(row).toHaveTextContent(source.delay);
            expect(row).toHaveTextContent(source.format);
        }
    });

    // A panel stands for the dataset, a row for the export it came out of, so
    // neither may borrow the other's mark.
    test("the Steps panel is footprints, its Garmin row the maker's triangle", () => {
        render(SourcesPage);

        const steps = panel('Steps');
        const heading = within(steps).getByRole('heading', { level: 2 });
        expect(heading.querySelector('.lucide-footprints')).toBeTruthy();

        const garmin = within(steps).getByRole('link', { name: /Garmin Connect/ });
        expect(garmin.querySelector('.lucide-triangle')).toBeTruthy();
    });

    test('the Listening panel is a note, not either service that feeds it', () => {
        render(SourcesPage);

        const listening = panel('Listening');
        const heading = within(listening).getByRole('heading', { level: 2 });
        expect(heading.querySelector('.lucide-music')).toBeTruthy();

        // Spotify and Deezer keep their own marks on their own rows.
        for (const label of ['Spotify', 'Deezer']) {
            const row = within(listening).getByRole('link', { name: new RegExp(label) });
            expect(row.querySelector('.lucide-music')).toBeFalsy();
        }
    });

    test('each panel reports whether its dataset holds data', () => {
        render(SourcesPage);
        expect(screen.getAllByText('empty')).toHaveLength(DATA_MODULES.length);
        expect(screen.queryByText('holds data')).not.toBeInTheDocument();
    });

    test('importing flips the matching panels, and only them', () => {
        // A Garmin archive fills Steps and Health — and still leaves Positions
        // dark when it holds no recorded activity.
        dataStore.loadUserData('steps');
        dataStore.loadUserData('health');
        render(SourcesPage);
        expect(within(panel('Steps')).getByText('holds data')).toBeInTheDocument();
        expect(within(panel('Health')).getByText('holds data')).toBeInTheDocument();
        expect(within(panel('Positions')).getByText('empty')).toBeInTheDocument();
        expect(screen.getAllByText('empty')).toHaveLength(DATA_MODULES.length - 2);
    });

    test('a panel heading leads to its dataset', () => {
        render(SourcesPage);

        for (const module of DATA_MODULES) {
            const heading = within(panel(module.label)).getByRole('heading', { level: 2 });
            expect(within(heading).getByRole('link')).toHaveAttribute('href', resolve(module.href));
        }
    });

    test('the no-upload promise says how to check it', () => {
        render(SourcesPage);

        expect(screen.getByRole('link', { name: 'How to check' })).toHaveAttribute(
            'href',
            '/faq#verify'
        );
    });
});
