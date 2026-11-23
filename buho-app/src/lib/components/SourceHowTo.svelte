<script lang="ts">
    import type { Snippet } from 'svelte';
    import type { CatalogSource, ExportLink } from '#lib/data/sources/catalog.ts';
    import { trackEvent } from '#lib/analytics.ts';

    /**
     * How to get one export, in the three stages every export goes through: get
     * it out of the service, wait for it, drop it into Buho.
     *
     * Shared by the import dialog, onboarding and the per-source page under
     * /sources, which would otherwise render every guide three times and drift.
     * Whichever one you are looking at, the words come from `catalog.ts`.
     *
     * The stages are headings because they are what a reader is looking for:
     * what to click, how long it takes, where the file goes. Each block sits in
     * the stage it is about — the settings above the steps that refer to them,
     * the drop advice beside the drop — and a stage carries one aside at most.
     *
     * The destination is a filled button carrying its host: it is the one thing
     * to do on arrival, and the host plus the arrow say it leaves Buho.
     */
    interface Props {
        source: CatalogSource;
        /** Whether to open with the export's intro; the source page states it under its title. */
        intro?: boolean;
        /** The level of the stage headings, under whatever heading the surface has. */
        headingLevel?: 2 | 3;
        /** The place the file goes, on a surface that holds one: stage three is then "here". */
        drop?: Snippet;
    }

    let { source, intro = true, headingLevel = 3, drop }: Props = $props();

    const guide = $derived(source.guide);
    const heading = $derived(`h${headingLevel}`);

    /** For the one guide whose steps differ by device — see SourceGuide.platforms. */
    let platform = $state<string>('android');

    const platformSteps = $derived.by(() => {
        const platforms = guide.platforms;
        if (!platforms?.length) return [];
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

{#snippet go(link: ExportLink, which: 'export' | 'extra')}
    <a
        class="go"
        href={link.href}
        target="_blank"
        rel="noreferrer"
        onclick={() => trackExit(which)}
    >
        <span class="go-label">{link.label}</span>
        <span class="go-host">{host(link.href)} ↗</span>
    </a>
{/snippet}

{#snippet stepList(steps: string[])}
    <ol class="steps">
        {#each steps as instruction, index (index)}
            <li>
                <!-- eslint-disable-next-line svelte/no-at-html-tags -- static catalog content, never user data -->
                <span>{@html instruction}</span>
            </li>
        {/each}
    </ol>
{/snippet}

{#snippet settings(title: string)}
    {#if guide.settings}
        <div class="settings">
            <p class="settings-title">{title}</p>
            <dl>
                {#each guide.settings as setting (setting.label)}
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
{/snippet}

{#snippet note(html: string)}
    <!-- eslint-disable-next-line svelte/no-at-html-tags -- static catalog content, never user data -->
    <p class="note-line">{@html html}</p>
{/snippet}

<div class="howto">
    {#if intro}
        <p class="intro">{guide.intro}</p>
    {/if}

    {#if guide.background}
        <section class="background">
            <svelte:element this={heading} class="background-title">
                {guide.background.title}
            </svelte:element>
            <ul>
                {#each guide.background.points as point, index (index)}
                    <!-- eslint-disable-next-line svelte/no-at-html-tags -- static catalog content, never user data -->
                    <li><span>{@html point}</span></li>
                {/each}
            </ul>
        </section>
    {/if}

    <ol class="stages">
        <li class="stage">
            <span class="stage-num">1</span>
            <div class="stage-main">
                <svelte:element this={heading} class="stage-title">{guide.get}</svelte:element>
                <div class="stage-body">
                    {#if guide.platforms}
                        <div class="tabs" role="tablist" aria-label="Phone platform">
                            {#each guide.platforms as tab (tab.id)}
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
                        {@render settings('Set these before exporting')}
                        {@render stepList(platformSteps)}
                    {:else if guide.downloads}
                        {@render settings('Set these on both forms')}
                        <div class="downloads">
                            {#each guide.downloads as download, index (download.link.href)}
                                <div class="download">
                                    <p class="download-tag">
                                        Download {index + 1} of {guide.downloads.length}
                                    </p>
                                    <p class="download-title">{download.title}</p>
                                    <!-- eslint-disable-next-line svelte/no-at-html-tags -- static catalog content, never user data -->
                                    <p class="download-body">{@html download.body}</p>
                                    {@render go(download.link, index === 0 ? 'export' : 'extra')}
                                    {@render stepList(download.steps)}
                                </div>
                            {/each}
                        </div>
                    {:else}
                        {#if source.link}
                            {@render go(source.link, 'export')}
                        {/if}
                        {@render settings('Set these before requesting')}
                        {@render stepList(guide.steps)}
                    {/if}

                    {#if guide.warning}
                        {@render note(guide.warning)}
                    {/if}
                </div>
            </div>
        </li>

        <li class="stage">
            <span class="stage-num">2</span>
            <div class="stage-main">
                <svelte:element this={heading} class="stage-title">
                    {guide.wait.title}
                </svelte:element>
                <div class="stage-body">
                    <!-- eslint-disable-next-line svelte/no-at-html-tags -- static catalog content, never user data -->
                    <p>{@html guide.wait.body}</p>
                </div>
            </div>
        </li>

        <li class="stage">
            <span class="stage-num">3</span>
            <div class="stage-main">
                <svelte:element this={heading} class="stage-title">
                    {drop ? 'Drop it here' : 'Drop it into Buho'}
                </svelte:element>
                <div class="stage-body">
                    {#if drop}
                        {@render drop()}
                    {:else}
                        <p>Drop the file as you received it. Buho recognises the export.</p>
                    {/if}
                    {#if guide.dropNote}
                        {@render note(guide.dropNote)}
                    {/if}
                </div>
            </div>
        </li>
    </ol>
</div>

<style>
    .howto {
        font-size: var(--text-body);
        line-height: 1.6;
    }

    .intro {
        margin: 0 0 1.25rem;
        color: hsl(var(--muted-foreground));
    }

    /* Context, not a stage: set apart on a quiet ground, before the numbers
       start. */
    .background {
        margin: 0 0 2rem;
        padding: 0.9rem 1.05rem;
        border-radius: var(--radius-md);
        background: hsl(var(--secondary) / 0.55);
    }

    .background-title {
        margin: 0 0 0.5rem;
        font-size: var(--text-body);
        font-weight: 700;
    }

    .background ul {
        display: flex;
        flex-direction: column;
        gap: 0.45rem;
        margin: 0;
        padding: 0;
        list-style: none;
    }

    .background li {
        display: grid;
        grid-template-columns: 0.9rem minmax(0, 1fr);
        line-height: 1.55;
    }

    .background li::before {
        content: '–';
        color: hsl(var(--muted-foreground));
    }

    /* ---- the three stages --------------------------------------------- */

    .stages {
        list-style: none;
        margin: 0;
        padding: 0;
    }

    /* Number in the gutter, a rule running down from it to the next one: the
       order is the information, so it is drawn rather than only numbered. */
    .stage {
        position: relative;
        display: grid;
        grid-template-columns: 2rem minmax(0, 1fr);
        column-gap: 1rem;
        padding-bottom: 2rem;
    }

    .stage:last-child {
        padding-bottom: 0;
    }

    .stage:not(:last-child)::before {
        content: '';
        position: absolute;
        left: calc(1rem - 0.5px);
        top: 2.25rem;
        bottom: 0.25rem;
        width: 1px;
        background: hsl(var(--border));
    }

    /* `--module-accent` is neutral ink on the source page and onboarding, and
       the module's colour in the import dialog, which opens from inside a
       module and wears it. */
    .stage-num {
        display: grid;
        place-items: center;
        width: 2rem;
        height: 2rem;
        border-radius: 50%;
        border: 1.5px solid var(--module-accent);
        color: var(--module-accent);
        font-family: var(--font-mono);
        font-size: var(--text-small);
        font-weight: 600;
    }

    .stage-main {
        min-width: 0;
    }

    .stage-title {
        margin: 0.2rem 0 0.75rem;
        font-size: var(--text-subheading);
        font-weight: 700;
        letter-spacing: -0.01em;
        line-height: 1.35;
    }

    .stage-body {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 0.9rem;
    }

    .stage-body > :global(*) {
        max-width: 100%;
    }

    .stage-body p {
        margin: 0;
    }

    /* ---- stage one ------------------------------------------------------ */

    .go {
        display: inline-flex;
        flex-wrap: wrap;
        align-items: baseline;
        gap: 0.2rem 0.6rem;
        padding: 0.5rem 1rem;
        border-radius: var(--radius-pill);
        background: hsl(var(--foreground));
        color: hsl(var(--background));
        font-weight: 600;
        text-decoration: none;
        transition: opacity 0.15s;
    }

    .go:hover {
        opacity: 0.88;
    }

    .go-host {
        font-family: var(--font-mono);
        font-size: var(--text-small);
        font-weight: 500;
        opacity: 0.75;
    }

    .tabs {
        display: inline-flex;
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

    /* Lettered, so they never read as a fourth and fifth stage. */
    .steps {
        counter-reset: step;
        margin: 0;
        padding: 0;
        list-style: none;
        display: flex;
        flex-direction: column;
        gap: 0.55rem;
    }

    .steps li {
        counter-increment: step;
        display: grid;
        grid-template-columns: 1.35rem minmax(0, 1fr);
        align-items: baseline;
        gap: 0.3rem;
    }

    .steps li::before {
        content: counter(step, lower-alpha) '.';
        font-family: var(--font-mono);
        font-size: var(--text-small);
        color: hsl(var(--muted-foreground));
    }

    /* The one card in a stage: settings decide whether the export is usable
       at all, so they are set apart from the steps around them. */
    .settings {
        width: 100%;
        padding: 0.75rem 0.9rem;
        border: 1px solid hsl(var(--border));
        border-radius: var(--radius-md);
        background: hsl(var(--card));
    }

    .settings-title,
    .download-tag {
        margin: 0;
        font-size: var(--text-label);
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: hsl(var(--muted-foreground));
    }

    /* One label column, one value column, the note under the value it
       qualifies — never under the label, which is not what it is about. */
    .settings dl {
        display: grid;
        grid-template-columns: max-content minmax(0, 1fr);
        column-gap: 0.9rem;
        row-gap: 0.3rem;
        margin: 0.5rem 0 0;
        align-items: baseline;
    }

    .settings dl div {
        display: contents;
    }

    .settings dt {
        color: hsl(var(--muted-foreground));
    }

    .value {
        margin: 0;
        font-weight: 600;
    }

    .note {
        grid-column: 2;
        margin: 0;
        font-size: var(--text-small);
        line-height: 1.5;
        color: hsl(var(--muted-foreground));
    }

    /* Side by side where there is room: the two downloads are equals, asked
       for in parallel, not a main one and an afterthought. */
    .downloads {
        width: 100%;
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
        gap: 0.75rem;
    }

    .download {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 0.6rem;
        min-width: 0;
        padding: 0.9rem;
        border: 1px solid hsl(var(--border));
        border-radius: var(--radius-md);
    }

    .download > :global(*) {
        max-width: 100%;
    }

    .download p {
        margin: 0;
    }

    .download-title {
        font-weight: 700;
        margin-top: -0.35rem !important;
    }

    .download-body {
        font-size: var(--text-small);
        color: hsl(var(--muted-foreground));
    }

    /* ---- notes ---------------------------------------------------------- */

    /* The one aside a stage may carry, in the one aside style. */
    .note-line {
        margin: 0;
        padding-left: 0.75rem;
        border-left: 2px solid hsl(var(--border-strong));
        color: hsl(var(--muted-foreground));
    }
</style>
