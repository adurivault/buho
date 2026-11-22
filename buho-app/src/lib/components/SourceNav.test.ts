import { render, screen } from '@testing-library/svelte';
import '@testing-library/jest-dom/vitest';
import { describe, expect, test, vi } from 'vitest';
import SourceNav from './SourceNav.svelte';

// Mock $app/state — pathname is on the Explore view
vi.mock('$app/state', () => ({
    page: {
        url: new URL('http://localhost/listening/explore'),
        params: {},
        route: { id: '/listening/explore' },
        status: 200,
        error: null,
        data: {},
        form: null,
    },
}));

const tabs = [
    { label: 'Explore', href: '/listening/explore' },
    { label: 'Other', href: '/listening/guide' },
];

describe('SourceNav', () => {
    test('renders every tab with its route', () => {
        render(SourceNav, { tabs, ariaLabel: 'Spotify views' });

        const exploreLink = screen.getByRole('link', { name: 'Explore' });
        const otherLink = screen.getByRole('link', { name: 'Other' });

        expect(exploreLink).toHaveAttribute('href', '/listening/explore');
        expect(otherLink).toHaveAttribute('href', '/listening/guide');
    });

    test('marks the current view as active', () => {
        render(SourceNav, { tabs, ariaLabel: 'Spotify views' });

        const exploreLink = screen.getByRole('link', { name: 'Explore' });
        const otherLink = screen.getByRole('link', { name: 'Other' });

        expect(exploreLink).toHaveClass('active');
        expect(exploreLink).toHaveAttribute('aria-current', 'page');
        expect(otherLink).not.toHaveClass('active');
        expect(otherLink).not.toHaveAttribute('aria-current');
    });
});
