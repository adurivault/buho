import { render, screen } from '@testing-library/svelte';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, test, vi } from 'vitest';
import AppSidebar from './AppSidebar.svelte';
import { dataStore } from '#lib/stores/dataStore.svelte.ts';

// Mock $app/state
vi.mock('$app/state', () => ({
    page: {
        url: new URL('http://localhost/listening/guide'),
        params: {},
        route: { id: '/listening/guide' },
        status: 200,
        error: null,
        data: {},
        form: null,
    },
}));

describe('AppSidebar', () => {
    afterEach(() => {
        dataStore.reset();
    });

    test('renders home logo and all three data sources', () => {
        render(AppSidebar);

        expect(screen.getByText('Home')).toBeInTheDocument();
        expect(screen.getByText('Listening')).toBeInTheDocument();
        expect(screen.getByText('Positions')).toBeInTheDocument();
        expect(screen.getByText('Messages')).toBeInTheDocument();
    });

    test('every source links to its explorer', () => {
        render(AppSidebar);

        const homeLink = screen.getByText('Home').closest('a');
        const spotifyLink = screen.getByText('Listening').closest('a');
        const mapsLink = screen.getByText('Positions').closest('a');
        const messagesLink = screen.getByText('Messages').closest('a');

        expect(homeLink).toHaveAttribute('href', '/');
        expect(spotifyLink).toHaveAttribute('href', '/listening/explore');
        expect(mapsLink).toHaveAttribute('href', '/positions/explore');
        expect(messagesLink).toHaveAttribute('href', '/messages/explore');
    });

    test('has a theme toggle button and no collapse toggle', () => {
        render(AppSidebar);

        // The rail is a fixed 56px: it never folds away, so there is no control
        // for it. The one button is the theme toggle.
        expect(screen.getByLabelText('Toggle color theme')).toBeInTheDocument();
        expect(screen.getAllByRole('button')).toHaveLength(1);
        expect(screen.queryByLabelText(/collapse/i)).not.toBeInTheDocument();
    });

    test('highlights active link based on current pathname', () => {
        // The mock sets pathname to /listening/guide
        render(AppSidebar);

        const spotifyLink = screen.getByText('Listening').closest('a');
        expect(spotifyLink).toHaveClass('active');

        const homeLink = screen.getByText('Home').closest('a');
        expect(homeLink).not.toHaveClass('active');
    });

    test('sidebar element exists with correct structure', () => {
        const { container } = render(AppSidebar);

        const sidebar = container.querySelector('aside.sidebar');
        expect(sidebar).toBeTruthy();

        const nav = container.querySelector('nav');
        expect(nav).toBeTruthy();

        // Logo link is separate from the data sources list
        const logoLink = container.querySelector('a.logo');
        expect(logoLink).toBeTruthy();

        // One entry per module, in the order they appear in the sidebar, each
        // named after its dataset and pointing at whatever fills it. Positions
        // names two exports because a Garmin archive carries GPS tracks as well
        // as step counters — which is the whole reason no module is called
        // "Garmin" any more.
        const sources = [...container.querySelectorAll('li a')].map((a) => a.getAttribute('title'));
        expect(sources).toEqual([
            'Listening — from Last.fm, Spotify or Deezer',
            'Positions — from Google Timeline, Strava or Garmin Connect',
            'Messages — from WhatsApp, Messenger or Instagram',
            'Google activity — from Google Takeout',
            'Steps — from Garmin Connect',
            'Health — from Garmin Connect',
        ]);
    });

    test('the Garmin entry carries the footprints, not the maker mark', () => {
        // Sidebar glyphs stand for the data, not whoever recorded it. Garmin's
        // own triangle marks the export, which only /sources talks about.
        const { container } = render(AppSidebar);

        const garmin = screen.getByText('Steps').closest('a');
        expect(garmin?.querySelector('.lucide-footprints')).toBeTruthy();
        expect(container.querySelector('.lucide-triangle')).toBeNull();
    });

    test('links to the sources reference page', () => {
        render(AppSidebar);

        const reference = screen.getByText('Sources').closest('a');
        expect(reference).toHaveAttribute('href', '/sources');
    });

    test('links to the FAQ', () => {
        render(AppSidebar);

        expect(screen.getByText('FAQ').closest('a')).toHaveAttribute('href', '/faq');
    });

    test('puts the calendar above the modules, outside their list', () => {
        const { container } = render(AppSidebar);

        const calendar = screen.getByText('Calendar').closest('a');
        expect(calendar).toHaveAttribute('href', '/calendar');
        // Not a module: no entry of its own in the list the modules render from.
        expect(calendar?.closest('nav')).toBeNull();
        const nav = container.querySelector('nav');
        expect(
            calendar!.compareDocumentPosition(nav!) & Node.DOCUMENT_POSITION_FOLLOWING
        ).toBeTruthy();
        expect(calendar).not.toHaveClass('active');
    });

    describe('loaded state', () => {
        test('a source with no data is neither loaded nor active', () => {
            render(AppSidebar);

            const garmin = screen.getByText('Steps').closest('a');
            expect(garmin).not.toHaveClass('loaded');
            expect(garmin).not.toHaveClass('active');
        });

        test('importing lights up that source, and only that one', () => {
            dataStore.loadUserData('steps');
            render(AppSidebar);

            expect(screen.getByText('Steps').closest('a')).toHaveClass('loaded');
            expect(screen.getByText('Messages').closest('a')).not.toHaveClass('loaded');
        });

        test('the title says so, so the colour alone never has to carry it', () => {
            dataStore.loadUserData('steps');
            render(AppSidebar);

            expect(screen.getByText('Steps').closest('a')).toHaveAttribute(
                'title',
                'Steps — from Garmin Connect · data loaded'
            );
            expect(screen.getByText('Messages').closest('a')).toHaveAttribute(
                'title',
                'Messages — from WhatsApp, Messenger or Instagram'
            );
        });

        test('links to the source code in a new tab', () => {
            render(AppSidebar);

            const source = screen.getByText('Source code on GitHub').closest('a');
            expect(source).toHaveAttribute('href', 'https://github.com/adurivault/buho');
            expect(source).toHaveAttribute('target', '_blank');
            expect(source).toHaveAttribute('rel', expect.stringContaining('noopener'));
        });

        test('the active source is also marked loaded once it holds data', () => {
            // The mock pathname is /listening/guide, so Music is the active one:
            // the two states are independent, and the CSS decides which wins.
            dataStore.loadUserData('listening');
            render(AppSidebar);

            const spotify = screen.getByText('Listening').closest('a');
            expect(spotify).toHaveClass('loaded');
            expect(spotify).toHaveClass('active');
        });
    });
});
