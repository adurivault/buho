import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/svelte';
import '@testing-library/jest-dom/vitest';
import GoogleMapsImportDialog from './GoogleMapsImportDialog.svelte';

function open() {
    const onClose = vi.fn();
    const onPickFile = vi.fn();
    render(GoogleMapsImportDialog, { props: { open: true, onClose, onPickFile } });
    return { onClose, onPickFile };
}

// The dialog is portalled into <body>, so it outlives the render container.
afterEach(cleanup);

describe('GoogleMapsImportDialog', () => {
    it('offers both entry points when opened', () => {
        open();
        expect(screen.getByText('I already have my Timeline file')).toBeInTheDocument();
        expect(screen.getByText('I need to export it from my phone')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
    });

    it('picks a file directly from the first step', async () => {
        const { onClose, onPickFile } = open();
        await fireEvent.click(screen.getByText('I already have my Timeline file'));
        expect(onPickFile).toHaveBeenCalledTimes(1);
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('shows the phone export steps and switches platform', async () => {
        open();
        await fireEvent.click(screen.getByText('I need to export it from my phone'));

        expect(screen.getByText(/no longer ships Timeline with Takeout/i)).toBeInTheDocument();
        expect(screen.getByText(/system settings, not the Google Maps app/i)).toBeInTheDocument();

        await fireEvent.click(screen.getByRole('tab', { name: 'iPhone' }));
        expect(screen.queryByText(/system settings, not the Google Maps app/i)).toBeNull();
        expect(screen.getByText(/Location & privacy settings/i)).toBeInTheDocument();
    });

    it('goes back to the first step from the instructions', async () => {
        open();
        await fireEvent.click(screen.getByText('I need to export it from my phone'));
        await fireEvent.click(screen.getByRole('button', { name: 'Back' }));
        expect(screen.getByText('I already have my Timeline file')).toBeInTheDocument();
    });

    it('picks a file from the instructions step', async () => {
        const { onClose, onPickFile } = open();
        await fireEvent.click(screen.getByText('I need to export it from my phone'));
        await fireEvent.click(screen.getByText('I already exported my file'));
        expect(onPickFile).toHaveBeenCalledTimes(1);
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('closes on Escape', async () => {
        const { onClose } = open();
        await fireEvent.keyDown(window, { key: 'Escape' });
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(screen.queryByRole('dialog')).toBeNull();
    });
});
