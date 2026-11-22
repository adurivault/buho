<script lang="ts">
    import { resolve } from '$app/paths';
    import { trackEvent } from '#lib/analytics.ts';
    import type { DataModule } from '#lib/data/modules.ts';
    import { exploreAnyway } from '#lib/stores/deviceStore.svelte.ts';
    import BigScreenNote from './BigScreenNote.svelte';

    /**
     * What a phone gets in place of an Explorer.
     *
     * The Explorers are linked charts read with a pointer — hover readouts,
     * brushes, slices to click — and at phone width they are cramped at best.
     * This says what the Explorer is and offers the two ways on: the link to open it on a computer, and the module's
     * guide, which is read by scrolling and works here. The Explorer itself stays
     * one tap away for whoever wants it anyway.
     */
    interface Props {
        module: DataModule;
    }

    let { module }: Props = $props();

    function anyway() {
        trackEvent('explore-anyway', { surface: 'explorer-poster', module: module.id });
        exploreAnyway();
    }
</script>

<div class="poster" data-module={module.id}>
    <section class="about">
        <h1>The {module.label.toLowerCase()} explorer</h1>
        <p class="blurb">{module.blurb}</p>
        <p class="blurb">
            On a computer it lays every chart side by side, made to be read with a mouse on a wide
            screen.
        </p>
    </section>

    <BigScreenNote title="This one needs a bigger screen" surface="explorer-poster">
        Send yourself the link and open it on a computer.
    </BigScreenNote>

    <div class="ways">
        {#if module.guide}
            <a class="guide" href={resolve(module.guide)}>
                Read the {module.label.toLowerCase()} guide instead
            </a>
        {/if}
        <button type="button" class="anyway" onclick={anyway}>Explore anyway, at phone size</button>
    </div>
</div>

<style>
    .poster {
        display: flex;
        flex-direction: column;
        gap: 1.5rem;
        max-width: 32rem;
        margin: 0 auto;
        padding: 1.25rem 1rem 2rem;
    }

    .about {
        display: flex;
        flex-direction: column;
        gap: 0.6rem;
    }

    h1 {
        margin: 0;
        font-size: 1.5rem;
        line-height: 1.25;
    }

    .blurb {
        margin: 0;
        font-size: var(--text-body);
        line-height: 1.6;
        color: hsl(var(--muted-foreground));
    }

    .ways {
        display: flex;
        flex-direction: column;
        align-items: stretch;
        gap: 0.5rem;
    }

    .guide {
        display: flex;
        align-items: center;
        justify-content: center;
        min-height: 48px;
        padding: 0 1.25rem;
        border: 1px solid hsl(var(--border));
        border-radius: var(--radius-pill);
        font-size: var(--text-lede);
        font-weight: 600;
        color: var(--module-accent);
        text-decoration: none;
    }

    .anyway {
        min-height: 44px;
        font-size: var(--text-small);
        color: hsl(var(--muted-foreground));
        text-decoration: underline;
        text-underline-offset: 4px;
        cursor: pointer;
    }
</style>
