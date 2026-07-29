import { render, screen } from '@testing-library/svelte';
import '@testing-library/jest-dom/vitest';
import { describe, expect, test, vi } from 'vitest';
import SourceNav from './SourceNav.svelte';

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

const tabs = [
	{ label: 'Explore', href: '/spotify/explore' },
	{ label: 'Other', href: '/spotify/guide' }
];

describe('SourceNav', () => {
	test('renders every tab with its route', () => {
		render(SourceNav, { tabs, ariaLabel: 'Spotify views' });

		const exploreLink = screen.getByRole('link', { name: 'Explore' });
		const otherLink = screen.getByRole('link', { name: 'Other' });

		expect(exploreLink).toHaveAttribute('href', '/spotify/explore');
		expect(otherLink).toHaveAttribute('href', '/spotify/guide');
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
