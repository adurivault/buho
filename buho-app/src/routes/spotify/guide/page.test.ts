import { render, screen } from '@testing-library/svelte';
import { describe, it, expect, vi } from 'vitest';
import Page from './+page.svelte';

// Mock dataStore to avoid DuckDB worker issues in tests
vi.mock('$lib/stores/dataStore.svelte', () => {
    return {
        dataStore: {
            files: [],
            demoMode: false
        }
    };
});

describe('Guide Page', () => {
    it('renders the guide header', () => {
        render(Page);
        expect(screen.getByText('Your Audio Journey')).toBeInTheDocument();
    });

    it('renders sections from the registry', () => {
        render(Page);
        expect(screen.getByTestId('section-macro-stats')).toBeInTheDocument();
        expect(screen.getByTestId('section-artist-duration-race')).toBeInTheDocument();
        expect(screen.getByTestId('section-track-duration-race')).toBeInTheDocument();
        expect(screen.getByTestId('section-artist-ridgeline')).toBeInTheDocument();
        expect(
            screen.getByTestId('section-guide-to-explore-handoff')
        ).toBeInTheDocument();
    });
});
