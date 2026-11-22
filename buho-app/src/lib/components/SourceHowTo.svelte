<script lang="ts">
    import type { CatalogSource } from '#lib/data/sources/catalog.ts';
    import { trackEvent } from '#lib/analytics.ts';

    /**
     * How to get one export: where to go, the settings that decide whether the
     * file is usable, and what to do in order.
     *
     * Shared by the import dialog and the per-source page under /sources, which
     * would otherwise render every guide twice and drift. Whichever
     * one you are looking at, the words come from `catalog.ts`.
     *
     * Two things it deliberately does not do any more:
     *
     *   - **The destination is a link, not a button.** It used to be a filled
     *     accent pill, which reads as an in-app action; people did not know it
     *     would take them to another site. It now shows where it goes.
     *   - **The step numbers are numbers.** They were white numerals in filled
     *     accent discs, which made a four-item list the heaviest thing on the
     *     page — heavier than the heading above it, and it arrived last.
     */
    interface Props {
        source: CatalogSource;
    }

    /*
     * The numbers and the link take `--module-accent`: the module's colour in
     * the import dialog, which opens from inside a module and wears it — there
     * it means "you are in Listening" — and the neutral ink everywhere else.
     * Where the subject is the export rather than the dataset, a source has no
     * colour of its own, and borrowing the accent of whatever module it feeds
     * would read as a brand colour that is simply wrong.
     */
    let { source }: Props = $props();

    /** For the one guide whose steps differ by device — see SourceGuide.platforms. */
    let platform = $state<string>('android');

    const steps = $derived.by(() => {
        const platforms = source.guide.platforms;
        if (!platforms?.length) return source.guide.steps;
        return (platforms.find((p) => p.id === platform) ?? platforms[0]).steps;
    });

    /**
     * The click that leaves Buho, on its way to the provider's export page.
     *
     * The last thing we can see of an import that has not happened yet: the page
     * context says where the guide was read (a module's import dialog, /sources,
     * onboarding), `service` says which export was asked for, and `link` tells
     * the main destination from the second download a few services split across.
     */
    function trackExit(link: 'export' | 'extra') {
        trackEvent('export-open', { service: source.id, link });
    }

    /** What makes a link look like one: saying where it lands. */
    function host(href: string): string {
        try {
            return new URL(href).hostname.replace(/^www\./, '');
        } catch {
            return '';
        }
    }
</script>

