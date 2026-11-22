import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/svelte';
import '@testing-library/jest-dom/vitest';
import ModuleEmptyState from './ModuleEmptyState.svelte';
import { moduleById } from '#lib/data/modules.ts';
import { dataStore } from '#lib/stores/dataStore.svelte.ts';

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('ModuleEmptyState', () => {
    beforeEach(() => {
        dataStore.reset();
    });

    /**
     * "No health loaded" described the table, and every empty module read the
     * same. The heading names the data the module holds.
     */
    it('says what the module holds, not that it is empty', () => {
        render(ModuleEmptyState, { props: { module: moduleById('listening') } });

        expect(screen.getByRole('heading', { name: 'Listening history' })).toBeInTheDocument();
        expect(screen.queryByText(/No listening loaded/i)).toBeNull();
    });

    /**
     * A button that opened a dialog hid the fact that a file can simply be
     * dropped. The drop zone is the action, and a drop on it reaches the
     * importer tagged with where it happened.
     */
    it('takes the file in a drop zone of its own', async () => {
        const handleImport = vi.spyOn(dataStore, 'handleImport').mockResolvedValue(undefined);
        const { container } = render(ModuleEmptyState, { props: { module: moduleById('steps') } });

        expect(screen.getByText('Drop your Garmin Connect export here')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Choose files' })).toBeInTheDocument();

        const file = new File(['{}'], 'export.zip');
        const zone = container.querySelector('.zone .zone') as HTMLElement;
        await fireEvent.drop(zone, {
            dataTransfer: { items: [{ kind: 'file', getAsFile: () => file }], files: [file] },
        });

        expect(handleImport).toHaveBeenCalledWith(expect.any(Function), {
            pick: 'drop',
            surface: 'module',
            expected: 'garmin',
        });
    });

    it('says, where the file goes, that it stays in the tab, and links the FAQ', () => {
        render(ModuleEmptyState, { props: { module: moduleById('health') } });

        expect(screen.getByText(/Read in your browser, never uploaded/)).toBeInTheDocument();
        const faq = screen.getByRole('link', { name: 'More in the FAQ' });
        expect(faq.getAttribute('href')).toMatch(/\/faq#privacy$/);
    });

    it('offers the sample where there is one, and never loads it on sight', () => {
        render(ModuleEmptyState, { props: { module: moduleById('listening') } });

        expect(screen.getByRole('button', { name: 'Load demo data' })).toBeInTheDocument();
        expect(dataStore.isSample('listening')).toBe(false);
    });

    // Every module ships one today; the flag is what keeps a new one honest.
    it('offers no sample where there is none', () => {
        const module = { ...moduleById('positions'), hasDemo: false };
        render(ModuleEmptyState, { props: { module } });

        expect(screen.queryByRole('button', { name: 'Load demo data' })).toBeNull();
    });

    /**
     * A drop zone is only actionable if you already know which export to drop,
     * which is exactly what somebody looking at an empty module does not know.
     */
    it('names the exports that would fill it, each linked to its how-to', () => {
        render(ModuleEmptyState, { props: { module: moduleById('messages') } });

        // The app is served under a base path, so only the tail is asserted.
        const whatsapp = screen.getByRole('link', { name: /WhatsApp/ });
        expect(whatsapp.getAttribute('href')).toMatch(/\/sources\/whatsapp$/);
        expect(screen.getByRole('link', { name: /Messenger/ })).toBeInTheDocument();
        // One chip per export that could fill it, so the choice is visible.
        expect(document.querySelectorAll('.feeds li')).toHaveLength(3);

        // Not the ones that feed some other module.
        expect(screen.queryByRole('link', { name: /Spotify/ })).toBeNull();
    });

    it('says how long each of them takes to arrive', () => {
        render(ModuleEmptyState, { props: { module: moduleById('listening') } });

        expect(screen.getByRole('link', { name: /Spotify.*24 hours/i })).toBeInTheDocument();
    });

    /** With one export there is no choice to explain, so a sentence names it. */
    it('names the one export to ask for in a sentence, with its wait', () => {
        render(ModuleEmptyState, { props: { module: moduleById('steps') } });

        const garmin = screen.getByRole('link', { name: 'Garmin Connect' });
        expect(garmin.getAttribute('href')).toMatch(/\/sources\/garmin$/);
        expect(screen.getByText(/It takes a few hours/i)).toBeInTheDocument();
        expect(document.querySelectorAll('.feeds li')).toHaveLength(0);
    });

    /** The screen stays a screen: no procedure, no archive specs. */
    it('stops short of the export procedure itself', () => {
        render(ModuleEmptyState, { props: { module: moduleById('steps') } });

        expect(screen.queryByText(/Data Management/)).toBeNull();
        expect(screen.queryByText(/gigabyte or two/i)).toBeNull();
    });
});
