import { render, screen } from '@testing-library/svelte';
import '@testing-library/jest-dom/vitest';
import { describe, expect, test } from 'vitest';
import DataSourceCard from './DataSourceCard.svelte';

describe('DataSourceCard', () => {
	test('renders title and description', () => {
		render(DataSourceCard, {
			props: {
				title: 'Spotify',
				description: 'Analyze your listening history'
			}
		});

		expect(screen.getByText('Spotify')).toBeInTheDocument();
		expect(screen.getByText('Analyze your listening history')).toBeInTheDocument();
	});

	test('renders "Coming Soon" badge when not available', () => {
		render(DataSourceCard, {
			props: {
				title: 'Google Maps',
				description: 'Visualize your location history',
				available: false
			}
		});

		expect(screen.getByText('Coming Soon')).toBeInTheDocument();
		expect(screen.queryByText('Available')).not.toBeInTheDocument();
	});

	test('renders "Available" badge when available', () => {
		render(DataSourceCard, {
			props: {
				title: 'Spotify',
				description: 'Analyze your listening history',
				available: true,
				link: '/spotify/guide'
			}
		});

		expect(screen.getByText('Available')).toBeInTheDocument();
		expect(screen.queryByText('Coming Soon')).not.toBeInTheDocument();
	});

	test('renders as link when available', () => {
		const { container } = render(DataSourceCard, {
			props: {
				title: 'Spotify',
				description: 'Test description',
				available: true,
				link: '/spotify/guide'
			}
		});

		const link = container.querySelector('a');
		expect(link).toBeInTheDocument();
		expect(link).toHaveAttribute('href', '/spotify/guide');
	});

	test('renders as div when not available', () => {
		const { container } = render(DataSourceCard, {
			props: {
				title: 'WhatsApp',
				description: 'Test description',
				available: false
			}
		});

		const link = container.querySelector('a');
		const div = container.querySelector('div[role="article"]');

		expect(link).not.toBeInTheDocument();
		expect(div).toBeInTheDocument();
	});

	test('has cursor-not-allowed class when not available', () => {
		const { container } = render(DataSourceCard, {
			props: {
				title: 'Test',
				description: 'Test description',
				available: false
			}
		});

		const card = container.querySelector('div[role="article"]');
		expect(card).toHaveClass('cursor-not-allowed');
		expect(card).toHaveClass('opacity-60');
	});

	test('has hover effects when available', () => {
		const { container } = render(DataSourceCard, {
			props: {
				title: 'Test',
				description: 'Test description',
				available: true,
				link: '/test'
			}
		});

		const link = container.querySelector('a');
		expect(link).toHaveClass('cursor-pointer');
		expect(link).toHaveClass('hover:-translate-y-1');
	});

	test('renders image when provided', () => {
		render(DataSourceCard, {
			props: {
				title: 'Spotify',
				description: 'Test description',
				available: true,
				link: '/spotify/guide',
				image: '/images/spotify-preview.png'
			}
		});

		const img = screen.getByRole('img');
		expect(img).toBeInTheDocument();
		expect(img).toHaveAttribute('src', '/images/spotify-preview.png');
		expect(img).toHaveAttribute('alt', 'Spotify preview');
	});

	test('does not render image when not provided', () => {
		render(DataSourceCard, {
			props: {
				title: 'Spotify',
				description: 'Test description',
				available: true,
				link: '/spotify/guide'
			}
		});

		const img = screen.queryByRole('img');
		expect(img).not.toBeInTheDocument();
	});
});
