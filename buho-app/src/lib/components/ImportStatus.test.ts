import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import '@testing-library/jest-dom/vitest';
import ImportStatus from './ImportStatus.svelte';
import { dataStore } from '$lib/stores/dataStore.svelte';

describe('ImportStatus', () => {
    beforeEach(() => {
        dataStore.reset();
    });

    it('shows the loading message with a progress bar', () => {
        dataStore.setLoading({ status: 'reading', message: 'Reading file test...' });
        render(ImportStatus);
        expect(screen.getByText('Reading file test...')).toBeTruthy();
        expect(screen.getByRole('progressbar')).toBeTruthy();
    });

    it('shows the error message and help link', () => {
        dataStore.setError({ message: 'Test error', link: '/test-link' });
        render(ImportStatus);
        expect(screen.getByText(/Test error/i)).toBeTruthy();
        const link = screen.getByRole('link', { name: /help/i });
        expect(link).toHaveAttribute('href', '/test-link');
    });

    it('renders nothing when idle', () => {
        const { container } = render(ImportStatus);
        expect(container.textContent?.trim()).toBe('');
    });
});
