import { error } from '@sveltejs/kit';
import { CATALOG_SOURCES } from '#lib/data/sources/catalog.ts';
import type { EntryGenerator, PageLoad } from './$types';

/**
 * One page per export, from the catalog.
 *
 * Listed rather than crawled: the site prerenders with `ssr = false`, so the
 * crawler sees a shell with no links in it and would emit nothing. Adding a
 * source to `CATALOG_SOURCES` is enough to get its page built.
 */
/** Content, not a session: rendered on the server. See `/+page.ts`. */
export const ssr = true;

export const entries: EntryGenerator = () =>
    CATALOG_SOURCES.map((source) => ({ source: source.id }));

export const load: PageLoad = ({ params }) => {
    const source = CATALOG_SOURCES.find((candidate) => candidate.id === params.source);
    if (!source) error(404, `Buho doesn't read an export called "${params.source}".`);
    return { source };
};
