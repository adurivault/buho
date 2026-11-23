<script lang="ts">
    import { resolve } from '$app/paths';
    import Clock from '@lucide/svelte/icons/clock';
    import Icon from '#lib/components/Icon.svelte';
    import NetworkIcon from '#lib/components/NetworkIcon.svelte';
    import Seo from '#lib/components/Seo.svelte';
    import SourceHowTo from '#lib/components/SourceHowTo.svelte';
    import DropZone from '#lib/components/DropZone.svelte';
    import { modulesFilledBy, sourcesFilling } from '#lib/data/sources/catalog.ts';
    import { DATA_MODULES } from '#lib/data/modules.ts';
    import { dataStore } from '#lib/stores/dataStore.svelte.ts';
    import { plainText, SITE_URL } from '#lib/seo.ts';
    import type { PageProps } from './$types';

    /**
     * How to get one export, and where to put it. Nothing else.
     *
     * What a module is for is the module's own page to say, and it is one link
     * away; which file inside the archive holds what is something nobody has to
     * sort out, since every file is routed by what is inside it.
     */
    let { data }: PageProps = $props();

    const source = $derived(data.source);
    const modules = $derived(modulesFilledBy(source));

    /**
     * Every other export once, under the first dataset it feeds, quickest
     * first — the /sources page in miniature.
     */
    const others = $derived(
        DATA_MODULES.map((module) => ({
            module,
            sources: sourcesFilling(module.id).filter(
                (candidate) =>
                    candidate.id !== source.id && modulesFilledBy(candidate)[0].id === module.id
            ),
        })).filter((group) => group.sources.length > 0)
    );

    /**
     * The steps again, as structured data.
     *
     * Google Timeline's steps differ by phone and Messenger's by download, so
     * those are flattened with the platform or download named on the front: a
     * single numbered list mixing iOS and Android steps would be instructions
     * nobody can follow.
     */
    const steps = $derived.by(() => {
        const { guide } = source;
        if (guide.platforms) {
            return guide.platforms.flatMap((platform) =>
                platform.steps.map((step) => `${platform.label}: ${plainText(step)}`)
            );
        }
        if (guide.downloads) {
            return guide.downloads.flatMap((download) =>
                download.steps.map((step) => `${download.title}: ${plainText(step)}`)
            );
        }
        return guide.steps.map((step) => plainText(step));
    });

    const howToLd = $derived({
        '@context': 'https://schema.org',
        '@type': 'HowTo',
        name: `How to export your ${source.label} data`,
        description: plainText(source.guide.intro),
        url: `${SITE_URL}/sources/${source.id}`,
        step: steps.map((text, index) => ({
            '@type': 'HowToStep',
            position: index + 1,
            text,
        })),
    });
</script>

<Seo
    title="How to export your {source.label} data — Buho"
    description={source.metaDescription}
    jsonLd={howToLd}
/>

<!--
    One colour for the whole page: its subject is a service, which has no
    colour in Buho. Module accents appear only where they stand for a dataset —
    the dots beside the datasets this export feeds, the same legend as the
    sidebar and /sources.
