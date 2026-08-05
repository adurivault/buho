import { render, screen, fireEvent } from '@testing-library/svelte';
import '@testing-library/jest-dom/vitest';
import { describe, expect, test, vi } from 'vitest';
import MessagesImportDialog from './MessagesImportDialog.svelte';

vi.mock('$lib/analytics', () => ({ trackEvent: vi.fn() }));

function open() {
    return render(MessagesImportDialog, {
        props: {
            open: true,
            onClose: vi.fn(),
            onPickFile: vi.fn(),
            onPickFolder: vi.fn(),
            onDropEntries: vi.fn().mockResolvedValue(undefined),
        },
    });
}

describe('MessagesImportDialog', () => {
    test('opens on the drop zone, with no step to navigate', () => {
        open();

        expect(screen.getByText('Drop your export here')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Choose files' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Choose a folder' })).toBeInTheDocument();
        // No back button: there is nowhere to go back to.
        expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument();
    });

    test('keeps the how-to collapsed until asked', () => {
        open();

        expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
        expect(
            screen.getByRole('button', { name: /I don't have my export yet — how do I get one?/ }),
        ).toHaveAttribute('aria-expanded', 'false');
    });

    test('shows one service at a time, without hiding the drop zone', async () => {
        open();

        await fireEvent.click(screen.getByRole('button', { name: /I don't have my export yet — how do I get one?/ }));

        // The instructions expand in place — the whole point of not using a step.
        expect(screen.getByText('Drop your export here')).toBeInTheDocument();

        const tabs = screen.getAllByRole('tab');
        expect(tabs.map((t) => t.textContent?.trim())).toEqual([
            'Messenger',
            'Instagram',
            'WhatsApp',
        ]);
        expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
        expect(screen.getByText(/Meta's Accounts Center\. This link opens/)).toBeVisible();
    });

    test('reserves the height of the tallest guide so the dialog never jumps', async () => {
        open();
        await fireEvent.click(screen.getByRole('button', { name: /I don't have my export yet — how do I get one?/ }));

        // Every guide stays in the layout; only one is visible at a time. That is
        // what keeps the panel a constant height across clicks.
        const panels = document.querySelectorAll('.guide-panel');
        expect(panels).toHaveLength(3);
        const visible = [...panels].filter(
            (p) => (p as HTMLElement).style.visibility === 'visible',
        );
        expect(visible).toHaveLength(1);
    });

    test('swaps the steps when another service is picked', async () => {
        open();

        await fireEvent.click(screen.getByRole('button', { name: /I don't have my export yet — how do I get one?/ }));
        await fireEvent.click(screen.getByRole('tab', { name: 'WhatsApp' }));

        expect(screen.getByRole('tab', { name: 'WhatsApp' })).toHaveAttribute(
            'aria-selected',
            'true',
        );
        expect(screen.getByText(/WhatsApp has no bulk export/)).toBeVisible();
        // Messenger's instructions are hidden, not stacked underneath — they keep
        // their space so the dialog stays put.
        expect(screen.getByText(/Meta's Accounts Center\. This link opens/)).not.toBeVisible();
    });

    test('labels each service with its own glyph', async () => {
        open();
        await fireEvent.click(screen.getByRole('button', { name: /I don't have my export yet — how do I get one?/ }));

        for (const tab of screen.getAllByRole('tab')) {
            expect(tab.querySelector('svg')).toBeTruthy();
        }
    });

    test('links straight into each export form, in a new tab', async () => {
        open();
        await fireEvent.click(
            screen.getByRole('button', { name: /I don't have my export yet/ }),
        );

        const facebook = screen.getByRole('link', { name: /Open Facebook's export page/ });
        expect(facebook).toHaveAttribute(
            'href',
            'https://accountscenter.facebook.com/info_and_permissions/dyi',
        );
        expect(facebook).toHaveAttribute('target', '_blank');
        expect(facebook).toHaveAttribute('rel', 'noreferrer');

        // Instagram's panel is hidden, so its link is out of the accessibility
        // tree and unreachable by role — which is exactly what should happen.
        // It is still in the DOM, ready for when its tab is picked.
        expect(
            document.querySelector(
                'a[href="https://accountscenter.instagram.com/info_and_permissions/dyi/?theme=dark"]',
            ),
        ).toBeTruthy();
    });

    test('keeps hidden guides out of the tab order', async () => {
        open();
        await fireEvent.click(
            screen.getByRole('button', { name: /I don't have my export yet/ }),
        );

        // Messenger is the open tab, so only its link is reachable by keyboard.
        expect(
            screen.getByRole('link', { name: /Open Facebook's export page/ }),
        ).toHaveAttribute('tabindex', '0');
        expect(
            document.querySelector('a[href*="accountscenter.instagram.com"]'),
        ).toHaveAttribute('tabindex', '-1');
    });

    test('spells out the settings that decide whether the export is usable', async () => {
        open();
        await fireEvent.click(
            screen.getByRole('button', { name: /I don't have my export yet/ }),
        );

        expect(screen.getAllByText('JSON')[0]).toBeVisible();
        expect(screen.getAllByText('All time')[0]).toBeVisible();
        expect(screen.getAllByText(/download all of them/)[0]).toBeVisible();
    });

    test('points at the secure-storage export, which the standard one omits', async () => {
        open();
        await fireEvent.click(
            screen.getByRole('button', { name: /I don't have my export yet/ }),
        );

        // Since Meta encrypted most 1:1 chats, the standard download stops at the
        // switchover date — without this second link, recent messages are missing
        // and nothing says why.
        const secure = screen.getByRole('link', { name: /Open the secure-storage export/ });
        expect(secure).toHaveAttribute('href', 'https://www.messenger.com/secure_storage/dyi');
        expect(screen.getByText(/end-to-end encryption for most one-to-one chats/)).toBeVisible();
    });

    test('hides the replace option until something is imported', () => {
        open();
        expect(screen.queryByLabelText(/Replace everything/)).not.toBeInTheDocument();
    });
});
