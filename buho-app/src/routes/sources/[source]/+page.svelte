<script lang="ts">
    import { resolve } from '$app/paths';
    import Icon from '#lib/components/Icon.svelte';
    import NetworkIcon from '#lib/components/NetworkIcon.svelte';
    import Seo from '#lib/components/Seo.svelte';
    import SourceHowTo from '#lib/components/SourceHowTo.svelte';
    import DropZone from '#lib/components/DropZone.svelte';
    import { CATALOG_SOURCES, modulesFilledBy } from '#lib/data/sources/catalog.ts';
    import { dataStore } from '#lib/stores/dataStore.svelte.ts';
    import { plainText, SITE_URL } from '#lib/seo.ts';
    import type { PageProps } from './$types';

    /**
     * How to get one export, and where to put it. Nothing else.
     *
     * The page used to also describe the archive file by file and restate what
     * each module does with the rows — two reference sections, longer than the
     * steps, between somebody holding a zip and the place to drop it. What a
     * module is for is the module's own page to say, and it is one link away;
     * which file inside the archive holds what is something nobody has to sort
     * out, since every file is routed by what is inside it.
     */
    let { data }: PageProps = $props();

    const source = $derived(data.source);
    const modules = $derived(modulesFilledBy(source));
    const others = $derived(CATALOG_SOURCES.filter((candidate) => candidate.id !== source.id));

    /**
     * The steps again, as structured data.
     *
     * Google Timeline is the case that shapes this: its export moved into the
     * phone's settings and sits somewhere different on each platform, so the
     * guide carries `platforms` and leaves `steps` empty. Flattening those with
     * the platform's name on the front is the only honest reading — a single
     * numbered list mixing iOS and Android steps would be instructions nobody
     * can follow.
     */
    const steps = $derived(
        source.guide.steps.length > 0
            ? source.guide.steps.map((step) => ({ name: plainText(step) }))
            : (source.guide.platforms ?? []).flatMap((platform) =>
                  platform.steps.map((step) => ({
                      name: `${platform.label}: ${plainText(step)}`,
                  }))
              )
    );

    const howToLd = $derived({
        '@context': 'https://schema.org',
        '@type': 'HowTo',
        name: `How to export your ${source.label} data`,
        description: plainText(source.guide.intro),
        url: `${SITE_URL}/sources/${source.id}`,
        step: steps.map((step, index) => ({
            '@type': 'HowToStep',
            position: index + 1,
            text: step.name,
        })),
    });
</script>

<Seo
    title="How to export your {source.label} data — Buho"
    description={source.metaDescription}
    jsonLd={howToLd}
/>

<!--
    One colour for the whole page.

    It used to be tinted with the accent of the module this export feeds, which
    made the Deezer page green and the Instagram page red — a dataset's colour
    standing next to a service's name, where it can only be read as that
    service's brand. The module accents survive where they mean something: the
    dots beside "Fills Messages", which are the same legend as the sidebar and
    the /sources matrix, and are about the dataset, not this page's subject.
