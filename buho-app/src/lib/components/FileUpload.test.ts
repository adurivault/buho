
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import FileUpload from './FileUpload.svelte';
import { dataStore } from '$lib/stores/dataStore.svelte';

vi.mock('$lib/data/db', () => ({
    initDuckDB: vi.fn(),
    dropTable: vi.fn(),
    insertSpotifyPlays: vi.fn()
}));

describe('FileUpload', () => {
    beforeEach(() => {
        dataStore.reset();
    });

    it('should render upload button in demo mode', () => {
        dataStore.loadDemoData();
        render(FileUpload);
        expect(screen.getByText('Explore my personal data')).toBeTruthy();
    });

    it('should open the import dialog with both options when clicking the button', async () => {
        dataStore.loadDemoData();
        render(FileUpload);

        await fireEvent.click(screen.getByText('Explore my personal data'));

        expect(screen.getByText('I already have my file')).toBeTruthy();
        expect(screen.getByText('I need to download it from Spotify')).toBeTruthy();
    });

    it('should show download instructions with a Spotify link', async () => {
        dataStore.loadDemoData();
        render(FileUpload);

        await fireEvent.click(screen.getByText('Explore my personal data'));
        await fireEvent.click(screen.getByText('I need to download it from Spotify'));

        expect(screen.getByText(/Extended streaming history/i)).toBeTruthy();
        const link = screen.getByRole('link', { name: /Open Spotify privacy settings/i });
        expect(link).toHaveAttribute('href', 'https://www.spotify.com/account/privacy/');
    });

    it('should show demo chip when in demo mode', async () => {
        dataStore.loadDemoData();
        render(FileUpload);
        expect(screen.getByText('Demo data')).toBeTruthy();
    });

    it('should NOT show demo chip when NOT in demo mode', () => {
        dataStore.loadUserData('spotify');
        render(FileUpload);
        expect(screen.queryByText('Demo data')).toBeNull();
        expect(screen.getByText('Your data')).toBeTruthy();
    });

    it('should show loading message when loading', () => {
        dataStore.setLoading({ status: 'reading', message: 'Reading file test...' });
        render(FileUpload);
        expect(screen.getByText('Reading file test...')).toBeTruthy();
    });

    it('should show error message and link', () => {
        dataStore.setError({ message: 'Test error', link: '/test-link' });
        render(FileUpload);
        expect(screen.getByText(/Test error/i)).toBeTruthy();
        const link = screen.getByRole('link', { name: /help/i }); // Assuming link text is "help" or similar, or just find by href
        expect(link).toHaveAttribute('href', '/test-link');
    });

    it('should show "Switch to Demo Data" button when in user mode', async () => {
        dataStore.loadUserData('spotify');
        render(FileUpload);
        const switchBtn = screen.getByText(/Switch to Demo Data/i);
        expect(switchBtn).toBeTruthy();

        await fireEvent.click(switchBtn);
        expect(dataStore.isDemo).toBe(true);
    });

    it('should trigger store upload on file selection', async () => {
        const handleSpy = vi.spyOn(dataStore, 'handleFilesUpload').mockImplementation(async () => { });
        const { container } = render(FileUpload);

        // Find hidden input
        const input = container.querySelector('input[type="file"]') as HTMLInputElement;
        expect(input).toBeTruthy();
        expect(input.accept).toBe('.json,.zip');
        expect(input.multiple).toBe(true);

        const file = new File(['[]'], 'test.json', { type: 'application/json' });
        const fileList = Object.assign([file], { item: (i: number) => [file][i] }) as unknown as FileList;
        await fireEvent.change(input, { target: { files: fileList } });

        expect(handleSpy).toHaveBeenCalledWith(expect.any(Object));
    });
});

