import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/svelte';
import '@testing-library/jest-dom/vitest';
import ImportDialog from './ImportDialog.svelte';
import { tick } from 'svelte';
import { dataStore } from '#lib/stores/dataStore.svelte.ts';
import { uiStore } from '#lib/stores/uiStore.svelte.ts';
import { CATALOG_SOURCES } from '#lib/data/sources/catalog.ts';
import type { LoadedSource } from '#lib/data/queries/inventory.ts';
import type { ModuleId } from '#lib/data/modules.ts';

function open(focus?: ModuleId) {
    const onClose = vi.fn();
    render(ImportDialog, { props: { open: true, onClose, focus } });
    return { onClose };
}

const source = (over: Partial<LoadedSource> & Pick<LoadedSource, 'id'>): LoadedSource => ({
    label: over.id,
    icon: 'spotify',
    holdings: [{ module: 'listening', rows: 12 }],
    rows: 12,
    ...over,
});

// The dialog is portalled into <body>, so it outlives the render container.
afterEach(cleanup);

describe('ImportDialog', () => {
    beforeEach(() => {
        dataStore.reset();
    });

    it('says the whole page is the drop zone, and still offers both pickers', () => {
        open();
        expect(screen.getByText(/anywhere on the page/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Choose files' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Choose a folder' })).toBeInTheDocument();
    });

    it('accepts every format Buho reads, from any page', () => {
        // One dialog for all five modules: narrowing `accept` per page is exactly
        // the cloisoning this replaced.
        const { container } = render(ImportDialog, {
            props: { open: true, onClose: vi.fn() },
        });
        const inputs = container.querySelectorAll('input[type="file"]');

        expect(inputs).toHaveLength(2);
        expect((inputs[0] as HTMLInputElement).accept).toBe('.json,.txt,.zip,.xlsx,.fit');
        expect((inputs[0] as HTMLInputElement).multiple).toBe(true);
        // Folder picking needs its own control: `webkitdirectory` turns the
        // native chooser into a directory-only one.
        expect(inputs[1].hasAttribute('webkitdirectory')).toBe(true);
    });

    it('keeps the export instructions collapsed until asked for', async () => {
        open();
        expect(screen.queryByRole('tablist')).toBeNull();

        await fireEvent.click(screen.getByText(/how do I get one/i));
        expect(screen.getByRole('tablist')).toBeInTheDocument();
    });

    it('offers a guide for every source in the catalog', async () => {
        open();
        await fireEvent.click(screen.getByText(/how do I get one/i));

        const tabs = screen.getAllByRole('tab');
        expect(tabs.map((tab) => tab.textContent?.trim())).toEqual(
            CATALOG_SOURCES.map((source) => source.label)
        );
    });

    it('preselects the guide for the page it was opened from', async () => {
        open('messages');
        await fireEvent.click(screen.getByText(/how do I get one/i));

        expect(screen.getByRole('tab', { name: 'Messenger' })).toHaveAttribute(
            'aria-selected',
            'true'
        );
        expect(
            screen.getByRole('link', { name: /Messenger secure-storage export/i })
        ).toBeInTheDocument();
    });

    it('switches to another service without leaving the dialog', async () => {
        open('listening');
        await fireEvent.click(screen.getByText(/how do I get one/i));
        await fireEvent.click(screen.getByRole('tab', { name: 'Deezer' }));

        expect(screen.getByRole('link', { name: /Deezer's personal data page/i })).toHaveAttribute(
            'href',
            'https://www.deezer.com/account/personal_data'
        );
    });

    it('splits the Timeline steps by phone', async () => {
        open('positions');
        await fireEvent.click(screen.getByText(/how do I get one/i));

        expect(screen.getByText(/system settings, not the Google Maps app/i)).toBeInTheDocument();

        await fireEvent.click(screen.getByRole('tab', { name: 'iPhone' }));
        expect(screen.queryByText(/system settings, not the Google Maps app/i)).toBeNull();
        expect(screen.getByText(/Location & privacy settings/i)).toBeInTheDocument();
    });

    it('lists what is loaded, with a way to take it back out', async () => {
        dataStore.inventory = [
            source({ id: 'spotify', label: 'Spotify' }),
            source({
                id: 'garmin',
                label: 'Garmin Connect',
                icon: 'garmin',
                holdings: [
                    { module: 'positions', rows: 400 },
                    { module: 'steps', rows: 12 },
                ],
            }),
        ];
        open();

        expect(screen.getByText("What's loaded")).toBeInTheDocument();
        // A Garmin export feeds two modules, and the list has to say so.
        expect(screen.getByText(/Positions · .+ — Steps · /)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Remove Garmin Connect' })).toBeInTheDocument();
    });

    it('asks twice before removing, since nothing here is persisted', async () => {
        const remove = vi.spyOn(dataStore, 'removeSource').mockImplementation(async () => {});
        dataStore.inventory = [source({ id: 'deezer', label: 'Deezer' })];
        open();

        await fireEvent.click(screen.getByRole('button', { name: 'Remove Deezer' }));
        expect(remove).not.toHaveBeenCalled();

        await fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
        expect(remove).toHaveBeenCalledWith('deezer');
    });

    it('says demo data goes on its own, and lists nothing to remove', () => {
        // The store keeps demo plays out of the inventory (they are not
        // something you imported), so there is nothing here to take back out —
        // just the warning that they're about to be cleared.
        dataStore.loadDemoData('listening');
        open();

        expect(
            screen.getByText(/cleared the moment your own music import lands/i)
        ).toBeInTheDocument();
        expect(screen.queryByText("What's loaded")).toBeNull();
    });

    /**
     * While it is up, the dialog owns drops: the window-wide overlay stands
     * down, so the dialog is not a dead rectangle over the page someone just
     * aimed a file at.
     */
    it('holds the window overlay back for as long as it is open', async () => {
        const { onClose } = open();
        await tick();
        expect(uiStore.modalOpen).toBe(true);

        await fireEvent.keyDown(window, { key: 'Escape' });
        await tick();
        expect(onClose).toHaveBeenCalled();
        expect(uiStore.modalOpen).toBe(false);
    });

    it('takes a drop itself, and only once', async () => {
        const handle = vi.spyOn(dataStore, 'handleImport').mockImplementation(async () => {});
        dataStore.inventory = [source({ id: 'spotify', label: 'Spotify' })];
        open();

        // Stands in for the window-wide overlay: if the event reaches here, the
        // same files get imported a second time.
        const reachedWindow = vi.fn();
        window.addEventListener('drop', reachedWindow);

        const zone = screen.getByText('Drop your export here').parentElement!;
        const drop = new Event('drop', { bubbles: true, cancelable: true });
        Object.defineProperty(drop, 'dataTransfer', {
            value: { types: ['Files'], items: [], files: [] },
        });
        zone.dispatchEvent(drop);
        await tick();

        expect(handle).toHaveBeenCalledTimes(1);
        expect(reachedWindow).not.toHaveBeenCalled();

        window.removeEventListener('drop', reachedWindow);
    });

    it('closes on Escape', async () => {
        const { onClose } = open();
        await fireEvent.keyDown(window, { key: 'Escape' });

        expect(onClose).toHaveBeenCalledTimes(1);
        expect(screen.queryByRole('dialog')).toBeNull();
    });
});
