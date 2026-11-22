// @vitest-environment node
// (vite.config pulls in SvelteKit's Vite plugin, which jsdom's URL breaks.)
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import viteConfig, { csp } from '../vite.config';

/**
 * Guards invariant #1 the way `stores.test.ts` guards #2.
 *
 * "Your data never leaves the browser" is enforced at runtime by the policy in
 * `vite.config.ts`: the browser refuses any request to a host that is not on
 * the list. That only holds while the list stays short and deliberate, so the
 * allowlist is asserted exactly rather than loosely — adding a host is then a
 * decision someone has to make in this file, with the promise in front of them,
 * instead of a line that slips in behind a feature.
 */

const directives = csp.directives as Record<string, string[]>;

/** Origins the app may open a connection to, and why each one is defensible. */
const ALLOWED_CONNECT = [
    'self',
    'data:',
    'blob:',
    // Vector basemap. Sees the tiles a viewport covers, never a row of data.
    'https://tiles.openfreemap.org',
    // Cookieless counts. Sends event *names*, never user values — lib/analytics.ts.
    // Two hosts, one integration: the tracker is served from `cloud.umami.is`
    // and posts to `gateway.umami.is`, its default when the tag carries no
    // `data-host-url`. Dropping the second one silently stops every count.
    'https://cloud.umami.is',
    'https://gateway.umami.is',
];

describe('Content-Security-Policy', () => {
    it('lets the app talk to nothing beyond the reviewed allowlist', () => {
        expect(directives['connect-src']).toEqual(ALLOWED_CONNECT);
    });

    it('keeps a default-deny base with the usual escapes shut', () => {
        expect(directives['default-src']).toEqual(['self']);
        expect(directives['object-src']).toEqual(['none']);
        expect(directives['base-uri']).toEqual(['self']);
        expect(directives['form-action']).toEqual(['self']);
    });

    it('allows scripts only from us, Umami, and hashed inline snippets', () => {
        const hosts = directives['script-src'].filter((s) => s.startsWith('http'));
        expect(hosts).toEqual(['https://cloud.umami.is']);
        // DuckDB instantiating its .wasm reads as eval to CSP; without this the
        // entire query layer refuses to start.
        expect(directives['script-src']).toContain('wasm-unsafe-eval');
    });

    it('hashes every inline script the template carries', () => {
        const html = readFileSync('src/app.html', 'utf-8');
        const executable = [...html.matchAll(/<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/g)]
            .filter(([, attrs]) => !/\btype=/.test(attrs))
            .map(([, , body]) => `sha256-${createHash('sha256').update(body).digest('base64')}`);

        expect(executable.length).toBeGreaterThan(0);
        for (const hash of executable) expect(directives['script-src']).toContain(hash);
    });

    it('runs workers from files of the build only', () => {
        // DuckDB and MapLibre both start theirs from a URL Vite emitted
        // (db/client.ts, visualizations/maplibre.ts); neither needs a blob.
        expect(directives['worker-src']).toEqual(['self']);
    });

    it('serves styles and fonts from our own origin only', () => {
        // Self-hosted through @fontsource-variable (see app.css). A link to
        // Google Fonts would put two more hosts on the policy for bytes that are
        // not user data and have no reason to be fetched from anyone.
        expect(directives['style-src'].filter((s) => s.startsWith('http'))).toEqual([]);
        expect(directives['font-src']).toEqual(['self']);
    });

    it('keeps inline style attributes working alongside style hashes', () => {
        // A hash in `style-src` makes the browser drop that directive's
        // 'unsafe-inline', which would break every `style=` and Svelte `style:`
        // binding in the app. The separate attribute directive survives it.
        expect(directives['style-src-attr']).toEqual(['unsafe-inline']);
    });

    // `font-src` allows our origin only, so a font Vite inlined as a data: URL
    // would be refused, as one small subset was.
    it('never lets the build inline a font as a data: URL', () => {
        const limit = viteConfig.build?.assetsInlineLimit;
        expect(directives['font-src']).toEqual(['self']);
        expect(typeof limit).toBe('function');
        const inline = limit as (file: string, content: Buffer) => boolean | undefined;
        expect(inline('/fonts/tiny.woff2', Buffer.alloc(100))).toBe(false);
        expect(inline('/fonts/tiny.woff', Buffer.alloc(100))).toBe(false);
        expect(inline('/icons/tiny.svg', Buffer.alloc(100))).toBeUndefined();
    });
});
