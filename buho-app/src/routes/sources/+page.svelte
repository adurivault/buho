<script lang="ts">
    import { resolve } from '$app/paths';
    import NetworkIcon from '#lib/components/NetworkIcon.svelte';
    import Icon from '#lib/components/Icon.svelte';
    import Seo from '#lib/components/Seo.svelte';
    import {
        CATALOG_SOURCES,
        EXPORT_WAIT_ORDER,
        modulesFilledBy,
        sourcesFilling,
        type ExportWait,
    } from '#lib/data/sources/catalog.ts';
    import { SITE_URL } from '#lib/seo.ts';
    import { DATA_MODULES } from '#lib/data/modules.ts';
    import { dataStore } from '#lib/stores/dataStore.svelte.ts';

    /**
     * Which export feeds which dataset, read from the dataset's side.
     *
     * Someone arriving here wants to see their listening or their trips, and
     * the export is the means: so one panel per dataset, in sidebar order, and
     * in each the exports that fill it, quickest to get first. An export feeding
     * several datasets appears under each, naming the others, which keeps the
     * many-to-many relationship readable without a table.
     *
     * How to get hold of one, what arrives and which of it is opened is a
     * per-export question, answered on `/sources/[source]` — every row is the
     * way in.
     */

    /** How many of the four wait tiers a source's meter fills: one for instant, four for days. */
    const waitTier = (wait: ExportWait) => EXPORT_WAIT_ORDER.indexOf(wait) + 1;

    /**
     * The same relationship as a list, for anything parsing the page rather
     * than reading it. Stated once per export, in catalog order.
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
        <h1>Sources</h1>
        <p class="lede">
            Each panel is a dataset in Buho, with the exports that fill it. The quickest to get
            comes first.
        </p>
        <p class="promise">
            Your files are read in your browser and never uploaded.
            <a href="{resolve('faq')}#verify">How to check</a>
        </p>
    </header>

    <div class="panels">
        {#each DATA_MODULES as module (module.id)}
            {@const loaded = dataStore.loaded[module.id]}
            <section class="panel" data-module={module.id} aria-labelledby="module-{module.id}">
                <div class="panel-head">
                    <div class="panel-title">
                        <h2 id="module-{module.id}">
                            <a class="module-link" href={resolve(module.href)}>
                                <span class="module-glyph">
                                    <Icon name={module.icon} size={18} />
                                </span>
                                {module.label}
                            </a>
                        </h2>
                        <span class="module-state" class:loaded>
                            {loaded ? 'holds data' : 'empty'}
                        </span>
                    </div>
                    <p class="blurb">{module.blurb}</p>
                </div>

                <ul class="exports">
                    {#each sourcesFilling(module.id) as source (source.id)}
                        {@const alsoFeeds = modulesFilledBy(source).filter(
                            (other) => other.id !== module.id
                        )}
                        <li>
                            <a
                                class="export"
                                href={resolve('/sources/[source]', { source: source.id })}
                            >
                                <span class="export-glyph">
                                    {#if source.network}
                                        <NetworkIcon network={source.network} size={16} />
                                    {:else}
                                        <Icon name={source.icon} size={16} />
                                    {/if}
                                </span>
                                <span class="export-name">{source.label}</span>
                                <span class="export-wait">
                                    <span class="meter" aria-hidden="true">
                                        {#each EXPORT_WAIT_ORDER as tier, index (tier)}
                                            <i class:on={index < waitTier(source.wait)}></i>
                                        {/each}
                                    </span>
                                    {source.delay}
                                </span>
                                <span class="export-format">{source.format}</span>
                                {#if alsoFeeds.length > 0}
                                    <span class="export-also">
                                        Also feeds{#each alsoFeeds as other, index (other.id)}{index ===
                                            0
                                                ? ' '
                                                : ' and '}<span
                                                class="also-module"
                                                data-module={other.id}
                                            >
                                                <span class="dot"></span>{other.label}
                                            </span>{/each}
                                    </span>
                                {/if}
                            </a>
                        </li>
                    {/each}
                </ul>
            </section>
        {/each}
    </div>

    <footer>
        <a href={resolve('faq')}>Is my data uploaded? And other questions →</a>
    </footer>
</div>

<style>
    /* The same type roles as /sources/[source]: the two pages are one place. */
    .page {
        max-width: 72rem;
        margin: 0 auto;
        padding: 3rem 1.5rem 5rem;
    }

    .intro {
        margin-bottom: 2rem;
    }

    h1 {
        font-size: var(--text-title);
        letter-spacing: -0.015em;
        margin: 0 0 0.6rem;
    }

    .lede {
        max-width: 42rem;
        margin: 0;
        font-size: var(--text-lede);
        line-height: 1.6;
        color: hsl(var(--muted-foreground));
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

    /* ---- panels ---------------------------------------------------------- */

    /* Panels keep their own height: a dataset fed by one export is not
       stretched to match one fed by three. */
    .panels {
        display: grid;
        gap: 1rem;
        align-items: start;
        margin-bottom: 3.5rem;
    }

    @media (min-width: 700px) {
        .panels {
            grid-template-columns: repeat(2, minmax(0, 1fr));
        }
    }

    @media (min-width: 1040px) {
        .panels {
            grid-template-columns: repeat(3, minmax(0, 1fr));
        }
    }

    /* Each panel is a dataset, so it wears the dataset's colour: the same
       legend as the sidebar, the dots and the charts. */
    .panel {
        min-width: 0;
        overflow: hidden;
        border: 1px solid color-mix(in srgb, var(--module-accent) 28%, hsl(var(--border)));
        border-radius: var(--radius-md);
        background: hsl(var(--card));
    }

    .panel-head {
        padding: 0.8rem 0.95rem 0.75rem;
        border-bottom: 1px solid color-mix(in srgb, var(--module-accent) 28%, hsl(var(--border)));
        background: var(--module-soft);
    }

    .panel-title {
        display: flex;
        align-items: center;
        gap: 0.5rem;
    }

    h2 {
        margin: 0;
        font-size: var(--text-body);
        font-weight: 700;
    }

    .module-link {
        display: inline-flex;
        align-items: center;
        gap: 0.45rem;
        color: hsl(var(--foreground));
        text-decoration: none;
    }

    .module-link:hover {
        text-decoration: underline;
        text-underline-offset: 3px;
    }

    .module-glyph {
        display: inline-flex;
        color: var(--module-accent);
    }

    .module-state.loaded {
        color: var(--module-accent);
    }

    .module-state {
        margin-left: auto;
        font-size: var(--text-label);
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: hsl(var(--muted-foreground));
        white-space: nowrap;
    }

    .blurb {
        margin: 0.2rem 0 0;
        font-size: var(--text-small);
        line-height: 1.5;
        color: hsl(var(--muted-foreground));
    }

    .exports {
        margin: 0;
        padding: 0;
        list-style: none;
    }

    .exports li + li {
        border-top: 1px solid hsl(var(--border));
    }

    /* Name and wait on the first line, what arrives under the name: the wait is
       what decides, so it sits on the edge the eye runs down. */
    .export {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr) auto;
        column-gap: 0.55rem;
        row-gap: 0.1rem;
        align-items: center;
        padding: 0.65rem 0.95rem;
        color: hsl(var(--foreground));
        text-decoration: none;
        transition: background-color 0.15s;
    }

    .export:hover {
        background: color-mix(in srgb, var(--module-accent) 7%, transparent);
    }

    .export:hover .export-name {
        text-decoration: underline;
        text-underline-offset: 3px;
    }

    .export-glyph {
        display: inline-flex;
    }

    .export-name {
        font-size: var(--text-body);
        font-weight: 600;
        overflow-wrap: anywhere;
    }

    .export-wait {
        display: inline-flex;
        align-items: center;
        gap: 0.4rem;
        font-size: var(--text-small);
        white-space: nowrap;
    }

    .meter {
        display: inline-flex;
        gap: 2px;
    }

    .meter i {
        width: 4px;
        height: 0.7rem;
        border-radius: 1px;
        background: hsl(var(--border));
    }

    .meter i.on {
        background: var(--module-accent);
    }

    .export-format,
    .export-also {
        grid-column: 2 / 4;
        font-size: var(--text-small);
        line-height: 1.5;
        color: hsl(var(--muted-foreground));
    }

    .also-module {
        white-space: nowrap;
    }

    .dot {
        display: inline-block;
        width: 0.4rem;
        height: 0.4rem;
        margin-right: 0.25rem;
        border-radius: 50%;
        background: var(--module-accent);
        vertical-align: 0.08em;
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

    @media (max-width: 767px) {
        .page {
            padding: 2rem 1rem 5rem;
        }

        h1 {
            font-size: var(--text-figure);
        }
    }
</style>
