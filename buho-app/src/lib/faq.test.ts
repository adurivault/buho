// @vitest-environment node
// (vite.config pulls in SvelteKit's Vite plugin, which jsdom's URL breaks.)
import { describe, expect, test } from 'vitest';
import { csp } from '../../vite.config';
import { entryText, FAQ_ENTRIES, FAQ_GROUPS } from './faq';
import { plainText } from './seo';

/**
 * The answer telling people how to check the no-egress claim names, in prose,
 * the hosts the content-security policy allows. A host added to
 * `vite.config.ts` without a word here would leave that answer quietly false.
 */

const directives = csp.directives as Record<string, string[]>;

/** The allowlist minus the schemes, which name no third party. */
const allowedHosts = directives['connect-src']
    .filter((source) => source.startsWith('https://'))
    .map((source) => source.replace('https://', ''));

describe('FAQ content', () => {
    // Every id the page puts in the DOM: one per answer, one per group heading.
    test('anchors are unique, so each answer can be linked to on its own', () => {
        const ids = [
            ...FAQ_ENTRIES.map((entry) => entry.id),
            ...FAQ_GROUPS.map((group) => `${group.id}-heading`),
        ];
        expect(new Set(ids).size).toBe(ids.length);
    });

    // Two of them are the sentence somebody types when something went wrong,
    // not a question, but all of them are whole.
    test('every question is a finished sentence', () => {
        for (const entry of FAQ_ENTRIES) expect(entry.question).toMatch(/[?.]$/);
    });

    // Short on purpose: a page of paragraphs is a page nobody finds their
    // question in. Short, not empty.
    test('every answer is short, and there', () => {
        for (const entry of FAQ_ENTRIES) {
            expect(entry.answer.length).toBeGreaterThan(0);
            for (const paragraph of entry.answer) expect(paragraph.trim()).not.toBe('');
            expect(plainText(entryText(entry)).length).toBeLessThan(500);
        }
    });

    describe('the answer that tells people how to check for themselves', () => {
        const entry = FAQ_ENTRIES.find((candidate) => candidate.id === 'verify');
        const text = entry ? entryText(entry) : '';

        test('names every host the policy allows', () => {
            expect(entry).toBeDefined();
            for (const host of allowedHosts) expect(text).toContain(host);
        });

        test('names no host the policy does not allow', () => {
            const named = [...text.matchAll(/\b(?:[a-z0-9-]+\.)+(?:org|is|com|net|io)\b/g)].map(
                ([host]) => host
            );
            expect(named.length).toBeGreaterThan(0);
            for (const host of named) expect(allowedHosts).toContain(host);
        });
    });
});
