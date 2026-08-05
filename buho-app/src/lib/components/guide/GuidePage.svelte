<script lang="ts">
    import type { Snippet } from "svelte";

    /**
     * The scrolling narration shared by every source's guide: a single reading
     * column, charts allowed to break out of it, and the handful of text styles
     * the sections use.
     *
     * The inner styles are `:global` but scoped under `.guide`, because the
     * sections are slotted in from the page and so carry the page's own style
     * scope rather than this component's.
     */
    interface Props {
        /** Source hue for accented details, e.g. "var(--accent-messages)". */
        accent: string;
        children: Snippet;
    }

    let { accent, children }: Props = $props();
</script>

<div class="guide" style:--guide-accent={accent}>
    {@render children()}
</div>

<style>
    .guide {
        width: 100%;
        margin: 0 auto;
        padding: 2rem 2rem 6rem;
        display: flex;
        flex-direction: column;
        gap: 4rem;
    }

    /* Charts span the full page width; the narrative text stays at a readable
       measure so lines don't stretch across the whole viewport. */
    .guide :global(.viz > h2),
    .guide :global(.viz > .coverage),
    .guide :global(.viz > p),
    .guide :global(> .empty) {
        max-width: 860px;
    }

    .guide :global(.viz h2) {
        font-size: 1.35rem;
        font-weight: 600;
        color: hsl(var(--foreground));
        margin: 0 0 1.25rem;
        display: flex;
        align-items: center;
        gap: 0.4rem;
    }

    /* A short factual aside under a heading: the number the chart is about to
       show, or the caveat that makes it readable. */
    .guide :global(.coverage) {
        font-size: 0.85rem;
        color: hsl(var(--muted-foreground));
        margin: 0 0 1.25rem;
        padding: 0.6rem 0.8rem;
        border-left: 2px solid var(--guide-accent, hsl(var(--foreground)));
        background: hsl(var(--secondary) / 0.3);
        border-radius: 0 0.4rem 0.4rem 0;
    }

    .guide :global(.coverage b) {
        color: hsl(var(--foreground));
        font-weight: 600;
    }

    .guide :global(.empty) {
        color: hsl(var(--muted-foreground));
        font-size: 0.9rem;
    }

    /* Break a chart out of the reading column to (nearly) the viewport. */
    .guide :global(.bleed) {
        width: min(100vw, 1500px);
        position: relative;
        left: 50%;
        transform: translateX(-50%);
        padding: 0 1.5rem;
        box-sizing: border-box;
    }

    /* Headline figures above a section. */
    .guide :global(.stats) {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 1.5rem 2rem;
        margin-bottom: 1.5rem;
        max-width: 1100px;
    }

    @media (min-width: 768px) {
        .guide :global(.stats) {
            grid-template-columns: repeat(4, 1fr);
        }
    }

    .guide :global(.stat .value) {
        font-size: 2.25rem;
        font-weight: 700;
        line-height: 1.1;
        font-variant-numeric: tabular-nums;
        color: hsl(var(--foreground));
    }

    .guide :global(.stat .label) {
        margin-top: 0.35rem;
        font-size: 0.8rem;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: hsl(var(--muted-foreground));
    }
</style>