-->
<div class="page">
    <a class="back" href={resolve('sources')}>← All sources</a>

    <header class="intro">
        <h1>
            {#if source.network}
                <NetworkIcon network={source.network} size={28} />
            {:else}
                <Icon name={source.icon} size={28} />
            {/if}
            {source.label}
        </h1>

        <!--
            What to expect of the download, and where it ends up.

            Label column, value column, one row each: the three facts are a
            sentence long apiece and wildly uneven — "Hours" beside "message_1
            .json files, in one or more .zip" — so three equal columns left one
            reading as a stub and another wrapping twice.
        -->
        <div class="arrival">
            <dl class="facts">
                <div>
                    <!-- First, because it is what decides whether this is a
                         five-minute job or a five-day one. -->
                    <dt>Wait</dt>
                    <dd>{source.delay}</dd>
                </div>
                <div>
                    <dt>You get</dt>
                    <dd>{source.format}</dd>
                </div>
                <div>
                    <dt>Rough size</dt>
                    <dd>{source.size}</dd>
                </div>
            </dl>

            <!-- "Fills Listening" was a heading nobody had been taught to read.
                 The same fact, as a sentence, under the facts it belongs with. -->
            <p class="destination">
                Everything Buho reads out of it lands in{#each modules as module, index (module.id)}{index ===
                    0
                        ? ' '
                        : index === modules.length - 1
                          ? ' and '
                          : ', '}<span class="module" data-module={module.id}>
                        <span class="dot"></span><a class="module-link" href={resolve(module.href)}>
                            {module.label}
                        </a>
                    </span>{/each}.
                {#if modules.some((module) => dataStore.loaded[module.id])}
                    <span class="live">Which already holds data.</span>
                {/if}
            </p>
        </div>
    </header>

    <SourceHowTo {source} />

    {#if source.caveat}
        <p class="caveat">{source.caveat}</p>
    {/if}

    <!-- The last step of every guide is some wording of "drop it here", and
         until this zone existed there was no here. -->
    <div class="handover">
        <DropZone surface="source-page" expected={source.id} />
    </div>

    <footer class="outro">
        <p class="outro-lede">Another export</p>
        <ul class="others">
            {#each others as other (other.id)}
                <li>
                    <a href={resolve('/sources/[source]', { source: other.id })}>
                        {#if other.network}
                            <NetworkIcon network={other.network} size={16} />
                        {:else}
                            <Icon name={other.icon} size={16} />
                        {/if}
                        {other.label}
                    </a>
                </li>
            {/each}
        </ul>
    </footer>
</div>

<style>
    /*
     * One type scale for the whole page.
     *
     * There were eight distinct font sizes here, three weights and two
     * different uppercase treatments, and no two of them meant anything
     * different from each other — which is what "too many fonts, you don't know
     * where to look" is, mechanically. Five roles now, and a rule: if a new bit
     * of text does not fit one of them, the answer is to pick the closest, not
     * to add a sixth.
     */
    .page {
        max-width: 52rem;
        margin: 0 auto;
        padding: 2.5rem 1.5rem 5rem;
        font-size: var(--text-body);
    }

    /* The one small-caps treatment. Every subdivision on the page uses it, so
       that a label always looks like a label. */
    .facts dt,
    .outro-lede {
        font-size: var(--text-label);
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: hsl(var(--muted-foreground));
    }

    /*
     * Links look like links, everywhere on the page.
     *
     * A page whose whole job is to send you somewhere — to the provider, to the
     * dataset, to the next export — cannot afford links that only reveal
     * themselves under the cursor. Underlined from the start, and away from the
     * text so a descender never sits on the rule.
     */
    .back,
    .module-link {
        text-decoration: underline;
        text-underline-offset: 3px;
        text-decoration-thickness: 1px;
    }

    .back {
        display: inline-block;
        margin-bottom: 1.5rem;
        font-size: var(--text-small);
        color: hsl(var(--muted-foreground));
        text-decoration-color: hsl(var(--muted-foreground) / 0.6);
    }

    .back:hover {
        color: hsl(var(--foreground));
        text-decoration-color: currentColor;
    }

    h1 {
        display: flex;
        align-items: center;
        gap: 0.6rem;
        font-size: var(--text-title);
        margin: 0 0 1.25rem;
    }

    /* The dataset's own colour on the rule under its name — the same legend as
       the sidebar and the matrix, and the one place an accent belongs on a page
       whose subject is a service rather than a dataset. */
    .module {
        white-space: nowrap;
    }

    .module-link {
        font-weight: 600;
        color: hsl(var(--foreground));
        text-decoration-color: color-mix(in srgb, var(--module-accent) 75%, transparent);
        text-decoration-thickness: 2px;
    }

    .module-link:hover {
        text-decoration-color: var(--module-accent);
    }

    /* Outside the link, so the rule runs under the name and not under a
       floating disc. */
    .dot {
        display: inline-block;
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

    .arrival {
        margin: 0 0 2rem;
        padding: 0.875rem 1rem;
        border-radius: var(--radius-md);
        border: 1px solid hsl(var(--border));
        background: hsl(var(--card));
    }

    /* One label column for all three rows, so the values share a left edge
       instead of each starting wherever its own label ended. */
    .facts {
        display: grid;
        grid-template-columns: max-content 1fr;
        column-gap: 1.25rem;
        row-gap: 0.4rem;
        margin: 0;
        align-items: baseline;
    }

    .facts div {
        display: contents;
    }

    .facts dd {
        margin: 0;
        font-size: var(--text-body);
        line-height: 1.5;
    }

    .destination {
        margin: 0.85rem 0 0;
        padding-top: 0.75rem;
        border-top: 1px solid hsl(var(--border));
        font-size: var(--text-body);
        line-height: 1.7;
        color: hsl(var(--muted-foreground));
    }

    .caveat {
        margin: 1.5rem 0 0;
        padding: 0.7rem 0.85rem;
        border-radius: var(--radius-sm);
        border: 1px solid hsl(var(--border));
        border-left: 3px solid hsl(var(--foreground) / 0.45);
        background: hsl(var(--secondary) / 0.4);
        font-size: var(--text-body);
        line-height: 1.55;
    }

    .handover {
        margin-top: 2rem;
    }

    /* ---- outro ----------------------------------------------------------- */

    .outro {
        margin-top: 3rem;
        border-top: 1px solid hsl(var(--border));
        padding-top: 1.25rem;
    }

    .outro-lede {
        margin: 0 0 0.6rem;
    }

    .others {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-wrap: wrap;
        gap: 0.4rem;
    }

    /* Chips rather than underlined links: a row of them is a menu, and eight
       rules side by side is a fence. The border is what says "clickable" here,
       so it is the border that has to be visible without hovering. */
    .others a {
        display: inline-flex;
        align-items: center;
        gap: 0.4rem;
        padding: 0.3rem 0.7rem;
        border-radius: var(--radius-pill);
        border: 1px solid hsl(var(--border));
        background: hsl(var(--card));
        font-size: var(--text-small);
        font-weight: 500;
        color: hsl(var(--foreground));
        text-decoration: none;
        transition:
            color 0.15s,
            border-color 0.15s,
            background-color 0.15s;
    }

    .others a:hover {
        border-color: hsl(var(--foreground) / 0.5);
        background: hsl(var(--secondary) / 0.6);
    }

    @media (max-width: 767px) {
        .page {
            padding: 1.5rem 1rem 5rem;
        }
        h1 {
            font-size: var(--text-figure);
        }
    }
</style>
