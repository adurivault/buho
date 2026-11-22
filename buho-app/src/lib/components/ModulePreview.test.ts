import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/svelte';
import '@testing-library/jest-dom/vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import ModulePreview from './ModulePreview.svelte';
import { DATA_MODULES, moduleById } from '#lib/data/modules.ts';

afterEach(() => cleanup());

describe('ModulePreview', () => {
    /**
     * Both themes are in the markup and the stylesheet keeps the one matching
     * `.dark`. Lazy, so the hidden one is not fetched until the theme changes.
     */
    it('carries the capture for each theme, loaded lazily', () => {
        const { container } = render(ModulePreview, { props: { module: moduleById('health') } });

        const sources = [...container.querySelectorAll('img')].map((img) => ({
            src: img.getAttribute('src'),
            loading: img.getAttribute('loading'),
        }));
        expect(sources).toEqual([
            { src: expect.stringMatching(/shots\/health-light\.webp$/), loading: 'lazy' },
            { src: expect.stringMatching(/shots\/health-dark\.webp$/), loading: 'lazy' },
        ]);
    });

    it('says, on the welcome card, that the chart is demo data', () => {
        render(ModulePreview, { props: { module: moduleById('steps') } });

        expect(screen.getByText('Demo data')).toBeInTheDocument();
        expect(screen.getAllByAltText('Steps explorer, drawn from demo data')).toHaveLength(2);
    });

    /** A home tile's link is named by its caption; the picture adds nothing to read. */
    it('leaves a tile bare and silent', () => {
        const { container } = render(ModulePreview, {
            props: { module: moduleById('steps'), variant: 'tile' },
        });

        expect(screen.queryByText('Demo data')).toBeNull();
        for (const img of container.querySelectorAll('img')) {
            expect(img.getAttribute('alt')).toBe('');
        }
    });

    /** The captures are committed files: `npm run shots` writes a pair per module. */
    it('has a capture in each theme for every module', () => {
        for (const module of DATA_MODULES) {
            for (const theme of ['light', 'dark']) {
                const file = join(__dirname, '../../../static/shots', `${module.id}-${theme}.webp`);
                expect(existsSync(file), `${module.id}-${theme}.webp`).toBe(true);
            }
        }
    });
});
