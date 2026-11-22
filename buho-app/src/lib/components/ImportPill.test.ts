import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/svelte';
import '@testing-library/jest-dom/vitest';
import ImportPill from './ImportPill.svelte';
import { dataStore } from '#lib/stores/dataStore.svelte.ts';
import { moduleById } from '#lib/data/modules.ts';
import type { LoadedSource } from '#lib/data/queries/inventory.ts';

// The dialog it owns is portalled into <body>, so it outlives the container.
afterEach(cleanup);

describe('ImportPill', () => {
    beforeEach(() => {
        dataStore.reset();
    });

    it('invites an import when the module is empty', () => {
        render(ImportPill, { props: { module: moduleById('positions') } });

        expect(screen.getByRole('button', { name: /Import my positions/i })).toBeInTheDocument();
    });

    /**
     * The listening layout used to build a decade of invented plays on mount,
     * so anyone opening the explorer was shown someone else's habits with only
     * a small pill to say so. The sample is still here, but it has to be asked
     * for — and only where there is one to ask for.
     */
    it('offers the sample where one exists, and never loads it unasked', () => {
        render(ImportPill, { props: { module: moduleById('listening') } });

        expect(screen.getByRole('button', { name: /Load demo data/i })).toBeInTheDocument();
        expect(dataStore.isDemo).toBe(false);
        expect(dataStore.loaded.listening).toBe(false);
    });

    it('offers no sample for a module that has none', () => {
        render(ImportPill, { props: { module: moduleById('positions') } });

        expect(screen.queryByRole('button', { name: /Load demo data/i })).not.toBeInTheDocument();
    });

    it('names the exports feeding this module, and only those', () => {
        // Read off the inventory rather than a per-module query: one drop can
        // fill several modules, so the question is the same in every header.
        dataStore.loadUserData('positions');
        dataStore.inventory = [
            {
                id: 'google-timeline',
                label: 'Google Timeline',
                icon: 'map-pin',
                holdings: [{ module: 'positions', rows: 128610 }],
                rows: 128610,
            },
            {
                id: 'garmin',
                label: 'Garmin Connect',
                icon: 'garmin',
                holdings: [
                    { module: 'positions', rows: 412907 },
                    { module: 'steps', rows: 9169 },
                ],
                rows: 422076,
            },
            {
                id: 'spotify',
                label: 'Spotify',
                icon: 'spotify',
                holdings: [{ module: 'listening', rows: 167961 }],
                rows: 167961,
            },
        ] satisfies LoadedSource[];

        render(ImportPill, { props: { module: moduleById('positions') } });

        // Locale-independent: the separator is asserted, not the digit grouping.
        expect(screen.getByText(/Google Timeline · .+ — Garmin Connect · /)).toBeInTheDocument();
        expect(screen.queryByText(/Spotify/)).toBeNull();
    });

    it('flags demo data on a module showing a sample', () => {
        dataStore.loadDemoData('listening');
        render(ImportPill, { props: { module: moduleById('listening') } });

        expect(screen.getByText('Demo data')).toBeInTheDocument();
        expect(
            screen.getByRole('button', { name: 'Explore my personal data' })
        ).toBeInTheDocument();
    });

    /**
     * The only exit from the sample used to be importing something over it,
     * which is no help to somebody who simply wants the page to stop showing
     * invented data.
     */
    it('makes the demo badge the way out of the demo', async () => {
        // What the drop actually does to the table is a DuckDB question, tested
        // against the real statements in `dataStore.test.ts`. Here the contract
        // is only that the badge is a control and that it names its module.
        const clear = vi.spyOn(dataStore, 'clearDemo').mockResolvedValue();
        dataStore.loadDemoData('listening');
        render(ImportPill, { props: { module: moduleById('listening') } });

        await fireEvent.click(screen.getByRole('button', { name: /Demo data/ }));

        expect(clear).toHaveBeenCalledWith('listening');
        clear.mockRestore();
    });

    /**
     * `isDemo` was a single global boolean for as long as Listening was the
     * only module with a sample. With two, it can no longer answer for either.
     */
    it('does not call one module demo because another one is', () => {
        dataStore.loadDemoData('messages');
        render(ImportPill, { props: { module: moduleById('listening') } });

        expect(screen.queryByText('Demo data')).toBeNull();
    });

    it('never claims demo data on a module that ships none', () => {
        // `isDemo` is a statement about the plays table; a Timeline drop while on
        // demo music must not make the map read as demo too.
        dataStore.loadDemoData('listening');
        dataStore.loaded.positions = true;
        render(ImportPill, { props: { module: moduleById('positions') } });

        expect(screen.queryByText('Demo data')).toBeNull();
        expect(screen.getByText('Your data')).toBeInTheDocument();
    });

    it('shows the import progress in place', () => {
        dataStore.setLoading({ status: 'importing', message: 'Importing 412 907 positions...' });
        render(ImportPill, { props: { module: moduleById('positions') } });

        expect(screen.getByText('Importing 412 907 positions...')).toBeInTheDocument();
    });

    it('opens the dialog', async () => {
        render(ImportPill, { props: { module: moduleById('messages') } });
        await fireEvent.click(screen.getByRole('button', { name: /Import my messages/i }));

        expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
});
