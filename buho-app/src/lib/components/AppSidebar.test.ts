import { render, screen } from '@testing-library/svelte';
import '@testing-library/jest-dom/vitest';
import { describe, expect, test, vi } from 'vitest';
import AppSidebar from './AppSidebar.svelte';

// Mock $app/state
vi.mock('$app/state', () => ({
	page: {
		url: new URL('http://localhost/spotify/guide'),
		params: {},
		route: { id: '/spotify/guide' },
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

describe('AppSidebar', () => {
	test('renders home logo and all three data sources', () => {
		render(AppSidebar);

		expect(screen.getByText('Home')).toBeInTheDocument();
		expect(screen.getByText('Spotify')).toBeInTheDocument();
		expect(screen.getByText(/Google Maps/)).toBeInTheDocument();
		expect(screen.getByText(/WhatsApp/)).toBeInTheDocument();
	});

	test('home and spotify links point to correct routes', () => {
		render(AppSidebar);

		const homeLink = screen.getByText('Home').closest('a');
		const spotifyLink = screen.getByText('Spotify').closest('a');

		expect(homeLink).toHaveAttribute('href', '/');
		expect(spotifyLink).toHaveAttribute('href', '/spotify/guide');
	});

	test('unavailable sources are disabled, not links', () => {
		render(AppSidebar);

		const googleMaps = screen.getByText(/Google Maps/).closest('.nav-link');
		const whatsapp = screen.getByText(/WhatsApp/).closest('.nav-link');

		expect(googleMaps?.tagName).not.toBe('A');
		expect(googleMaps).toHaveAttribute('aria-disabled', 'true');
		expect(whatsapp?.tagName).not.toBe('A');
		expect(whatsapp).toHaveAttribute('aria-disabled', 'true');
	});

	test('has a theme toggle button and no collapse toggle', () => {
		render(AppSidebar);

		const buttons = screen.getAllByRole('button');
		// The only button is the color-theme toggle (no sidebar collapse control).
		expect(buttons).toHaveLength(1);
		expect(buttons[0]).toHaveAttribute('aria-label', 'Toggle color theme');
	});

	test('highlights active link based on current pathname', () => {
		// The mock sets pathname to /spotify/guide
		render(AppSidebar);

		const spotifyLink = screen.getByText('Spotify').closest('a');
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

		// Data sources are in the list (3 items: Spotify, Google Maps, WhatsApp)
		const listItems = container.querySelectorAll('li');
		expect(listItems).toHaveLength(3);
	});
});
