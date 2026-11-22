import { render, screen, fireEvent } from '@testing-library/svelte';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import LandingPage from './+page.svelte';
import { CATALOG_SOURCES } from '#lib/data/sources/catalog.ts';
import { funnelLabel } from '#lib/onboarding/funnel.ts';
import { dataStore } from '#lib/stores/dataStore.svelte.ts';

// The funnel reads its step off the URL, so the URL has to be settable per test.
const nav = vi.hoisted(() => ({
    url: new URL('http://localhost/'),
    goto: vi.fn(),
}));

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

beforeEach(() => {
    nav.url = new URL('http://localhost/');
    nav.goto.mockClear();
});

afterEach(() => {
    dataStore.reset();
});

describe('the intro', () => {
    // The complaint that produced it: the picker, arrived at cold, was every
    // service at once and no answer to "what is this?".
    //
    // All three steps are asserted as text, not as animation state. The diagram
    // is decorative and the captions are the content — which is also why it
    // still reads with motion switched off, or before any script has run.
    test('is what a bare landing page shows', () => {
        render(LandingPage);

        expect(screen.getByText(/Request your data/i)).toBeInTheDocument();
        expect(screen.getByText(/Open it in Buho/i)).toBeInTheDocument();
        expect(screen.getByText(/^Explore$/)).toBeInTheDocument();
    });

    /**
     * A neutral "Start" led straight into a decision a first-time visitor is
     * not equipped to make. The door makes it instead: one button that does the
     * thing, one that says there is more than that, and a line explaining why
     * one service is singled out.
     */
    test('offers the fast path and the long way, and nothing else', () => {
        render(LandingPage);

        // The two doors and the skip link. Three buttons, no menu.
        expect(screen.getAllByRole('button')).toHaveLength(3);
        expect(
            screen.getByRole('button', { name: /Quick start with WhatsApp/i })
        ).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Explore other services/i })).toBeInTheDocument();
        expect(screen.getByText(/about two minutes/i)).toBeInTheDocument();
    });

    /**
     * The list of every service Buho reads used to sit under the button, so a
     * Spotify user would not read the funnel as "not supported". It was still a
     * menu at the one moment nobody wants one; the second door and the footer
     * link carry that job now.
     */
    test('does not lay out the whole catalog', () => {
        render(LandingPage);

        expect(screen.queryByText(/^Reads exports from/)).not.toBeInTheDocument();
        for (const source of CATALOG_SOURCES) {
            if (source.id === 'whatsapp') continue;
            expect(screen.queryByText(funnelLabel(source))).not.toBeInTheDocument();
        }
    });

    test('the fast path skips the picker entirely', async () => {
        render(LandingPage);

        await fireEvent.click(screen.getByRole('button', { name: /Quick start with WhatsApp/i }));

        expect(nav.goto).toHaveBeenCalledWith('/?source=whatsapp', expect.anything());
    });

    test('the other door is the picker', async () => {
        render(LandingPage);

        await fireEvent.click(screen.getByRole('button', { name: /Explore other services/i }));

        expect(nav.goto).toHaveBeenCalledWith('/?step=pick', expect.anything());
    });

    test('lets anyone who already has a file skip the whole thing', async () => {
        render(LandingPage);

        await fireEvent.click(screen.getByRole('button', { name: /I already have an export/i }));

        expect(nav.goto).toHaveBeenCalledWith('/?step=drop', expect.anything());
    });
});

describe('step one — picking a source', () => {
    const pickUrl = 'http://localhost/?step=pick';

    const buttonsWith = (className: string) =>
        screen.getAllByRole('button').filter((button) => button.classList.contains(className));

    /**
     * One recommendation, not a tier. Three equal cards made the visitor pick
     * between three things they knew nothing about; the useful fact is which
     * single export costs nothing to try, and why.
     */
    test('leads with WhatsApp alone, and says why', () => {
        nav.url = new URL(pickUrl);
        render(LandingPage);

        const leads = buttonsWith('lead');

        expect(leads).toHaveLength(1);
        expect(leads[0]).toHaveTextContent('WhatsApp');
        expect(leads[0]).toHaveTextContent(/two minutes/i);
    });

    /**
     * Offering only the instant exports read as "your service is not supported"
     * to anyone who arrived for Spotify — the funnel was hiding a wait they had
     * never been told about and might not have minded. Everything is pickable;
     * the slower ones just carry their own answer to "how long?".
     */
    test('offers every other export too, and says what the wait is', () => {
        nav.url = new URL(pickUrl);
        render(LandingPage);

        const rows = buttonsWith('row');
        expect(rows).toHaveLength(CATALOG_SOURCES.length - 1);

        const spotify = rows.find((row) => row.textContent?.includes('Spotify'));
        expect(spotify).toBeDefined();
        expect(spotify).toHaveTextContent(/around 24 hours/i);

        expect(screen.getByRole('link', { name: /what each export contains/i })).toHaveAttribute(
            'href',
            '/sources'
        );
    });

    test('a slow export is a choice, not just a mention', async () => {
        nav.url = new URL(pickUrl);
        render(LandingPage);

        const spotify = buttonsWith('row').find((row) => row.textContent?.includes('Spotify'));
        await fireEvent.click(spotify!);

        expect(nav.goto).toHaveBeenCalledWith('/?source=spotify', expect.anything());
    });

    test('picking a source moves to that export step', async () => {
        nav.url = new URL(pickUrl);
        render(LandingPage);

        await fireEvent.click(buttonsWith('lead')[0]);

        expect(nav.goto).toHaveBeenCalledWith('/?source=whatsapp', expect.anything());
    });

    test('the shortcut jumps straight to the drop step', async () => {
        nav.url = new URL(pickUrl);
        render(LandingPage);

        await fireEvent.click(screen.getByRole('button', { name: /I already have my export/i }));

        expect(nav.goto).toHaveBeenCalledWith('/?step=drop', expect.anything());
    });
});

