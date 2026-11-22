import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/svelte';
import '@testing-library/jest-dom/vitest';
import Shot from './Shot.svelte';
import { MODULE_SHOTS } from '#lib/shots.ts';

afterEach(() => cleanup());

describe('Shot', () => {
    /**
     * Both themes are in the markup and the stylesheet keeps the one matching
     * `.dark`. Lazy, so the hidden one is not fetched until the theme changes.
     */
    it('carries the capture for each theme, loaded lazily', () => {
        const { container } = render(Shot, { props: { shot: MODULE_SHOTS.health.main } });

        const images = [...container.querySelectorAll('img')].map((img) => ({
            src: img.getAttribute('src'),
            loading: img.getAttribute('loading'),
        }));
        expect(images).toEqual([
            {
                src: expect.stringMatching(/shots\/health-heart-rate-light\.webp$/),
                loading: 'lazy',
            },
            { src: expect.stringMatching(/shots\/health-heart-rate-dark\.webp$/), loading: 'lazy' },
        ]);
    });

    it('prints the credit a picture has to carry', () => {
        render(Shot, { props: { shot: MODULE_SHOTS.positions.side } });

        // Short on the picture, the whole notice on hover.
        const credit = screen.getByText('© OpenStreetMap');
        expect(credit).toHaveAttribute(
            'title',
            expect.stringMatching(/OpenStreetMap contributors/)
        );
    });

    it('says nothing when it repeats what is written beside it', () => {
        const { container } = render(Shot, { props: { shot: MODULE_SHOTS.steps.main } });

        for (const img of container.querySelectorAll('img')) {
            expect(img.getAttribute('alt')).toBe('');
        }
    });
});
