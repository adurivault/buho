/**
 * What the pages that are meant to be found say about themselves.
 *
 * Only three routes are in here, and that is the whole point. `/` and the
 * `/sources` pages are prose — they answer "what is this" and "how do I get my
 * export out of Spotify", which are questions people type into search engines
 * and, increasingly, ask an assistant. Every other route is an application
 * surface over data that only exists in the visitor's tab; with nothing
 * imported it has nothing to say to anybody, indexer included.
 */

/** The origin every canonical and card URL is built against. */
export const SITE_URL = 'https://buho-app.com';

/** A site-relative path as the one address search engines should keep. */
export function canonicalUrl(pathname: string): string {
    // Trailing slash only for the root, matching what adapter-static writes and
    // what the links in the app resolve to: two spellings of one page is the
    // duplicate a canonical exists to prevent.
    const path = pathname.replace(/\/+$/, '');
    return `${SITE_URL}${path || '/'}`;
}

/**
 * The catalog writes its guides with inline `<em>`/`<strong>` for emphasis.
 * Structured data is read by machines that render no markup, so it gets the
 * words alone.
 */
export function plainText(html: string): string {
    return html
        .replace(/<[^>]*>/g, '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&#39;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/&nbsp;/g, ' ')
        .replace(/&(rsquo|lsquo);/g, "'")
        .replace(/&(rdquo|ldquo);/g, '"')
        .replace(/&mdash;/g, '—')
        .replace(/&ndash;/g, '–')
        .replace(/&hellip;/g, '…')
        .replace(/&rarr;/g, '→')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * JSON-LD, serialized for a `<script type="application/ld+json">`.
 *
 * `<` is escaped because a `</script>` anywhere in the data would otherwise end
 * the block early and spill the rest of the graph into the page as text. The
 * strings here come from the catalog rather than from anything a visitor typed,
 * but a serializer that is only safe for today's inputs is not safe.
 */
export function jsonLdScript(data: unknown): string {
    return JSON.stringify(data).replace(/</g, '\\u003c');
}
