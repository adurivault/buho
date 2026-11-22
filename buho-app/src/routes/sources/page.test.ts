import { render, screen, within } from '@testing-library/svelte';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, test } from 'vitest';
import SourcesPage from './+page.svelte';
import { CATALOG_SOURCES } from '#lib/data/sources/catalog.ts';
import { DATA_MODULES } from '#lib/data/modules.ts';
import { dataStore } from '#lib/stores/dataStore.svelte.ts';

describe('sources page', () => {
    afterEach(() => {
        dataStore.reset();
    });

    test('the matrix has one column per module and one row per source', () => {
        render(SourcesPage);

        const columns = screen.getAllByRole('columnheader');
        // The corner cell plus one header per module.
        expect(columns).toHaveLength(DATA_MODULES.length + 1);

        const rows = screen.getAllByRole('rowheader');
        expect(rows).toHaveLength(CATALOG_SOURCES.length);
    });

    test('a cell says what lands, or reads as not provided', () => {
        render(SourcesPage);

        const garminRow = screen.getByRole('rowheader', { name: /Garmin Connect/ }).closest('tr');
        expect(garminRow).not.toBeNull();
        const cells = within(garminRow!).getAllByRole('cell');

        // Columns are listening, positions, messages, activity, steps, health —
        // a Garmin export fills the second and the last two.
        expect(cells[1]).toHaveTextContent('GPS tracks');
        expect(cells[4]).toHaveTextContent('Counters');
        expect(cells[5]).toHaveTextContent('Every minute');
        expect(cells[0]).toHaveTextContent('not provided');
    });

    // A column stands for the dataset, a row for the export it came out of, so
    // neither axis may borrow the other's mark.
    test("the Steps column is footprints, the Garmin row the maker's triangle", () => {
        render(SourcesPage);

        const steps = screen.getByRole('columnheader', { name: /Steps/ });
        expect(steps.querySelector('.lucide-footprints')).toBeTruthy();

        const garmin = screen.getByRole('rowheader', { name: /Garmin Connect/ });
        expect(garmin.querySelector('.lucide-triangle')).toBeTruthy();
    });

    test('the Listening column is a note, not either service that feeds it', () => {
        render(SourcesPage);

        const listening = screen.getByRole('columnheader', { name: /Listening/ });
        expect(listening.querySelector('.lucide-music')).toBeTruthy();

        // Spotify and Deezer keep their own marks on their own rows.
        for (const id of ['spotify', 'deezer']) {
            const row = document.querySelector(`th.source-head a[href="/sources/${id}"]`);
            expect(row?.querySelector('.lucide-music')).toBeFalsy();
        }
    });

    test('column headers report what currently holds data', () => {
        render(SourcesPage);
        expect(screen.getAllByText('empty')).toHaveLength(DATA_MODULES.length);
        expect(screen.queryByText('holds data')).not.toBeInTheDocument();
    });

    test('importing flips the matching column, and only it', () => {
        // A Garmin archive fills Steps and Health — and still leaves Positions
        // dark when it holds no recorded activity.
        dataStore.loadUserData('steps');
        dataStore.loadUserData('health');
        render(SourcesPage);
        expect(screen.getAllByText('holds data')).toHaveLength(2);
        expect(screen.getAllByText('empty')).toHaveLength(DATA_MODULES.length - 2);
        expect(screen.getByText(/Holding data right now: Steps, Health\./)).toBeInTheDocument();
    });

    /**
     * The page is the map and nothing else: how to get an export, what arrives
     * and which of it is opened live on `/sources/[source]`. A row that doesn't
     * lead there is a dead end, since nothing else on the page says it.
     */
    test('the no-upload promise says how to check it', () => {
        render(SourcesPage);

        expect(screen.getByRole('link', { name: 'How to check' })).toHaveAttribute(
            'href',
            '/faq#verify'
        );
    });

    test("every row leads to that export's own page", () => {
        render(SourcesPage);

        for (const source of CATALOG_SOURCES) {
            const row = screen.getByRole('rowheader', { name: new RegExp(source.label) });
            const link = within(row).getByRole('link');
            expect(link, `${source.label} links nowhere`).toHaveAttribute(
                'href',
                `/sources/${source.id}`
            );
        }
    });

    test('a row says what format that export arrives in', () => {
        render(SourcesPage);

        for (const source of CATALOG_SOURCES) {
            expect(
                screen.getByRole('rowheader', { name: new RegExp(source.label) })
            ).toHaveTextContent(source.format);
        }
    });
});
