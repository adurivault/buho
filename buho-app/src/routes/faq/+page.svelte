<script lang="ts">
    import { resolve } from '$app/paths';
    import Seo from '#lib/components/Seo.svelte';
    import { entryText, FAQ_ENTRIES, FAQ_GROUPS } from '#lib/faq.ts';
    import { FEEDBACK_EMAIL, FEEDBACK_HREF } from '#lib/feedback.ts';
    import { plainText, SITE_URL } from '#lib/seo.ts';

    /**
     * The same answers again, for search engines and assistants. `plainText`
     * because those parsers render no markup: a link would arrive as angle
     * brackets in the middle of a sentence.
     */
    const faqLd = {
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        url: `${SITE_URL}/faq`,
        mainEntity: FAQ_ENTRIES.map((entry) => ({
            '@type': 'Question',
            name: entry.question,
            acceptedAnswer: {
                '@type': 'Answer',
                text: plainText(entryText(entry)),
            },
        })),
    };
</script>

<Seo
    title="FAQ: is Buho safe, and other questions"
    description="Your files never leave your browser. How to check it, which exports Buho reads, how to get your Google Timeline, and more."
    jsonLd={faqLd}
/>

<div class="page">
    <header class="intro">
        <h1>FAQ</h1>
    </header>

    {#each FAQ_GROUPS as group (group.id)}
        <section aria-labelledby="{group.id}-heading">
            <h2 id="{group.id}-heading">{group.title}</h2>

            {#each group.entries as entry (entry.id)}
                <article id={entry.id}>
                    <h3>
                        <a href="#{entry.id}">{entry.question}</a>
                    </h3>

                    {#each entry.answer as paragraph, index (index)}
                        <!-- eslint-disable-next-line svelte/no-at-html-tags -- literals from lib/faq.ts, never user data -->
                        <p>{@html paragraph}</p>
                    {/each}

                    {#if entry.bullets}
                        <ul>
                            {#each entry.bullets as bullet, index (index)}
                                <!-- eslint-disable-next-line svelte/no-at-html-tags -- literals from lib/faq.ts, never user data -->
                                <li>{@html bullet}</li>
                            {/each}
                        </ul>
                    {/if}

                    {#each entry.after ?? [] as paragraph, index (index)}
                        <!-- eslint-disable-next-line svelte/no-at-html-tags -- literals from lib/faq.ts, never user data -->
                        <p>{@html paragraph}</p>
                    {/each}

                    {#if entry.links}
                        <p class="onward">
                            {#each entry.links as link (link.href)}
                                <a href={resolve(link.href)}>{link.label} →</a>
                            {/each}
                        </p>
                    {/if}
                </article>
            {/each}
        </section>
    {/each}

    <footer>
        <p>Another question? <a href={FEEDBACK_HREF}>{FEEDBACK_EMAIL}</a></p>
    </footer>
</div>

<style>
    .page {
        max-width: 46rem;
        margin: 0 auto;
        padding: 3rem 1.5rem 5rem;
        font-size: var(--text-body);
        color: hsl(var(--foreground));
    }

    .intro {
        margin-bottom: 2.5rem;
    }

    h1 {
        font-size: var(--text-title);
        margin: 0;
    }

    /* A group title is a label over a list, not a second title. */
    h2 {
        margin: 0 0 1.5rem;
        padding-top: 1.5rem;
        border-top: 1px solid hsl(var(--border));
        font-family: inherit;
        font-size: var(--text-label);
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: hsl(var(--muted-foreground));
    }

    section + section {
        margin-top: 2.5rem;
    }

    article {
        margin-bottom: 2rem;
        /* An anchored answer should not land with its question under the top
           edge of the window. */
        scroll-margin-top: 1.5rem;
    }

    h3 {
        margin: 0 0 0.5rem;
        font-size: var(--text-subheading);
        font-weight: 600;
        color: hsl(var(--heading));
    }

    /* The question is its own anchor, but a page of underlined questions reads
       as navigation: the underline only comes on hover. */
    h3 a {
        color: inherit;
    }

    h3 a:hover {
        text-decoration: underline;
        text-underline-offset: 4px;
        text-decoration-color: hsl(var(--muted-foreground) / 0.5);
    }

    p {
        margin: 0 0 0.6rem;
        line-height: 1.65;
        color: hsl(var(--muted-foreground));
    }

    ul {
        margin: 0 0 0.6rem;
        padding-left: 1.1rem;
        line-height: 1.65;
        color: hsl(var(--muted-foreground));
    }

    li {
        margin-bottom: 0.35rem;
    }

    li::marker {
        color: hsl(var(--border));
    }

    /* The answers arrive through `{@html}`, which Svelte does not scope: a
       scoped ancestor with a global descendant reaches them without the rule
       leaking out of this page. */
    article :global(strong) {
        color: hsl(var(--foreground));
        font-weight: 600;
    }

    article :global(code) {
        font-family: var(--font-mono);
        font-size: 0.92em;
        padding: 0.05em 0.3em;
        border-radius: var(--radius-sm);
        background: hsl(var(--card));
        border: 1px solid hsl(var(--border));
    }

    article p :global(a),
    article li :global(a),
    .onward a,
    footer a {
        color: hsl(var(--foreground));
        text-decoration: underline;
        text-underline-offset: 3px;
        text-decoration-thickness: 1px;
        text-decoration-color: hsl(var(--muted-foreground) / 0.6);
    }

    article p :global(a:hover),
    article li :global(a:hover),
    .onward a:hover,
    footer a:hover {
        text-decoration-color: currentColor;
    }

    .onward {
        display: flex;
        flex-wrap: wrap;
        gap: 0.4rem 1.25rem;
        margin-top: 0.75rem;
        font-size: var(--text-small);
    }

    footer {
        margin-top: 3rem;
        padding-top: 1.5rem;
        border-top: 1px solid hsl(var(--border));
        font-size: var(--text-small);
    }
</style>
