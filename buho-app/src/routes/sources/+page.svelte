<script lang="ts">
    import { resolve } from '$app/paths';
    import NetworkIcon from '#lib/components/NetworkIcon.svelte';
    import Icon from '#lib/components/Icon.svelte';
    import Seo from '#lib/components/Seo.svelte';
    import { CATALOG_SOURCES, modulesFilledBy } from '#lib/data/sources/catalog.ts';
    import { SITE_URL } from '#lib/seo.ts';
    import { DATA_MODULES } from '#lib/data/modules.ts';
    import { dataStore } from '#lib/stores/dataStore.svelte.ts';

    /**
     * The map, and only the map: which export feeds which dataset.
     *
     * How to get hold of one, what arrives and which of it is opened is a
     * per-export question, answered at length on `/sources/[source]` — every
     * row of the matrix is the way in.
     */
    const loadedModules = $derived(DATA_MODULES.filter((module) => dataStore.loaded[module.id]));

    /**
     * The matrix as a list, so the page is answerable without reading a table.
     *
     * A table is the right shape for a person comparing ten exports at a glance
     * and the wrong one for anything parsing the page: the relationship it
     * encodes lives in the intersection of a row and a column, which survives
     * no extraction. Stated here once, in the same order the table renders.
     */
    const matrixLd = {
        '@context': 'https://schema.org',
        '@type': 'ItemList',
        name: 'Data exports Buho reads',
        itemListElement: CATALOG_SOURCES.map((source, index) => ({
            '@type': 'ListItem',
            position: index + 1,
            item: {
                '@type': 'Dataset',
                name: `${source.label} export`,
                description: `${source.request}. ${source.format}, ${source.delay}. Fills ${modulesFilledBy(
                    source
                )
                    .map((module) => module.label)
                    .join(', ')}.`,
                url: `${SITE_URL}/sources/${source.id}`,
            },
        })),
    };
</script>

<Seo
    title="Every export Buho reads, and what it takes from each"
    description="Spotify, Last.fm, Deezer, Google Timeline, Google Activity, Garmin, Strava, WhatsApp, Messenger and Instagram — which export fills which dataset, and how to get hold of one."
    jsonLd={matrixLd}
/>

