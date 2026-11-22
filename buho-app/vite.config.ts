import adapter from '@sveltejs/adapter-static';
import { sveltekit, type Config } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

/**
 * The hashes of the inline scripts `app.html` carries itself.
 *
 * SvelteKit hashes the inline scripts *it* emits, not the ones already in the
 * template — so the pre-paint theme script would be refused by our own policy,
 * and the page would land in light mode before hydration corrects it. Reading
 * the template here rather than pasting a literal means the hash follows the
 * script: edit the theme snippet and the next build allows the edited one, with
 * no way to forget. Type-bearing blocks (the JSON-LD) are skipped — they are
 * data, never prepared as scripts, so no hash covers them.
 */
function templateScriptHashes(): Array<`sha256-${string}`> {
    // Vitest imports this config through Vite, where `import.meta.url` is an
    // http: URL rather than a file: one; the project root is the working
    // directory under both it and the build, so that is the fallback.
    const here = new URL('./src/app.html', import.meta.url);
    const html = readFileSync(here.protocol === 'file:' ? here : 'src/app.html', 'utf-8');
    const inline = html.matchAll(/<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/g);
    return [...inline]
        .filter(([, attrs]) => !/\btype=/.test(attrs))
        .map(
            ([, , body]): `sha256-${string}` =>
                `sha256-${createHash('sha256').update(body).digest('base64')}`
        );
}

/**
 * What the app is allowed to talk to, enforced by the browser rather than
 * promised by the README.
 *
 * Buho's whole claim is that an export never leaves the tab. Written as prose
 * that asks to be believed; written here it is a rule the browser applies to
 * every request the page makes, including ones a compromised dependency would
 * make. `connect-src` is the line that matters — our own origin plus two
 * hosts, neither of which is ever handed a row of user data:
 *
 *   tiles.openfreemap.org  the vector basemap under the location views
 *   cloud.umami.is         the cookieless tracker itself (see lib/analytics.ts)
 *   gateway.umami.is       where that tracker posts its counts
 *
 * The two Umami hosts are one integration: the script is served from
 * `cloud.umami.is` and, with no `data-host-url` on the tag, posts to its own
 * default, `gateway.umami.is`. Listing only the first is what silently ended
 * the counts once already — the script loaded, every send was refused, and
 * the tracker swallows the error rather than logging it.
 *
 * Everything else the page needs — fonts included, which is why they are
 * installed from npm rather than linked from Google — comes from our origin.
 *
 * Anything else the *document* asks for — an exfiltration attempt included — is
 * refused before it goes out. Keeping the list this short is the point: it is
 * auditable in ten seconds from view-source, which 30k lines of app code are
 * not.
 *
 * Where it stops, measured rather than assumed: a `<meta>` policy does not
 * reach a worker loaded from an https: URL, which takes its policy from its own
 * response headers — none, on GitHub Pages — and inherits nothing. So the
 * DuckDB worker runs unconstrained, and that is where the user's rows actually
 * live. It shows: DuckDB pulls its `json` extension from extensions.duckdb.org
 * on the first `read_json_auto`, and this policy does not stop it. Self-hosting
 * that extension is what closes the hole; the policy cannot.
 *
 * GitHub Pages serves no custom headers, so SvelteKit emits this as a
 * `<meta http-equiv>` on every prerendered page. `connect-src` is honoured
 * there; the few directives that are header-only (frame-ancestors) are
 * deliberately absent rather than written and silently ignored.
 */
export const csp: NonNullable<Config['csp']> = {
    mode: 'hash',
    directives: {
        'default-src': ['self'],
        // 'wasm-unsafe-eval' is DuckDB: instantiating the .wasm counts as eval
        // to CSP, and without it the whole query layer fails to start.
        'script-src': [
            'self',
            'wasm-unsafe-eval',
            'https://cloud.umami.is',
            ...templateScriptHashes(),
        ],
        // Hashes land in 'style-src', and a hash makes the browser ignore
        // 'unsafe-inline' in that same directive — which would kill every
        // `style=` and Svelte `style:` binding in the app. 'style-src-attr' is
        // a separate directive, so the allowance for attributes survives.
        'style-src': ['self', 'unsafe-inline'],
        'style-src-attr': ['unsafe-inline'],
        'font-src': ['self'],
        // blob: is our own doing, not a remote fetch: charts are rasterised by
        // loading their SVG through an <img> off a blob URL (lib/export).
        'img-src': ['self', 'data:', 'blob:', 'https://tiles.openfreemap.org'],
        'connect-src': [
            'self',
            'data:',
            'blob:',
            'https://tiles.openfreemap.org',
            'https://cloud.umami.is',
            'https://gateway.umami.is',
        ],
        // DuckDB's and MapLibre's workers are both files of the build.
        'worker-src': ['self'],
        'object-src': ['none'],
        'base-uri': ['self'],
        'form-action': ['self'],
        'frame-src': ['none'],
    },
};

export default defineConfig({
    plugins: [
        sveltekit({
            adapter: adapter({
                /**
                 * `404.html`, not `index.html`.
                 *
                 * The fallback is written last and overwrites whatever sits at its
                 * name — so pointed at `index.html` it replaced the rendered home
                 * page with an empty shell, which is the one document every crawler
                 * fetches first. Under this name it collides with nothing, and it
                 * is also the file GitHub Pages actually serves for an address that
                 * does not exist; every real route is prerendered, so nothing but a
                 * genuine miss ever lands on it.
                 */
                fallback: '404.html',
            }),
            csp,
        }),
        tailwindcss(),
    ],
    server: { hmr: process.env.NO_HMR ? false : undefined },
    build: {
        // Vite inlines any asset under 4 KB as a data: URL, which caught one
        // small font subset; `font-src 'self'` (the `csp` above) refuses those.
        // Fonts always ship as files, everything else keeps the default.
        assetsInlineLimit: (file) => (/\.woff2?$/.test(file) ? false : undefined),
    },
    optimizeDeps: {
        exclude: ['@duckdb/duckdb-wasm'],
    },
    test: {
        environment: 'jsdom',
        setupFiles: ['./vitest.setup.ts'],
        server: {
            deps: {
                inline: [/svelte/],
            },
        },
        // The headless suites boot a real DuckDB-WASM and exercise the SQL end to
        // end; the unit project is everything else (mocked DB, jsdom components).
        // `npm run test:unit` / `test:headless` run one side, `npm test` both.
        projects: [
            {
                extends: true,
                test: {
                    name: 'unit',
                    include: ['src/**/*.test.ts'],
                    exclude: ['src/**/*.headless.test.ts'],
                },
            },
            {
                extends: true,
                test: { name: 'headless', include: ['src/**/*.headless.test.ts'] },
            },
        ],
    },
    resolve: {
        conditions: ['browser'],
    },
});
