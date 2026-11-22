<script lang="ts">
    import Shot from '#lib/components/Shot.svelte';
    import type { Preview } from '#lib/shots.ts';

    /**
     * What a page draws once it holds data, shown while it holds none: the
     * main chart in a card, and a second chart of another kind laid over its
     * corner, both from the demo.
     *
     * Framed lightly — a border, the card radius, a faint light behind in the
     * page's module colour — so it reads as a glimpse of the page rather than
     * as an advertisement for it.
     *
     * Its width follows the window's height through `--preview-max-height`,
     * which the page sets, so on a short window the picture shrinks instead of
     * the page scrolling.
     */
    interface Props {
        preview: Preview;
        /** What the main chart is, for its alternative text. */
        name: string;
    }

    let { preview, name }: Props = $props();
</script>

<div class="stage">
    <figure class="card main">
        <Shot shot={preview.main} alt="{name}, drawn from demo data" />
    </figure>
    <figure class="card side">
        <Shot shot={preview.side} />
    </figure>
</div>

<style>
    .stage {
        position: relative;
        width: min(100%, calc(var(--preview-max-height, 100vh) * 1.25));
        aspect-ratio: 5 / 4;
        margin: 0 auto;
    }

    .stage::before {
        content: '';
        position: absolute;
        inset: -8% -6%;
        background: radial-gradient(
            closest-side,
            color-mix(in srgb, var(--module-fill) 16%, transparent),
            transparent
        );
        pointer-events: none;
    }

    .card {
        position: absolute;
        margin: 0;
        overflow: hidden;
        border: 1px solid hsl(var(--border));
        border-radius: var(--radius-lg);
        background: hsl(var(--card));
    }

    .main {
        top: 0;
        right: 0;
        width: 84%;
        aspect-ratio: 3 / 2;
    }

    /* The card's foot is where the crop cuts the chart: it eases out there
       rather than stopping on a hard line. */
    .main :global(img) {
        mask-image: linear-gradient(to bottom, black 88%, transparent);
    }

    /* A ring of the page's own background keeps the two cards apart where
       they overlap. */
    .side {
        bottom: 0;
        left: 0;
        width: 42%;
        aspect-ratio: 1;
        box-shadow: 0 0 0 4px hsl(var(--background));
    }
</style>
