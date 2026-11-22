import { render, screen, fireEvent } from '@testing-library/svelte';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import LandingPage from './+page.svelte';
import { CATALOG_SOURCES } from '#lib/data/sources/catalog.ts';
import { DATA_MODULES } from '#lib/data/modules.ts';
import { MODULE_SHOTS } from '#lib/shots.ts';
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
     * not equipped to make. The door makes it instead: one card that does the
     * thing, one that says there is more than that, and a drop line for whoever
     * already has the file.
     */
    test('offers the fast path, the long way and a drop line, and nothing else', () => {
        render(LandingPage);

        expect(
            screen
                .getAllByRole('button')
                .map((button) => button.getAttribute('aria-label') ?? button.textContent?.trim())
        ).toEqual([
            expect.stringMatching(/^Start with WhatsApp/),
            expect.stringMatching(/^Another service/),
            'Choose files',
            'Choose a folder',
        ]);
        expect(screen.getByText(/about two minutes/i)).toBeInTheDocument();
        expect(screen.getAllByText('Already have an export?')[0]).toBeInTheDocument();
    });

    /**
     * The list of every service Buho reads used to sit under the button, so a
     * Spotify user would not read the funnel as "not supported". It was still a
     * menu at the one moment nobody wants one. The services appear only as
     * what fills each module, under its picture; choosing one is the second
     * door's job.
     */
    test('names the exports as what fills each module, never as a choice', () => {
        render(LandingPage);

        expect(screen.queryByText(/^Reads exports from/)).not.toBeInTheDocument();
        const controls = [...screen.getAllByRole('button'), ...screen.getAllByRole('link')];
        for (const source of CATALOG_SOURCES) {
            if (source.id === 'whatsapp') continue;
            const name = funnelLabel(source);
            expect(controls.some((control) => control.textContent?.trim() === name)).toBe(false);
        }
    });

    /** What an export becomes, before there is one: each module, as the demo draws it. */
    test('shows the six modules, each opening its own page', () => {
        render(LandingPage);

        for (const module of DATA_MODULES) {
            const link = screen.getByRole('link', { name: new RegExp(`^${module.label}`) });
            expect(link.getAttribute('href')).toBe(`/${module.href}`);
            const file = MODULE_SHOTS[module.id].page.file;
            expect(link.querySelector(`img[src$="shots/${file}-light.webp"]`)).not.toBeNull();
        }
        expect(screen.getByRole('link', { name: /^Steps\s*Garmin Connect$/ })).toBeInTheDocument();
    });

    test('keeps how it works for further down', () => {
        render(LandingPage);

        expect(screen.getByRole('heading', { name: 'How it works' })).toBeInTheDocument();
    });

    test('the fast path skips the picker entirely', async () => {
        render(LandingPage);

        await fireEvent.click(screen.getByRole('button', { name: /Start with WhatsApp/i }));

        expect(nav.goto).toHaveBeenCalledWith('/?source=whatsapp', expect.anything());
    });

    test('the other door is the picker', async () => {
        render(LandingPage);

        await fireEvent.click(screen.getByRole('button', { name: /Another service/i }));

        expect(nav.goto).toHaveBeenCalledWith('/?step=pick', expect.anything());
    });

    test('takes a file dropped on the door, without a detour through the funnel', async () => {
        const handleImport = vi.spyOn(dataStore, 'handleImport').mockResolvedValue(undefined);
        const { container } = render(LandingPage);

        const file = new File(['{}'], 'export.zip');
        const zone = container.querySelector('.zone') as HTMLElement;
        await fireEvent.drop(zone, {
            dataTransfer: { items: [{ kind: 'file', getAsFile: () => file }], files: [file] },
        });

        expect(handleImport).toHaveBeenCalledWith(expect.any(Function), {
            pick: 'drop',
            surface: 'onboarding',
            expected: undefined,
        });
        expect(nav.goto).not.toHaveBeenCalled();
        handleImport.mockRestore();
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

        expect(screen.getByRole('button', { name: /Start with WhatsApp/i })).toBeInTheDocument();
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
            screen.queryByRole('button', { name: /Start with WhatsApp/i })
        ).not.toBeInTheDocument();

        const link = screen.getByRole('link', { name: /Messages/ });
        expect(link).toHaveAttribute('href', '/messages/explore');
    });

    // `loaded.listening` is set by the demo too, and somebody who has only seen
    // the sample still needs the funnel.
    test('the demo alone does not count as having imported anything', () => {
        dataStore.loadDemoData('listening');
        render(LandingPage);

        expect(screen.getByRole('button', { name: /Start with WhatsApp/i })).toBeInTheDocument();
    });
});
