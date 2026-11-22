import { render, screen, fireEvent } from '@testing-library/svelte';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import LandingPage from './+page.svelte';
import { dataStore } from '#lib/stores/dataStore.svelte.ts';

// The landing page as a phone sees it. The device is decided by a media query
// jsdom cannot answer, so the store is stood in for here.
const nav = vi.hoisted(() => ({
    url: new URL('http://localhost/'),
    goto: vi.fn(),
}));

const device = vi.hoisted(() => ({ showcase: true, exploreAnyway: vi.fn() }));

vi.mock('$app/state', () => ({
    page: {
        get url() {
            return nav.url;
        },
    },
}));

vi.mock('$app/navigation', () => ({
    goto: nav.goto,
}));

vi.mock('#lib/stores/deviceStore.svelte.ts', () => ({
    deviceStore: {
        get showcase() {
            return device.showcase;
        },
        get handheld() {
            return true;
        },
    },
    exploreAnyway: device.exploreAnyway,
}));

beforeEach(() => {
    nav.url = new URL('http://localhost/');
    nav.goto.mockClear();
    device.showcase = true;
    device.exploreAnyway.mockClear();
});

afterEach(() => {
    dataStore.reset();
});

describe('the landing page on a phone', () => {
    test('shows what Buho draws and hands the visit to a computer', () => {
        render(LandingPage);

        expect(screen.getByRole('heading', { name: /Made for a big screen/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Send me the link/i })).toBeInTheDocument();
        // Not the desktop door: no drop line, no screen on how it works.
        expect(screen.queryByText('Drop your export here')).not.toBeInTheDocument();
        expect(screen.queryByRole('heading', { name: 'How it works' })).not.toBeInTheDocument();
    });

    // The exports a phone can make itself come first: they are the ones a
    // visitor can finish in the same sitting.
    test('leads the export list with the ones made on the phone', () => {
        render(LandingPage);

        const rows = screen
            .getAllByRole('button')
            .filter((button) =>
                /Made on this phone|Ask now|Immediate/.test(button.textContent ?? '')
            );
        expect(rows[0]).toHaveTextContent(/WhatsApp|Google Timeline/);
        expect(rows[0]).toHaveTextContent(/Made on this phone/);
    });

    test('opens an export how-to from the list', async () => {
        render(LandingPage);

        const row = screen
            .getAllByRole('button')
            .find((button) => button.textContent?.includes('WhatsApp'));
        await fireEvent.click(row!);

        expect(nav.goto).toHaveBeenCalledWith('/?source=whatsapp', expect.anything());
    });

    test('lets whoever wants it have the desktop door', async () => {
        render(LandingPage);

        await fireEvent.click(screen.getByRole('button', { name: /Explore anyway/i }));

        expect(device.exploreAnyway).toHaveBeenCalled();
    });

    test('offers the drop step as a link to open on a computer', () => {
        nav.url = new URL('http://localhost/?source=spotify');
        render(LandingPage);

        expect(screen.getByRole('heading', { name: /Then, on a computer/i })).toBeInTheDocument();
    });

    test('keeps the desktop door once the phone treatment is lifted', () => {
        device.showcase = false;
        render(LandingPage);

        expect(
            screen.queryByRole('heading', { name: /Made for a big screen/i })
        ).not.toBeInTheDocument();
        expect(screen.getByText('Drop your export here')).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'How it works' })).toBeInTheDocument();
    });
});
