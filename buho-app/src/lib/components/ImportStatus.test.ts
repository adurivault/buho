import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import '@testing-library/jest-dom/vitest';
import ImportStatus from './ImportStatus.svelte';
import { dataStore } from '#lib/stores/dataStore.svelte.ts';

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

    /**
     * A failed drop is a dead end carrying the longest message in the app, and
     * it used to be a thin strip above a page the reader was still aiming files
     * at. It interrupts now.
     */
    it('raises a failed import as a dialog, with a way to report it', async () => {
        dataStore.setError({ message: 'Test error', link: '/test-link' });
        render(ImportStatus);

        const dialog = await screen.findByRole('dialog', { name: 'Import failed' });
        expect(dialog).toBeInTheDocument();
        expect(screen.getByText(/Test error/i)).toBeTruthy();
        expect(screen.getByRole('link', { name: /help/i })).toHaveAttribute('href', '/test-link');
        expect(screen.getByRole('link', { name: 'Common fixes' })).toHaveAttribute(
            'href',
            '/faq#wont-read-my-file'
        );
        expect(screen.getByText('feedback.buho@gmail.com')).toHaveAttribute(
            'href',
            expect.stringContaining('mailto:feedback.buho@gmail.com')
        );
    });

    it('clears the failure once dismissed, so it cannot come back on its own', async () => {
        dataStore.setError({ message: 'Test error' });
        render(ImportStatus);

        await screen.findByRole('dialog', { name: 'Import failed' });
        await fireEvent.click(screen.getByRole('button', { name: 'Close' }));

        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(dataStore.error).toBeNull();
    });

    it('shows the background geo enrichment on its own row', () => {
        dataStore.geo = {
            status: 'running',
            message: 'Locating points... 20,000 / 90,000',
            progress: 0.22,
        };
        render(ImportStatus);
        expect(screen.getByText('Locating points... 20,000 / 90,000')).toBeTruthy();
        expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '22');
    });

    it('drops the enrichment row once it is done', () => {
        dataStore.geo = { status: 'done', message: 'Location details ready', progress: 1 };
        const { container } = render(ImportStatus);
        expect(container.textContent?.trim()).toBe('');
    });

    it('renders nothing when idle', () => {
        const { container } = render(ImportStatus);
        expect(container.textContent?.trim()).toBe('');
    });

    /**
     * A drop can now fill a module you aren't looking at, which would otherwise
     * look like nothing happened — the sidebar icon lighting up is too easy to
     * miss.
     */
    it('says what landed and where to go and see it', () => {
        dataStore.lastImport = {
            modules: [
                { module: 'positions', rows: 128610, services: ['google-timeline'] },
                { module: 'steps', rows: 9169, services: ['garmin'] },
            ],
            unrecognisedFiles: 0,
        };
        render(ImportStatus);

        // Locale-independent: the link is addressed by module name, not by digits.
        expect(screen.getByRole('link', { name: /Positions/ })).toHaveAttribute(
            'href',
            '/positions/explore'
        );
        expect(screen.getByRole('link', { name: /Steps/ })).toHaveAttribute(
            'href',
            '/steps/explore'
        );
        expect(screen.getByText(/from Google Timeline/)).toBeInTheDocument();
    });

    it('accounts for the files it made nothing of', () => {
        dataStore.lastImport = {
            modules: [{ module: 'listening', rows: 2, services: ['spotify'] }],
            unrecognisedFiles: 3,
        };
        render(ImportStatus);

        expect(screen.getByText(/in no format Buho reads/)).toBeInTheDocument();
    });

    it('can be dismissed', async () => {
        dataStore.lastImport = {
            modules: [{ module: 'listening', rows: 2, services: ['spotify'] }],
            unrecognisedFiles: 0,
        };
        render(ImportStatus);

        await fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
        expect(screen.queryByRole('link', { name: /Listening/ })).toBeNull();
    });

    describe('on its own', () => {
        beforeEach(() => vi.useFakeTimers());
        afterEach(() => vi.useRealTimers());

        const report = () => ({
            modules: [{ module: 'listening' as const, rows: 2, services: ['spotify'] }],
            unrecognisedFiles: 0,
        });
        const bar = () => screen.queryByRole('link', { name: /Listening/ });

        it('goes after a few seconds', async () => {
            dataStore.lastImport = report();
            render(ImportStatus);
            expect(bar()).toBeInTheDocument();

            await vi.advanceTimersByTimeAsync(6000);
            await vi.runAllTimersAsync();
            expect(bar()).toBeNull();
        });

        it('stays while it is being read, and lingers once it no longer is', async () => {
            dataStore.lastImport = report();
            render(ImportStatus);

            await fireEvent.pointerEnter(screen.getByRole('status'));
            await vi.advanceTimersByTimeAsync(20000);
            expect(bar()).toBeInTheDocument();

            await fireEvent.pointerLeave(screen.getByRole('status'));
            await vi.advanceTimersByTimeAsync(1000);
            expect(bar()).toBeInTheDocument();
            await vi.advanceTimersByTimeAsync(2000);
            await vi.runAllTimersAsync();
            expect(bar()).toBeNull();
        });

        it('does not come back on the next page once gone', async () => {
            dataStore.lastImport = report();
            const first = render(ImportStatus);
            await vi.advanceTimersByTimeAsync(6000);
            await vi.runAllTimersAsync();
            first.unmount();

            // Every layout mounts its own copy.
            render(ImportStatus);
            expect(bar()).toBeNull();
        });
    });
});
