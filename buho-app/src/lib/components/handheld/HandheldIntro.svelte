<script lang="ts">
    import { resolve } from '$app/paths';
    import ChevronRight from '@lucide/svelte/icons/chevron-right';
    import Icon from '#lib/components/Icon.svelte';
    import { DATA_MODULES } from '#lib/data/modules.ts';
    import type { CatalogSource } from '#lib/data/sources/catalog.ts';
    import { sourcesForPhone } from '#lib/onboarding/funnel.ts';
    import BigScreenNote from './BigScreenNote.svelte';

    /**
     * The door, on a phone.
     *
     * The desktop door leads into a funnel that ends in a drop zone and an
     * Explorer, neither of which a phone is good at. This one has two jobs
     * instead: get the export started (most take hours or days, and asking for
     * one is something a phone does perfectly well), and hand the visit over to
     * a computer. The guides stay open here: they are read by scrolling, and
     * their animated views play on their own.
     */
    interface Props {
        /** Opens that export's how-to, the funnel's second step. */
        onPick: (source: CatalogSource) => void;
        /** The full list of exports, the funnel's first step. */
        onBrowse: () => void;
        /** The desktop door, for whoever wants it at phone size. */
        onExploreAnyway: () => void;
    }

    let { onPick, onBrowse, onExploreAnyway }: Props = $props();

    const sources = sourcesForPhone().slice(0, 5);

    /** Only the guides that can run on the sample: nobody arrives here with data. */
    const guides = DATA_MODULES.filter((module) => module.guide && module.hasDemo);

    function lowerFirst(text: string): string {
        return text.charAt(0).toLowerCase() + text.slice(1);
    }

    /** When it lands, said for someone holding a phone. */
    function whenLine(source: CatalogSource): string {
        if (source.madeOnPhone) return 'Made on this phone, in a minute or two';
        if (source.wait === 'instant') return 'Immediate, from a web page';
        return `Ask now: ${lowerFirst(source.delay)}`;
    }
</script>

<div class="intro">
    <section class="lede">
        <h1>Spotify Wrapped on steroids.</h1>
        <p class="sub">
            <span class="line">For Spotify, but also Google, WhatsApp, Strava, Garmin…</span>
            <span class="line">Dive deeper into your personal data exports.</span>
        </p>
        <p class="promise">
            <span class="dot" aria-hidden="true"></span>Nothing is uploaded. It all runs in your
            browser.
        </p>
    </section>

    <BigScreenNote title="Made for a big screen" surface="intro">
        Look around here. To explore your own data, with search, filters and every chart side by
        side, open Buho on a computer.
    </BigScreenNote>

    <section class="start" aria-labelledby="start-title">
        <h2 id="start-title">Start your export now</h2>
        <p class="sub">
            Most services take a while to answer. Ask from your phone today, and the file will be
            waiting when you sit down at a computer.
        </p>
        <ul class="list">
            {#each sources as source (source.id)}
                <li>
                    <button type="button" class="row" onclick={() => onPick(source)}>
                        <span class="glyph"><Icon name={source.icon} size={18} /></span>
                        <span class="text">
                            <span class="name">{source.label}</span>
                            <span class="when" class:now={source.madeOnPhone}>
                                {whenLine(source)}
                            </span>
                        </span>
                        <ChevronRight size={18} aria-hidden="true" />
                    </button>
                </li>
            {/each}
            <li>
                <button type="button" class="row all" onclick={onBrowse}>
                    Every export Buho reads →
                </button>
            </li>
        </ul>
    </section>

    {#if guides.length > 0}
        <section class="guides" aria-labelledby="guides-title">
            <h2 id="guides-title">Or read a story</h2>
            <p class="sub">
                The guides scroll like an article and read well on a phone. Load the sample history
                from there to see one before you bring your own.
            </p>
            {#each guides as module (module.id)}
                {#if module.guide}
                    <a class="guide" href={resolve(module.guide)} data-module={module.id}>
                        <span class="badge"><Icon name={module.icon} size={20} /></span>
                        <span class="text">
                            <span class="name">The {module.label.toLowerCase()} guide</span>
                            <span class="when">{module.blurb}</span>
                        </span>
                        <ChevronRight size={18} aria-hidden="true" />
                    </a>
                {/if}
            {/each}
        </section>
    {/if}

    <p class="anyway">
        <button type="button" onclick={onExploreAnyway}>Explore anyway, at phone size</button>
    </p>
</div>

<style>
    .intro {
        display: flex;
        flex-direction: column;
        gap: 2.25rem;
    }

    .lede {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
    }

    h1 {
        margin: 0;
        font-size: 2rem;
        line-height: 1.12;
        text-wrap: balance;
    }

    h2 {
        margin: 0;
        font-size: var(--text-heading);
        line-height: 1.3;
    }

    .sub {
        margin: 0;
        font-size: var(--text-lede);
        line-height: 1.6;
        color: hsl(var(--muted-foreground));
    }

    .line {
        display: block;
    }

    .promise {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        margin: 0;
        font-size: var(--text-body);
        font-weight: 600;
        color: hsl(var(--owl));
    }

    .dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: currentColor;
    }

    .start,
    .guides {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
    }

    .list {
        margin: 0.25rem 0 0;
        padding: 0;
        list-style: none;
        border: 1px solid hsl(var(--border));
        border-radius: var(--radius-lg);
        background: hsl(var(--card));
        overflow: hidden;
    }

    .list li + li {
        border-top: 1px solid hsl(var(--border));
    }

    .row {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        width: 100%;
        min-height: 60px;
        padding: 0 0.9rem;
        text-align: left;
        color: hsl(var(--foreground));
        cursor: pointer;
    }

    .row.all {
        justify-content: center;
        min-height: 52px;
        font-size: var(--text-body);
        color: hsl(var(--muted-foreground));
    }

    .glyph {
        display: flex;
        align-items: center;
        justify-content: center;
        flex: none;
        width: 34px;
        height: 34px;
        border-radius: var(--radius-md);
        background: hsl(var(--secondary));
        color: hsl(var(--foreground));
    }

    .text {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        line-height: 1.35;
    }

    .name {
        font-weight: 600;
    }

    .when {
        font-size: var(--text-small);
        color: hsl(var(--muted-foreground));
    }

    .when.now {
        font-weight: 500;
        color: hsl(var(--owl));
    }

    .guide {
        display: flex;
        align-items: center;
        gap: 0.9rem;
        min-height: 72px;
        padding: 0.75rem 0.9rem;
        border: 1px solid hsl(var(--border));
        border-radius: var(--radius-lg);
        background: hsl(var(--card));
        color: hsl(var(--foreground));
        text-decoration: none;
    }

    .badge {
        display: flex;
        align-items: center;
        justify-content: center;
        flex: none;
        width: 44px;
        height: 44px;
        border-radius: 50%;
        background: color-mix(in srgb, var(--module-accent) 14%, transparent);
        color: var(--module-accent);
    }

    .anyway {
        margin: 0;
        text-align: center;
    }

    .anyway button {
        min-height: 44px;
        font-size: var(--text-small);
        color: hsl(var(--muted-foreground));
        text-decoration: underline;
        text-underline-offset: 4px;
        cursor: pointer;
    }
</style>