<div class="howto">
    <p class="intro">{source.guide.intro}</p>

    {#if source.link}
        <a
            class="go"
            href={source.link.href}
            target="_blank"
            rel="noreferrer"
            onclick={() => trackExit('export')}
        >
            <span class="go-label">{source.link.label}</span>
            <span class="go-host">{host(source.link.href)} ↗</span>
        </a>
    {/if}

    {#if source.guide.platforms}
        <div class="tabs" role="tablist" aria-label="Phone platform">
            {#each source.guide.platforms as tab (tab.id)}
                <button
                    role="tab"
                    aria-selected={platform === tab.id}
                    class:selected={platform === tab.id}
                    onclick={() => (platform = tab.id)}
                >
                    {tab.label}
                </button>
            {/each}
        </div>
    {/if}

    <ol class="steps">
        {#each steps as instruction, index (index)}
            <li>
                <!-- Literals from the catalog, for the inline emphasis — never
                     anything user-derived. -->
                <!-- eslint-disable-next-line svelte/no-at-html-tags -- static catalog/SEO content, never user data -->
                <span>{@html instruction}</span>
            </li>
        {/each}
    </ol>

    {#if source.guide.settings}
        <div class="settings">
            <p class="settings-title">Get these right</p>
            <dl>
                {#each source.guide.settings as setting (setting.label)}
                    <div>
                        <dt>{setting.label}</dt>
                        <dd class="value">{setting.value}</dd>
                        {#if setting.note}
                            <dd class="note">{setting.note}</dd>
                        {/if}
                    </div>
                {/each}
            </dl>
        </div>
    {/if}

    {#if source.guide.extra}
        <div class="extra">
            <p class="extra-title">{source.guide.extra.title}</p>
            <!-- eslint-disable-next-line svelte/no-at-html-tags -- static catalog/SEO content, never user data -->
            <p class="extra-body">{@html source.guide.extra.body}</p>
            <a
                class="go"
                href={source.guide.extra.href}
                target="_blank"
                rel="noreferrer"
                onclick={() => trackExit('extra')}
            >
                <span class="go-label">{source.guide.extra.label}</span>
                <span class="go-host">{host(source.guide.extra.href)} ↗</span>
            </a>
        </div>
    {/if}

    {#if source.guide.warning}
        <!-- eslint-disable-next-line svelte/no-at-html-tags -- static catalog/SEO content, never user data -->
        <p class="warning">{@html source.guide.warning}</p>
    {/if}
</div>

<style>
    /* Falls back to its own values so the import dialog, which has no type
       scale of its own, renders the same as the page does. */
    .howto {
        font-size: var(--text-body);
        line-height: 1.6;
    }

    .intro {
        margin: 0;
        color: hsl(var(--muted-foreground));
    }

    /* Bordered and quiet, with the destination spelled out. A filled pill was
       read as "do the thing", not "leave this page". */
    .go {
        display: inline-flex;
        align-items: baseline;
        flex-wrap: wrap;
        gap: 0.5rem;
        margin-top: 1rem;
        padding: 0.5rem 0.85rem;
        border: 1px solid color-mix(in srgb, var(--module-accent) 45%, transparent);
        border-radius: var(--radius-pill);
        text-decoration: none;
        transition:
            border-color 0.15s,
            background-color 0.15s;
    }

    .go:hover {
        border-color: var(--module-accent);
        background: color-mix(in srgb, var(--module-accent) 8%, transparent);
    }

    .go-label {
        color: var(--module-accent);
        font-weight: 600;
        text-decoration: underline;
        text-underline-offset: 3px;
    }

    .go-host {
        font-family: var(--font-mono);
        font-size: var(--text-small);
        color: hsl(var(--muted-foreground));
    }

    .tabs {
        display: inline-flex;
        margin-top: 1rem;
        padding: 0.125rem;
        border: 1px solid hsl(var(--border));
        border-radius: var(--radius-pill);
        background: hsl(var(--secondary) / 0.4);
        font-size: var(--text-small);
    }

    .tabs button {
        border-radius: var(--radius-pill);
        padding: 0.25rem 0.75rem;
        cursor: pointer;
        transition: background-color 0.15s;
    }

    .tabs button.selected {
        background: hsl(var(--background));
        color: hsl(var(--foreground));
        font-weight: 600;
    }

    /* Numerals in the accent colour, on a rule. The list is the point of the
       page, so it earns the space — but by being long, not by being loud. */
    .steps {
        counter-reset: step;
        margin: 1.25rem 0 0;
        padding: 0 0 0 0.9rem;
        border-left: 1px solid hsl(var(--border));
        list-style: none;
        display: flex;
        flex-direction: column;
        gap: 0.7rem;
    }

    .steps li {
        counter-increment: step;
        display: grid;
        grid-template-columns: 1.35rem 1fr;
        align-items: baseline;
        gap: 0.35rem;
    }

    .steps li::before {
        content: counter(step) '.';
        font-family: var(--font-mono);
        font-size: var(--text-small);
        font-weight: 600;
        color: var(--module-accent);
    }

    .settings,
    .extra {
        margin-top: 1.25rem;
        padding: 0.75rem 0.9rem;
        border: 1px solid hsl(var(--border));
        border-radius: var(--radius-md);
        background: hsl(var(--card));
    }

    .settings-title,
    .extra-title {
        margin: 0;
        font-size: var(--text-label);
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: hsl(var(--muted-foreground));
    }

    /*
     * One label column, one value column, whatever the settings say.
     *
     * They used to flow inline and wrap, with each note breaking to a new line
     * inside its own group: the second setting started wherever the first
     * happened to end, and its note landed under the middle of the row it
     * belonged to. Three settings, three different left edges.
     */
    .settings dl {
        display: grid;
        grid-template-columns: max-content 1fr;
        column-gap: 0.75rem;
        row-gap: 0.35rem;
        margin: 0.55rem 0 0;
        align-items: baseline;
    }

    .settings dl div {
        display: contents;
    }

    .settings dt {
        color: hsl(var(--muted-foreground));
    }

    .settings dt::after {
        content: ' ·';
    }

    .value {
        margin: 0;
        font-weight: 600;
        color: var(--module-accent);
    }

    /* Under the value it qualifies, in the value column — never under the
       label, which is not what it is about. */
    .note {
        grid-column: 2;
        margin: 0;
        font-size: var(--text-small);
        line-height: 1.5;
        color: hsl(var(--muted-foreground));
    }

    .extra-title {
        font-size: var(--text-body);
        text-transform: none;
        letter-spacing: 0;
        color: hsl(var(--foreground));
    }

    .extra-body {
        margin: 0.35rem 0 0;
        color: hsl(var(--muted-foreground));
    }

    .extra .go {
        margin-top: 0.75rem;
    }

    .warning {
        margin: 1.25rem 0 0;
        padding: 0.7rem 0.9rem;
        border-left: 3px solid color-mix(in srgb, var(--module-accent) 55%, transparent);
        background: hsl(var(--secondary) / 0.4);
        color: hsl(var(--muted-foreground));
    }
</style>
