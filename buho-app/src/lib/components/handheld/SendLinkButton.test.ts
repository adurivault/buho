import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, test, vi } from 'vitest';
import SendLinkButton from './SendLinkButton.svelte';

vi.mock('$app/state', () => ({
    page: { url: new URL('http://localhost/?source=whatsapp') },
}));

afterEach(() => {
    Reflect.deleteProperty(navigator, 'share');
    Reflect.deleteProperty(navigator, 'clipboard');
});

describe('SendLinkButton', () => {
    test('hands the page you are on to the share sheet', async () => {
        const share = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, 'share', { value: share, configurable: true });

        render(SendLinkButton, { props: { surface: 'test' } });
        await fireEvent.click(screen.getByRole('button', { name: /Send me the link/i }));

        await waitFor(() =>
            expect(share).toHaveBeenCalledWith(
                expect.objectContaining({ url: 'http://localhost/?source=whatsapp' })
            )
        );
    });

    test('says so when the link went to the clipboard instead', async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

        render(SendLinkButton, { props: { surface: 'test', url: 'https://buho-app.com/' } });
        await fireEvent.click(screen.getByRole('button', { name: /Send me the link/i }));

        expect(await screen.findByText(/Link copied/i)).toBeInTheDocument();
        expect(writeText).toHaveBeenCalledWith('https://buho-app.com/');
    });
});
