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
	test('renders Guide and Explore links with correct routes', () => {
		render(SpotifyNav);

		const guideLink = screen.getByRole('link', { name: 'Guide' });
		const exploreLink = screen.getByRole('link', { name: 'Explore' });

		expect(guideLink).toHaveAttribute('href', '/spotify/guide');
		expect(exploreLink).toHaveAttribute('href', '/spotify/explore');
	});

	test('marks the current view as active', () => {
		render(SpotifyNav);

		const guideLink = screen.getByRole('link', { name: 'Guide' });
		const exploreLink = screen.getByRole('link', { name: 'Explore' });

		expect(exploreLink).toHaveClass('active');
		expect(exploreLink).toHaveAttribute('aria-current', 'page');
		expect(guideLink).not.toHaveClass('active');
		expect(guideLink).not.toHaveAttribute('aria-current');
	});
});
