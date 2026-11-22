import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/svelte';
import '@testing-library/jest-dom/vitest';
import ModuleEmptyState from './ModuleEmptyState.svelte';
import { moduleById } from '#lib/data/modules.ts';
import { dataStore } from '#lib/stores/dataStore.svelte.ts';

// The import dialog it owns is portalled into <body>, so it outlives the container.
afterEach(cleanup);

describe('ModuleEmptyState', () => {
    beforeEach(() => {
        dataStore.reset();
    });

    /**
     * The screen this replaced was, on /listening/explore, a permanent
     * "Rendering universe…" over an empty database — and on the other four, one
     * flat sentence pointing at a control in the header.
     */
    it('offers the sample first where there is one', () => {
        render(ModuleEmptyState, { props: { module: moduleById('listening') } });

        expect(screen.getByRole('button', { name: 'Load demo data' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Import my own export/i })).toBeInTheDocument();
        // Offered, never loaded on sight.
        expect(dataStore.isSample('listening')).toBe(false);
    });

    it('falls back to the import where there is no sample', () => {
        render(ModuleEmptyState, { props: { module: moduleById('positions') } });

        expect(screen.queryByRole('button', { name: 'Load demo data' })).toBeNull();
        expect(screen.getByRole('button', { name: /Import my positions/i })).toBeInTheDocument();
    });

    /**
     * "Import my positions" is only actionable if you already know a Timeline
     * export is the thing that produces them, which is exactly what somebody
     * looking at an empty module does not know.
     */
    it('names the exports that would fill it, each linked to its how-to', () => {
        render(ModuleEmptyState, { props: { module: moduleById('messages') } });

        // The app is served under a base path, so only the tail is asserted.
        const whatsapp = screen.getByRole('link', { name: /WhatsApp/ });
        expect(whatsapp.getAttribute('href')).toMatch(/\/sources\/whatsapp$/);
        expect(screen.getByRole('link', { name: /Messenger/ })).toBeInTheDocument();

        // Not the ones that feed some other module.
        expect(screen.queryByRole('link', { name: /Spotify/ })).toBeNull();
    });

    it('says how long each of them takes to arrive', () => {
        render(ModuleEmptyState, { props: { module: moduleById('listening') } });

        expect(screen.getByRole('link', { name: /Spotify.*24 hours/i })).toBeInTheDocument();
    });

    /**
     * The chips on their own were a legend: they said where the numbers would
     * come from and left the visitor to work out that the next move is to go
     * and ask for an export, that it comes back hours later, and that they are
     * meant to return with it.
     */
    describe('what the module is waiting for', () => {
        it('names the one export to ask for, and links it', () => {
            render(ModuleEmptyState, { props: { module: moduleById('steps') } });

            expect(screen.getByText(/Request your data from/)).toBeInTheDocument();
            expect(screen.getByText(/come back with the file/)).toBeInTheDocument();

            const garmin = screen.getByRole('link', { name: 'Garmin Connect' });
            expect(garmin.getAttribute('href')).toMatch(/\/sources\/garmin$/);

            // The wait is in the sentence, so the chip row would only repeat it.
            expect(screen.getByText(/a few hours/i)).toBeInTheDocument();
            expect(document.querySelectorAll('.feeds li')).toHaveLength(0);
        });

        /**
         * Positions has two exports behind it and Messages three, so there is a
         * choice to make and the chips make it better than a sentence listing
         * services.
         */
        it('points at the chips where there is a choice to make', () => {
            render(ModuleEmptyState, { props: { module: moduleById('messages') } });

            expect(screen.getByText(/Request your data from one of these/)).toBeInTheDocument();
            // One chip per export that could fill it, so the choice is visible.
            expect(document.querySelectorAll('.feeds li')).toHaveLength(3);
        });

        /** The screen stays a screen: no procedure, no archive specs. */
        it('stops short of the export procedure itself', () => {
            render(ModuleEmptyState, { props: { module: moduleById('steps') } });

            expect(screen.queryByText(/Data Management/)).toBeNull();
            expect(screen.queryByText(/gigabyte or two/i)).toBeNull();
            expect(screen.getByRole('button', { name: /Import my steps/i })).toBeInTheDocument();
        });
    });
});
