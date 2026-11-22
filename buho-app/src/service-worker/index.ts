/**
 * Keeps a copy of Buho's own files in the browser, so that once a visit has
 * loaded it, the app opens and reads a file with the network off.
 *
 * It only ever stores what every visitor downloads: pages, code, the DuckDB
 * engine and its extensions. A dropped file is read in the tab and never
 * becomes a request, so it never passes through here. Requests to other
 * origins (map tiles, the Umami counter) are left alone entirely.
 *
 * Updates: a new deploy installs a new worker beside the old one, which keeps
 * serving its own version, whole, until every Buho tab is closed. No
 * `skipWaiting()`, because swapping versions under an open tab would make its
 * next lazy chunk a miss, and the full reload that follows would throw away
 * whatever the visitor had loaded.
 */

import { version } from '$app/env';
import { assets, immutable, prerendered } from '$app/manifest';
import { asset, resolve } from '$app/paths';
import { self as sw } from '$app/service-worker';
import type { Path } from '$app/types';
import { duckdbEngine, precacheList, type Manifest } from '#lib/offline.ts';

const CACHE = `buho-${version}`;

/**
 * The build's files as the addresses the tab requests them by. `resolve` types
 * its argument as a route's path, which a chunk is not, but all it does to
 * either is prefix the base path.
 */
const manifest: Manifest = {
    immutable: immutable.map(({ path }) => resolve(path as Path)),
    assets: assets.map(({ path }) => asset(path)),
    prerendered: prerendered.map(({ path }) => resolve(path)),
};
const STATIC_FILES = new Set(manifest.assets);
const PAGES = new Set(manifest.prerendered);

sw.addEventListener('install', (event) => {
    // Pages are revalidated rather than taken from the HTTP cache: GitHub Pages
    // lets the browser keep one for ten minutes, and the previous deploy's page
    // stored under this version would ask for chunks the host no longer has.
    // Everything else is named by its content hash, or by the engine version.
    const requests = precacheList(manifest, duckdbEngine()).map(
        (path) => new Request(path, { cache: PAGES.has(path) ? 'no-cache' : 'default' })
    );
    event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(requests)));
});

sw.addEventListener('activate', (event) => {
    event.waitUntil(
        (async () => {
            for (const key of await caches.keys()) {
                if (key !== CACHE) await caches.delete(key);
            }
            // On a first visit, so the page that installed the worker is
            // served by it at once, rather than from its next load.
            await sw.clients.claim();
        })()
    );
});

sw.addEventListener('fetch', (event) => {
    const { request } = event;
    if (request.method !== 'GET') return;

    const url = new URL(request.url);
    if (url.origin !== sw.location.origin || !url.pathname.startsWith(resolve(''))) return;

    event.respondWith(respond(event, url));
});

async function respond(event: FetchEvent, url: URL): Promise<Response> {
    const { request } = event;
    const cache = await caches.open(CACHE);

    // Keyed by address alone: a page is the same page whatever its query
    // string says, and the host's `Vary` headers name nothing that matters here.
    const cached = await cache.match(request, {
        ignoreSearch: request.mode === 'navigate',
        ignoreVary: true,
    });
    if (cached) return unredirected(cached);

    const response = await fetch(request);
    // What only the location views need (`spatial`, the geo files) is kept the
    // first time it is fetched rather than on install. A 206 cannot be stored.
    if (response.status === 200 && STATIC_FILES.has(url.pathname)) {
        event.waitUntil(cache.put(request, response.clone()));
    }
    return response;
}

/**
 * A response the precache got through a redirect cannot answer a navigation:
 * the browser refuses it. Copying it drops the flag.
 */
function unredirected(response: Response): Response {
    if (!response.redirected) return response;
    return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
    });
}