-->
<div class="page">
    <nav class="crumb" aria-label="Breadcrumb">
        <a href={resolve('sources')}>Sources</a>
        <span aria-hidden="true">/</span>
        <span aria-current="page">{source.label}</span>
    </nav>

    <header class="intro">
        <h1>
            {#if source.network}
                <NetworkIcon network={source.network} size={28} />
            {:else}
                <Icon name={source.icon} size={28} />
            {/if}
            {source.label}
        </h1>

        <p class="lede">{source.guide.intro}</p>

        <!-- The wait first: it decides whether this is a five-minute job or a
             five-day one. -->
        <ul class="facts" aria-label="What to expect">
            <li class="wait">
                <Clock size={14} strokeWidth={2} aria-hidden="true" />
                {source.delay}
            </li>
            <li>{source.format}</li>
            <li>{source.size}</li>
        </ul>

        <p class="destination">
            Its data goes into{#each modules as module, index (module.id)}{index === 0
                    ? ' '
                    : index === modules.length - 1
                      ? ' and '
                      : ', '}<span class="module" data-module={module.id}>
                    <span class="dot"></span><a class="module-link" href={resolve(module.href)}>
                        {module.label}
                    </a>
                </span>{/each}.
            {#if modules.some((module) => dataStore.loaded[module.id])}
                <span class="live">Already loaded.</span>
            {/if}
        </p>
    </header>

    <SourceHowTo {source} intro={false} headingLevel={2}>
        {#snippet drop()}
            <div class="handover">
                <DropZone surface="source-page" expected={source.id} />
            </div>
        {/snippet}
    </SourceHowTo>

    <footer class="others">
        <p class="others-title">Other exports</p>
        <dl class="others-grid">
            {#each others as group (group.module.id)}
                <div data-module={group.module.id}>
                    <dt><span class="dot"></span>{group.module.label}</dt>
                    <dd>
                        <ul>
                            {#each group.sources as other (other.id)}
                                <li>
                                    <a href={resolve('/sources/[source]', { source: other.id })}>
                                        {#if other.network}
                                            <NetworkIcon network={other.network} size={15} />
                                        {:else}
                                            <Icon name={other.icon} size={15} />
                                        {/if}
                                        {other.label}
                                    </a>
                                </li>
                            {/each}
                        </ul>
                    </dd>
                </div>
            {/each}
        </dl>
    </footer>
</div>

<style>
    /*
     * One type scale for the whole page: title, subheading (the stages), lede,
     * body, small and label. A new bit of text takes the closest of these
     * rather than a seventh size.
     */
    .page {
        max-width: 46rem;
        margin: 0 auto;
        padding: 2.5rem 1.5rem 5rem;
        font-size: var(--text-body);
    }

    .crumb {
        display: flex;
        gap: 0.4rem;
        margin-bottom: 1.25rem;
        font-size: var(--text-small);
        color: hsl(var(--muted-foreground));
    }

    .crumb a {
        color: inherit;
        text-decoration: underline;
        text-underline-offset: 3px;
        text-decoration-thickness: 1px;
        text-decoration-color: hsl(var(--muted-foreground) / 0.6);
    }

    .crumb a:hover {
        color: hsl(var(--foreground));
        text-decoration-color: currentColor;
    }

    .intro {
        margin-bottom: 2.5rem;
    }

    h1 {
        display: flex;
        align-items: center;
        gap: 0.6rem;
        margin: 0 0 0.5rem;
        font-size: var(--text-title);
        letter-spacing: -0.015em;
    }

    .lede {
        max-width: 40rem;
        margin: 0;
        font-size: var(--text-lede);
        line-height: 1.6;
    }

    .facts {
        display: flex;
        flex-wrap: wrap;
        gap: 0.4rem;
        margin: 1.1rem 0 0;
        padding: 0;
        list-style: none;
    }

    .facts li {
        display: inline-flex;
        align-items: center;
        gap: 0.35rem;
        padding: 0.18rem 0.65rem;
        border: 1px solid hsl(var(--border));
        border-radius: var(--radius-pill);
        background: hsl(var(--card));
        font-size: var(--text-small);
    }

    .facts .wait {
        border-color: hsl(var(--border-strong));
        font-weight: 600;
    }

    .destination {
        margin: 0.75rem 0 0;
        font-size: var(--text-small);
        line-height: 1.7;
        color: hsl(var(--muted-foreground));
    }

    .module {
        white-space: nowrap;
    }

    .module-link {
        font-weight: 600;
        color: hsl(var(--foreground));
        text-decoration: underline;
        text-underline-offset: 3px;
        text-decoration-color: color-mix(in srgb, var(--module-accent) 75%, transparent);
        text-decoration-thickness: 2px;
    }

    .module-link:hover {
        text-decoration-color: var(--module-accent);
    }

    .dot {
        display: inline-block;
        flex: none;
        width: 0.45rem;
        height: 0.45rem;
        margin-right: 0.3rem;
        border-radius: 50%;
        background: var(--module-accent);
        vertical-align: 0.08em;
    }

    .live {
        color: hsl(var(--foreground));
        font-weight: 600;
    }

    .handover {
        width: 100%;
    }

    /* ---- other exports ------------------------------------------------- */

    .others {
        margin-top: 3.5rem;
        padding-top: 1.25rem;
        border-top: 1px solid hsl(var(--border));
    }

    .others-title {
        margin: 0;
        font-size: var(--text-label);
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: hsl(var(--muted-foreground));
    }

    /* Dataset in one column, its exports in the other, so every row starts on
       the same edge whatever the dataset is called. */
    .others-grid {
        display: grid;
        grid-template-columns: max-content minmax(0, 1fr);
        column-gap: 1.5rem;
        row-gap: 0.5rem;
        margin: 0.75rem 0 0;
        align-items: baseline;
    }

    .others-grid div {
        display: contents;
    }

    .others-grid dt {
        display: inline-flex;
        align-items: center;
        font-size: var(--text-small);
        color: hsl(var(--muted-foreground));
    }

    .others-grid dd {
        margin: 0;
    }

    .others-grid ul {
        display: flex;
        flex-wrap: wrap;
        gap: 0.3rem 1.1rem;
        margin: 0;
        padding: 0;
        list-style: none;
    }

    .others-grid a {
        display: inline-flex;
        align-items: center;
        gap: 0.35rem;
        color: hsl(var(--foreground));
        text-decoration: underline;
        text-underline-offset: 3px;
        text-decoration-thickness: 1px;
        text-decoration-color: hsl(var(--border-strong));
    }

    .others-grid a:hover {
        text-decoration-color: currentColor;
    }

    @media (max-width: 767px) {
        .page {
            padding: 1.5rem 1rem 5rem;
        }

        h1 {
            font-size: var(--text-figure);
        }

        .others-grid {
            grid-template-columns: 1fr;
            row-gap: 0.25rem;
        }

        .others-grid dd {
            margin-bottom: 0.5rem;
        }
    }
</style>