<div class="page">
    <header class="intro">
        <h1>Sources &amp; modules</h1>
        <p class="lede">
            Buho reads exports from services you already use, and sorts what it finds into a handful
            of datasets. The two aren't a one-to-one match: one export can fill two datasets, and
            one dataset can be fed by several exports. Here is the whole map.
        </p>
        <p class="promise">
            All of it happens in your browser. Your files are never uploaded.
            <a href="{resolve('faq')}#verify">How to check</a>
        </p>
    </header>

    <section aria-labelledby="matrix-heading">
        <h2 id="matrix-heading">What feeds what</h2>
        <p class="section-lede">
            Rows are the exports you can get hold of; columns are what Buho builds from them — and
            the icons in the sidebar, in the same order. Follow a row to find out how to request
            that export, what arrives, and which of it is opened.
            {#if loadedModules.length > 0}
                <span class="live">
                    Holding data right now: {loadedModules
                        .map((module) => module.label)
                        .join(', ')}.
                </span>
            {:else}
                <span class="live">Nothing is loaded yet.</span>
            {/if}
        </p>

        <div class="matrix-scroll">
            <table class="matrix">
                <thead>
                    <tr>
                        <th scope="col" class="corner">
                            <span class="corner-source">Source ↓</span>
                            <span class="corner-module">Module →</span>
                        </th>
                        {#each DATA_MODULES as module (module.id)}
                            {@const loaded = dataStore.loaded[module.id]}
                            <th scope="col" class="module-head" data-module={module.id}>
                                <a class="module-link" href={resolve(module.href)}>
                                    <span class="module-glyph" class:loaded>
                                        <Icon name={module.icon} size={18} />
                                    </span>
                                    <span class="module-label">{module.label}</span>
                                </a>
                                <span class="module-state" class:loaded>
                                    {loaded ? 'holds data' : 'empty'}
                                </span>
                            </th>
                        {/each}
                    </tr>
                </thead>
                <tbody>
                    {#each CATALOG_SOURCES as source (source.id)}
                        <tr>
                            <th scope="row" class="source-head">
                                <a
                                    class="source-link"
                                    href={resolve('/sources/[source]', {
                                        source: source.id,
                                    })}
                                >
                                    {#if source.network}
                                        <NetworkIcon network={source.network} size={18} />
                                    {:else}
                                        <Icon name={source.icon} size={18} />
                                    {/if}
                                    <span>{source.label}</span>
                                </a>
                                <span class="source-format">{source.format}</span>
                            </th>
                            {#each DATA_MODULES as module (module.id)}
                                {@const fill = source.fills[module.id]}
                                <td class="cell" data-module={module.id}>
                                    {#if fill}
                                        <span class="grain" title={fill.detail}>
                                            <span class="dot"></span>
                                            {fill.grain}
                                        </span>
                                    {:else}
                                        <span class="none" aria-hidden="true">–</span>
                                        <span class="sr-only">not provided</span>
                                    {/if}
                                </td>
                            {/each}
                        </tr>
                    {/each}
                </tbody>
            </table>
        </div>

        <dl class="module-legend">
            {#each DATA_MODULES as module (module.id)}
                <div data-module={module.id}>
                    <dt>{module.label}</dt>
                    <dd>{module.blurb}</dd>
                </div>
            {/each}
        </dl>
    </section>

    <footer>
        <a href={resolve('faq')}>Is my data uploaded? And other questions →</a>
    </footer>
</div>

<style>
    /* The same five roles as /sources/[source]: the two pages are one place,
       and ten font sizes across them was the reason neither felt like it. */
    .page {
        /* Wider than the prose it sits above, which keeps its own 46rem cap:
           the matrix is the page, and it is seven columns wide. */
        max-width: 72rem;
        margin: 0 auto;
        padding: 3rem 1.5rem 5rem;
    }

    footer {
        padding-top: 1.5rem;
        border-top: 1px solid hsl(var(--border));
        font-size: var(--text-small);
    }

    footer a {
        color: hsl(var(--muted-foreground));
        transition: color 0.15s;
    }

    footer a:hover {
        color: hsl(var(--foreground));
    }

    .sr-only {
        position: absolute;
        width: 1px;
        height: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        white-space: nowrap;
    }

    .intro {
        margin-bottom: 3rem;
    }

    h1 {
        font-size: var(--text-title);
        margin: 0 0 0.75rem;
    }

    .lede {
        max-width: 46rem;
        font-size: var(--text-body);
        line-height: 1.6;
        color: hsl(var(--muted-foreground));
        margin: 0;
    }

    .promise {
        margin: 0.75rem 0 0;
        font-size: var(--text-body);
        font-weight: 600;
        color: hsl(var(--foreground));
    }

    .promise a {
        margin-left: 0.35rem;
        font-weight: 400;
        color: hsl(var(--muted-foreground));
        text-decoration: underline;
        text-underline-offset: 3px;
        text-decoration-thickness: 1px;
    }

    .promise a:hover {
        color: hsl(var(--foreground));
    }

    section {
        margin-bottom: 3.5rem;
    }

    h2 {
        font-size: var(--text-subheading);
        margin: 0 0 0.375rem;
    }

    .section-lede {
        max-width: 46rem;
        margin: 0 0 1.5rem;
        font-size: var(--text-body);
        line-height: 1.6;
        color: hsl(var(--muted-foreground));
    }

    .live {
        color: hsl(var(--foreground));
    }

    /* ---- matrix ---------------------------------------------------------- */

    /* The safety net, not the plan: the cells below are sized so seven columns
       fit a laptop without it. It catches a phone, and a browser zoomed in. */
    .matrix-scroll {
        overflow-x: auto;
        border: 1px solid hsl(var(--border));
        border-radius: var(--radius-md);
        background: hsl(var(--card));
    }

    .matrix {
        width: 100%;
        border-collapse: collapse;
        font-size: var(--text-body);
    }

    /*
     * Columns shared out rather than measured, everywhere there is room for
     * seven of them.
     *
     * Left to size itself, the table asks for what its longest line wants —
     * "message_1.json files, in one or more .zip" on one line is a 24rem source
     * column on its own — and seven columns of that run off the side of a laptop.
     * Sharing the width out is what makes the whole map visible at once, which is
     * the only reason the page exists. Below the breakpoint there is no width to
     * share and the scroller takes over.
     */
    @media (min-width: 768px) {
        .matrix {
            table-layout: fixed;
        }

        .corner {
            width: 17%;
        }

        .module-head {
            width: 13.8%;
        }
    }

    .matrix th,
    .matrix td {
        padding: 0.55rem 0.625rem;
        text-align: left;
        vertical-align: top;
        border-bottom: 1px solid hsl(var(--border));
    }

    .matrix tbody tr:last-child th,
    .matrix tbody tr:last-child td {
        border-bottom: none;
    }

    .corner {
        white-space: nowrap;
        font-weight: 600;
        font-size: var(--text-label);
        color: hsl(var(--muted-foreground));
    }

    .corner-source,
    .corner-module {
        display: block;
    }

    .corner-module {
        margin-left: 1.25rem;
    }

    /* Six of these across. The floor is what a two-word label needs once it
       wraps under its own glyph — "Google activity" is the one that decides it. */
    .module-head {
        min-width: 6.25rem;
        background: color-mix(in srgb, var(--module-accent) 6%, transparent);
    }

    .module-link {
        display: flex;
        align-items: center;
        gap: 0.4rem;
        text-decoration: none;
        color: hsl(var(--foreground));
        font-weight: 600;
    }

    .module-link:hover .module-label {
        text-decoration: underline;
        text-underline-offset: 2px;
    }

    /* Grey until the module holds something, matching the sidebar icon. */
    .module-glyph {
        display: inline-flex;
        color: hsl(var(--muted-foreground));
    }

    .module-glyph.loaded {
        color: var(--module-accent);
    }

    .module-state {
        display: block;
        margin-top: 0.2rem;
        font-size: var(--text-label);
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: hsl(var(--muted-foreground));
    }

    .module-state.loaded {
        color: var(--module-accent);
    }

    .source-head {
        min-width: 9rem;
    }

    .source-link {
        display: flex;
        align-items: center;
        gap: 0.45rem;
        font-weight: 600;
        color: hsl(var(--foreground));
        text-decoration: none;
    }

    .source-link:hover {
        text-decoration: underline;
        text-underline-offset: 2px;
    }

    .source-format {
        display: block;
        margin-top: 0.2rem;
        font-size: var(--text-label);
        font-weight: 400;
        color: hsl(var(--muted-foreground));
    }

    .grain {
        display: inline-flex;
        align-items: center;
        gap: 0.35rem;
        font-size: var(--text-small);
        padding: 0.15rem 0.5rem 0.15rem 0.4rem;
        border-radius: var(--radius-pill);
        border: 1px solid color-mix(in srgb, var(--module-accent) 35%, transparent);
        background: color-mix(in srgb, var(--module-accent) 12%, transparent);
        cursor: help;
    }

    .dot {
        width: 0.4rem;
        height: 0.4rem;
        border-radius: 50%;
        background: var(--module-accent);
        flex: none;
    }

    .none {
        color: hsl(var(--muted-foreground) / 0.5);
    }

    .module-legend {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
        gap: 1rem;
        margin: 1.25rem 0 0;
    }

    .module-legend dt {
        font-size: var(--text-small);
        font-weight: 600;
        padding-left: 0.6rem;
        border-left: 3px solid var(--module-accent);
    }

    .module-legend dd {
        margin: 0.3rem 0 0 0.6rem;
        font-size: var(--text-small);
        line-height: 1.5;
        color: hsl(var(--muted-foreground));
    }

    @media (max-width: 767px) {
        .page {
            padding: 2rem 1rem 5rem;
        }
        h1 {
            font-size: var(--text-figure);
        }
    }
</style>
