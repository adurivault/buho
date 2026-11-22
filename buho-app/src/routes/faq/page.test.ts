import { render, screen } from '@testing-library/svelte';
import '@testing-library/jest-dom/vitest';
import { describe, expect, test } from 'vitest';
import { resolve } from '$app/paths';
import FaqPage from './+page.svelte';
import { FAQ_ENTRIES, FAQ_GROUPS } from '#lib/faq.ts';

describe('faq page', () => {
    test('every question is on the page, under its group', () => {
        render(FaqPage);

        for (const group of FAQ_GROUPS) {
            expect(screen.getByRole('heading', { name: group.title })).toBeInTheDocument();
        }
        for (const entry of FAQ_ENTRIES) {
            expect(screen.getByRole('heading', { name: entry.question })).toBeInTheDocument();
        }
    });

    // The whole point of the anchors: an answer can be linked to on its own,
    // which is how one gets quoted back at somebody who asked.
    test('each answer is addressable by its own anchor', () => {
        const { container } = render(FaqPage);

        for (const entry of FAQ_ENTRIES) {
            expect(container.querySelector(`article#${entry.id}`)).not.toBeNull();
            expect(screen.getByRole('link', { name: entry.question })).toHaveAttribute(
                'href',
                `#${entry.id}`
            );
        }
    });

    // The answers that point elsewhere (the sources map, a source's guide, the
    // views worth seeing) have to land somewhere a person can follow.
    test('every onward link is on the page', () => {
        render(FaqPage);

        for (const entry of FAQ_ENTRIES) {
            for (const link of entry.links ?? []) {
                expect(screen.getByRole('link', { name: `${link.label} →` })).toHaveAttribute(
                    'href',
                    resolve(link.href)
                );
            }
        }
    });
});
