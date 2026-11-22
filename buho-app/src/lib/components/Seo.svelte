<script lang="ts">
    import { page } from '$app/state';
    import { canonicalUrl, jsonLdScript } from '#lib/seo.ts';

    /**
     * One page's head: what it is called, what it is about, and where it lives.
     *
     * `app.html` carries the same set as a site-wide fallback, for the routes
     * that render no head of their own. This block is emitted into
     * `%sveltekit.head%`, which sits *above* those defaults, so a page that uses
     * this component wins every tag it sets — first title, first description
     * and first card values are the ones parsers keep. The card *image* is not
     * among them: it is the same picture on every page, and app.html states its
     * dimensions, which scrapers need before they have fetched it.
     */
    interface Props {
        title: string;
        description: string;
        /** Structured data for this page, if it has a shape worth declaring. */
        jsonLd?: unknown;
    }

    let { title, description, jsonLd }: Props = $props();

    const canonical = $derived(canonicalUrl(page.url.pathname));
</script>

<svelte:head>
    <title>{title}</title>
    <meta name="description" content={description} />
    <link rel="canonical" href={canonical} />

    <meta property="og:title" content={title} />
    <meta property="og:description" content={description} />
    <meta property="og:url" content={canonical} />

    <meta name="twitter:title" content={title} />
    <meta name="twitter:description" content={description} />

    {#if jsonLd}
        <!-- eslint-disable-next-line svelte/no-at-html-tags -- static catalog/SEO content, never user data -->
        <!-- `{@html}` because Svelte reserves a literal <script> in a component
             for the component's own instance code. -->
        <!-- eslint-disable-next-line svelte/no-at-html-tags -- static catalog/SEO content, never user data -->
        {@html `<script type="application/ld+json">${jsonLdScript(jsonLd)}</${''}script>`}
    {/if}
</svelte:head>