describe('step two — getting the export', () => {
    test('shows the how-to for the source named in the URL', () => {
        nav.url = new URL('http://localhost/?source=whatsapp');
        render(LandingPage);

        expect(
            screen.getByRole('heading', { name: /Get your WhatsApp export/i })
        ).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /I have the file/i })).toBeInTheDocument();
    });

    test('moving on to the drop keeps the source in the URL', async () => {
        nav.url = new URL('http://localhost/?source=whatsapp');
        render(LandingPage);

        await fireEvent.click(screen.getByRole('button', { name: /I have the file/i }));

        expect(nav.goto).toHaveBeenCalledWith('/?step=drop&source=whatsapp', expect.anything());
    });

    test('links on to the full reference for that export', () => {
        nav.url = new URL('http://localhost/?source=whatsapp');
        render(LandingPage);

        const link = screen.getByRole('link', { name: /Everything about the WhatsApp export/i });
        expect(link).toHaveAttribute('href', '/sources/whatsapp');
    });

    // A query string is public surface: people truncate it, chat apps mangle it.
    test('falls back to the intro for an export Buho has never heard of', () => {
        nav.url = new URL('http://localhost/?source=myspace');
        render(LandingPage);

        expect(
            screen.getByRole('button', { name: /Quick start with WhatsApp/i })
        ).toBeInTheDocument();
    });
});

describe('step three — dropping the file', () => {
    test('is reachable straight from a link', () => {
        nav.url = new URL('http://localhost/?step=drop');
        render(LandingPage);

        expect(screen.getByText('Drop your export here')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Choose files' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Choose a folder' })).toBeInTheDocument();
    });

    test('says the files are never uploaded', () => {
        nav.url = new URL('http://localhost/?step=drop');
        render(LandingPage);

        expect(screen.getByText(/None of it is uploaded/i)).toBeInTheDocument();
    });

    test('arriving from a how-to keeps naming that export', () => {
        nav.url = new URL('http://localhost/?step=drop&source=whatsapp');
        render(LandingPage);

        expect(
            screen.getByRole('heading', { name: /Drop your WhatsApp export in/i })
        ).toBeInTheDocument();
    });

    test('the rail leads back to the how-to you came through', async () => {
        nav.url = new URL('http://localhost/?step=drop&source=whatsapp');
        render(LandingPage);

        await fireEvent.click(screen.getByRole('button', { name: /Get the file/i }));

        expect(nav.goto).toHaveBeenCalledWith('/?source=whatsapp', expect.anything());
    });

    // Nothing to go back to but the choice itself, for anyone who skipped here.
    test('the rail leads back to the picker when no source was chosen', async () => {
        nav.url = new URL('http://localhost/?step=drop');
        render(LandingPage);

        await fireEvent.click(screen.getByRole('button', { name: /Get the file/i }));

        expect(nav.goto).toHaveBeenCalledWith('/?step=pick', expect.anything());
    });
});

describe('once something is imported', () => {
    test('the funnel gives way to the loaded data', async () => {
        dataStore.inventory = [
            {
                id: 'whatsapp',
                label: 'WhatsApp',
                icon: 'message',
                holdings: [{ module: 'messages', rows: 1234 }],
                rows: 1234,
            },
        ];
        render(LandingPage);

        expect(screen.getByRole('heading', { name: /Your data is in/i })).toBeInTheDocument();
        expect(
            screen.queryByRole('button', { name: /Quick start with WhatsApp/i })
        ).not.toBeInTheDocument();

        const link = screen.getByRole('link', { name: /Messages/ });
        expect(link).toHaveAttribute('href', '/messages/explore');
    });

    // `loaded.listening` is set by the demo too, and somebody who has only seen
    // the sample still needs the funnel.
    test('the demo alone does not count as having imported anything', () => {
        dataStore.loadDemoData('listening');
        render(LandingPage);

        expect(
            screen.getByRole('button', { name: /Quick start with WhatsApp/i })
        ).toBeInTheDocument();
    });
});
