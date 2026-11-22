import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/svelte';
import '@testing-library/jest-dom/vitest';
import { tick } from 'svelte';
import DropOverlay from './DropOverlay.svelte';
import { dataStore } from '#lib/stores/dataStore.svelte.ts';
import { openModal, closeModal } from '#lib/stores/uiStore.svelte.ts';

/**
 * jsdom has no real DragEvent, and `dataTransfer` is the only part that matters
 * here: the overlay decides on `types`, and hands `items`/`files` straight to
 * `collectDrop`.
 */
async function fireDrag(type: string, types: string[] = ['Files']) {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'dataTransfer', {
        value: { types, items: [], files: [] },
    });
    window.dispatchEvent(event);
    await tick();
    return event;
}

/**
 * A drop landing in a zone that handles it itself — the import dialog, the
 * onboarding step — which stops the event before the window's own handler.
 */
async function dropIntoOwnZone() {
    const event = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'dataTransfer', {
        value: { types: ['Files'], items: [], files: [] },
    });
    const stop = (e: Event) => e.stopPropagation();
    document.body.addEventListener('drop', stop);
    document.body.dispatchEvent(event);
    document.body.removeEventListener('drop', stop);
    await tick();
}

const overlay = () => screen.queryByText('Drop it anywhere');

describe('DropOverlay', () => {
    beforeEach(() => {
        dataStore.reset();
    });

    afterEach(() => {
        cleanup();
        vi.restoreAllMocks();
    });

    it('stays out of the way until a file is dragged in', async () => {
        render(DropOverlay);
        expect(overlay()).toBeNull();

        await fireDrag('dragenter');
        expect(overlay()).toBeInTheDocument();
    });

    it('ignores a drag carrying anything but files', async () => {
        // Dragging selected text, or a brush handle inside a chart, must leave
        // the page alone.
        render(DropOverlay);
        await fireDrag('dragenter', ['text/plain']);

        expect(overlay()).toBeNull();
    });

    it('stays up while the pointer crosses between elements', async () => {
        // `dragleave` fires on every child boundary crossed, so a plain boolean
        // would flicker off halfway across the page.
        render(DropOverlay);
        await fireDrag('dragenter');
        await fireDrag('dragenter');
        await fireDrag('dragleave');

        expect(overlay()).toBeInTheDocument();

        await fireDrag('dragleave');
        await Promise.resolve();
        expect(overlay()).toBeNull();
    });

    it('takes the drop itself, so the browser does not open the file', async () => {
        render(DropOverlay);
        await fireDrag('dragenter');

        const dragover = await fireDrag('dragover');
        const drop = await fireDrag('drop');

        expect(dragover.defaultPrevented).toBe(true);
        expect(drop.defaultPrevented).toBe(true);
    });

    it('hands one drop to the store exactly once', async () => {
        const handle = vi.spyOn(dataStore, 'handleImport').mockImplementation(async () => {});
        render(DropOverlay);

        await fireDrag('dragenter');
        await fireDrag('drop');
        await Promise.resolve();

        expect(handle).toHaveBeenCalledTimes(1);
        expect(overlay()).toBeNull();
    });

    it('does not offer itself while an import is already running', async () => {
        dataStore.setLoading({ status: 'importing', message: 'Importing...' });
        render(DropOverlay);
        await fireDrag('dragenter');

        expect(overlay()).toBeNull();
    });

    it('stands down while a modal is up, and leaves the drop to it', async () => {
        // A full-screen panel painting over the dialog you just opened is the
        // app talking over itself — and the dialog's own zone takes the drop,
        // so nothing is lost by standing down.
        const handle = vi.spyOn(dataStore, 'handleImport').mockImplementation(async () => {});
        render(DropOverlay);
        openModal();

        await fireDrag('dragenter');
        expect(overlay()).toBeNull();

        await fireDrag('drop');
        expect(handle).not.toHaveBeenCalled();

        closeModal();
    });

    it('still swallows a drop it declines, so the browser keeps the page', async () => {
        // Without preventDefault the browser's own default wins and navigates
        // away to the dropped file, losing everything already imported.
        render(DropOverlay);
        openModal();

        const drop = await fireDrag('drop');
        expect(drop.defaultPrevented).toBe(true);

        closeModal();
    });

    it('lets go of a drag whose drop was taken by a zone of its own', async () => {
        // The dialog and the onboarding step stop the drop before the window
        // sees it. Nothing else would then answer the enters counted on the way
        // in, and the overlay would come back by itself once the import ends.
        render(DropOverlay);
        await fireDrag('dragenter');
        await dropIntoOwnZone();

        expect(overlay()).toBeNull();
    });

    it('does not resurface once an import that stood it down finishes', async () => {
        // The reported bug: drop into the dialog, wait for the import, and the
        // overlay reappears over the page with no drag left to dismiss it.
        render(DropOverlay);
        openModal();
        await fireDrag('dragenter');

        await dropIntoOwnZone();
        closeModal();

        dataStore.setLoading({ status: 'importing', message: 'Importing...' });
        await tick();
        expect(overlay()).toBeNull();

        dataStore.setLoading(null);
        await tick();
        expect(overlay()).toBeNull();
    });

    it('comes back once the modal closes', async () => {
        render(DropOverlay);
        openModal();
        closeModal();

        await fireDrag('dragenter');
        expect(overlay()).toBeInTheDocument();
    });
});
