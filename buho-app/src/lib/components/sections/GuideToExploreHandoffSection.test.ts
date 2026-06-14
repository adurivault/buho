import { render, screen } from '@testing-library/svelte';
import { describe, it, expect } from 'vitest';
import GuideToExploreHandoffSection from './GuideToExploreHandoffSection.svelte';

describe('GuideToExploreHandoffSection', () => {
    it('should display the correct CTA text', () => {
        render(GuideToExploreHandoffSection);
        expect(screen.getByText('Want to explore on your own?')).toBeInTheDocument();
    });

    it('should have a link to the explorer page', () => {
        render(GuideToExploreHandoffSection);
        const link = screen.getByRole('link', { name: 'Want to explore on your own?' });
        expect(link).toBeInTheDocument();
        expect(link).toHaveAttribute('href', expect.stringContaining('/spotify/explore'));
    });
});
