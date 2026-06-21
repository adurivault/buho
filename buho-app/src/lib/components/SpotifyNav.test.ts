import { render, screen } from '@testing-library/svelte';
import '@testing-library/jest-dom/vitest';
import { describe, expect, test, vi } from 'vitest';
import SpotifyNav from './SpotifyNav.svelte';

// Mock $app/state — pathname is on the Explore view
vi.mock('$app/state', () => ({
	page: {
		url: new URL('http://localhost/spotify/explore'),
		params: {},
		route: { id: '/spotify/explore' },
		status: 200,
		error: null,
		data: {},
		form: null
	}
}));

// Mock $app/paths
vi.mock('$app/paths', () => ({
	resolve: (path: string) => path
}));

describe('SpotifyNav', () => {
	test('renders Explore and Other links with correct routes', () => {
		render(SpotifyNav);

		const exploreLink = screen.getByRole('link', { name: 'Explore' });
		const otherLink = screen.getByRole('link', { name: 'Other' });

		expect(exploreLink).toHaveAttribute('href', '/spotify/explore');
		expect(otherLink).toHaveAttribute('href', '/spotify/guide');
	});

	test('marks the current view as active', () => {
		render(SpotifyNav);

		const exploreLink = screen.getByRole('link', { name: 'Explore' });
		const otherLink = screen.getByRole('link', { name: 'Other' });

		expect(exploreLink).toHaveClass('active');
		expect(exploreLink).toHaveAttribute('aria-current', 'page');
		expect(otherLink).not.toHaveClass('active');
		expect(otherLink).not.toHaveAttribute('aria-current');
	});
});
