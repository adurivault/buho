import { fireEvent, render, screen } from '@testing-library/svelte';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, test, vi } from 'vitest';
import DropZone from './DropZone.svelte';
import { dataStore } from '#lib/stores/dataStore.svelte.ts';

/**
 * A drop zone that looks like one and imports nothing is worse than no zone at
 * all: the page's last instruction points at it.
 */
describe('DropZone', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    function dropFiles(zone: HTMLElement, files: File[]) {
        const dataTransfer = {
            items: files.map((file) => ({ kind: 'file', getAsFile: () => file })),
            files,
        };
        return fireEvent.drop(zone, { dataTransfer });
    }

    test('a drop reaches the importer, tagged with where it happened', async () => {
        const handleImport = vi.spyOn(dataStore, 'handleImport').mockResolvedValue(undefined);
        const { container } = render(DropZone, {
            props: { surface: 'source-page', expected: 'lastfm' },
        });

        const zone = container.querySelector('.zone') as HTMLElement;
        await dropFiles(zone, [new File(['[]'], 'scrobbles.json')]);

        expect(handleImport).toHaveBeenCalledWith(expect.any(Function), {
            pick: 'drop',
            surface: 'source-page',
            expected: 'lastfm',
        });
    });

    test('the drop is stopped here, so the window handler cannot read it twice', async () => {
        vi.spyOn(dataStore, 'handleImport').mockResolvedValue(undefined);
        const { container } = render(DropZone, { props: { surface: 'source-page' } });

        const onWindowDrop = vi.fn();
        window.addEventListener('drop', onWindowDrop);

        const zone = container.querySelector('.zone') as HTMLElement;
        await dropFiles(zone, [new File(['[]'], 'scrobbles.json')]);

        window.removeEventListener('drop', onWindowDrop);
        expect(onWindowDrop).not.toHaveBeenCalled();
    });

    test('the pickers are there for anyone who would rather not drag', () => {
        render(DropZone, { props: { surface: 'dialog' } });

        expect(screen.getByRole('button', { name: 'Choose files' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Choose a folder' })).toBeInTheDocument();
    });
});
