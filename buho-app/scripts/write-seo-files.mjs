/**
 * Writes `sitemap.xml` and `llms.txt` from what the build actually produced.
 *
 * Runs after `vite build`, over `build/`, rather than off the route table: the
 * question both files answer is "which pages say something to a visitor who
 * runs no JavaScript", and the only place that is known for certain is the
 * rendered output. Most of this app is a DuckDB session in a tab and prerenders
 * to an empty shell — listing those would be inviting crawlers to spend their
 * budget on blank documents, and telling an assistant to read pages that
 * contain nothing.
 *
 * The test for "says something" is an `<h1>`. A rendered page has one; a shell
 * has no body at all. Adding a server-rendered route is therefore enough to get
 * it listed, and there is no second list to keep in step.
 *
 * The same test marks the shells `noindex`, so the sitemap and the index agree
 * on which pages exist for search: a page is in one or kept out of the other.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

const BUILD = new URL('../build/', import.meta.url).pathname;
const SITE_URL = 'https://buho-app.com';

/** Every .html in the build, in a stable order. */
async function htmlFiles(dir) {
    const found = [];
    for (const entry of await readdir(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) found.push(...(await htmlFiles(path)));
        else if (entry.name.endsWith('.html')) found.push(path);
    }
    return found.sort();
}

const tag = (html, re) => html.match(re)?.[1]?.trim();

/** `build/sources/spotify.html` → `/sources/spotify`; the root stays `/`. */
function pathnameOf(file) {
    const route =
        '/' +
        relative(BUILD, file)
            .split(sep)
            .join('/')
            .replace(/\.html$/, '');
    return route === '/index' ? '/' : route;
}

const escapeXml = (value) =>
    value.replace(
        /[<>&'"]/g,
        (c) => `&${{ '<': 'lt', '>': 'gt', '&': 'amp', "'": 'apos', '"': 'quot' }[c]};`
    );

const rendered = (await htmlFiles(BUILD)).map((file) => {
    const html = readFileSync(file, 'utf8');
    return { file, html, pathname: pathnameOf(file), hasContent: /<h1[\s>]/.test(html) };
});

/**
 * The shells are linked from every page's sidebar, so they get crawled anyway,
 * and a crawler that runs the script finds the same empty state under the same
 * site-wide fallback title on each of them: one thin page, many times over.
 *
 * The tag has to be in the HTML as served. A crawler that finds `noindex` there
 * skips rendering, and one that never runs scripts would never see it if the
 * app added it after load.
 */
const NOINDEX = '<meta name="robots" content="noindex" />';
for (const page of rendered) {
    if (page.hasContent || page.html.includes('name="robots"')) continue;
    writeFileSync(
        page.file,
        page.html.replace(
            /([ \t]*)<\/head>/,
            (_, indent) => `${indent}    ${NOINDEX}\n${indent}</head>`
        )
    );
}

const pages = rendered
    // The SPA fallback is served for addresses that don't exist. It is not one.
    .filter((page) => page.hasContent && !page.file.endsWith('404.html'))
    .map(({ html, pathname }) => ({
        pathname,
        title: tag(html, /<title>([^<]*)<\/title>/),
        description: tag(html, /<meta\s+name="description"\s+content="([^"]*)"/),
    }));

if (pages.length === 0) {
    throw new Error('No rendered page found in build/ — refusing to write an empty sitemap.');
}

// The home page first, then the rest alphabetically, which is how they are
// linked: /sources before the ten guides it is the index of.
pages.sort((a, b) =>
    a.pathname === '/' ? -1 : b.pathname === '/' ? 1 : a.pathname.localeCompare(b.pathname)
);

// No <lastmod>. The only date known here is the build's, and a date that moves
// on every deploy whether or not the page did teaches crawlers to ignore the
// field — for this site and for any accurate date it might carry later.
writeFileSync(
    join(BUILD, 'sitemap.xml'),
    `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${pages
    .map(
        (page) =>
            `\t<url>\n\t\t<loc>${escapeXml(SITE_URL + (page.pathname === '/' ? '/' : page.pathname))}</loc>\n\t</url>`
    )
    .join('\n')}
</urlset>
`
);

// llms.txt: the same set of pages, as prose an assistant can read in one fetch
// instead of crawling. https://llmstxt.org
writeFileSync(
    join(BUILD, 'llms.txt'),
    `# Buho

> Buho charts personal-data exports — Spotify, Last.fm, Deezer, Google Timeline, Google Activity, Garmin, Strava, WhatsApp, Messenger, Instagram — entirely inside the visitor's browser.

Drop an archive on the page and it is parsed, loaded into an in-browser database and charted there. There is no account, no server to send anything to, and nothing is written to disk or to browser storage: closing the tab is how you delete your data. That constraint is the product, not an implementation detail.

Each dataset has two views: a guided read-through and an explorer with cross-filtering. Those live behind the import and hold nothing until you have given them a file, so the pages worth reading are these:

## Pages

${pages
    .map(
        (page) =>
            `- [${page.title ?? page.pathname}](${SITE_URL}${page.pathname})${page.description ? `: ${page.description}` : ''}`
    )
    .join('\n')}
`
);

console.log(`SEO: sitemap.xml and llms.txt written for ${pages.length} pages.`);
