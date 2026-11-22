<script lang="ts">
    import { asset } from '$app/paths';
    import type { DataModule } from '#lib/data/modules.ts';

    /**
     * A module's explorer as the demo draws it: one chart, captured in each
     * theme by `npm run shots`, shown before anything is loaded.
     *
     * The captures are files rather than charts drawn live, so a page whose
     * point is that nothing is loaded yet does not boot DuckDB to say so. Both
     * themes are in the markup and the stylesheet shows the one matching
     * `.dark` on <html>; the other is lazy and never displayed, so it is never
     * fetched until the theme changes.
     *
     * `card` is the module welcome's: framed, glowing in the module's colour,
     * labelled as demo data and cropped with a fade, so it reads as the start
     * of something larger. `tile` is the bare picture a home tile frames
     * itself.
     */
    interface Props {
        module: DataModule;
        variant?: 'card' | 'tile';
    }

    let { module, variant = 'card' }: Props = $props();

    /** A tile's link is named by its caption, so its picture says nothing. */
    const alt = $derived(
        variant === 'tile' ? '' : `${module.label} explorer, drawn from demo data`
    );
</script>

<figure class="preview {variant}" data-module={module.id}>
    <div class="frame">
        <img
            class="shot shot-light"
            src={asset(`shots/${module.id}-light.webp`)}
            {alt}
            loading="lazy"
            decoding="async"
        />
        <img
            class="shot shot-dark"
            src={asset(`shots/${module.id}-dark.webp`)}
            {alt}
            loading="lazy"
            decoding="async"
        />
    </div>
    {#if variant === 'card'}
        <figcaption class="label"><span class="dot" aria-hidden="true"></span>Demo data</figcaption>
    {/if}
</figure>

<style>
    .preview {
        position: relative;
        margin: 0;
    }

    .frame {
        position: relative;
        overflow: hidden;
        width: 100%;
        height: 100%;
        background: hsl(var(--card));
    }

    .shot {
        display: block;
        width: 100%;
        height: 100%;
        object-fit: cover;
    }

    :global(.dark) .shot-light,
    :global(html:not(.dark)) .shot-dark {
        display: none;
    }

    /* The welcome's card. The page caps its height by the window's through
       `--preview-max-height`, so on a short one the picture is cropped further
       rather than the page scrolling. */
    .card {
        width: 100%;
        aspect-ratio: 3 / 2;
        max-height: var(--preview-max-height, none);
    }

    /* The module's colour, as light behind the card rather than paint on it. */
    .card::before {
        content: '';
        position: absolute;
        inset: -12% -10%;
        background: radial-gradient(
            closest-side,
            color-mix(in srgb, var(--module-fill) 32%, transparent),
            transparent
        );
        pointer-events: none;
    }

    .card .frame {
        border: 1px solid hsl(var(--border));
        border-radius: var(--radius-lg);
    }

    /* The chart starts at its top-left corner, as on the page; where the crop
       cuts it, on the right and at the foot, it fades into the card. */
    .card .shot {
        object-position: left top;
        mask-image:
            linear-gradient(to right, black 82%, transparent),
            linear-gradient(to bottom, black 78%, transparent);
        mask-composite: intersect;
    }

    .label {
        position: absolute;
        top: 0.6rem;
        right: 0.6rem;
        display: inline-flex;
        align-items: center;
        gap: 0.4rem;
        padding: 0.2rem 0.55rem;
        border: 1px solid hsl(var(--border));
        border-radius: var(--radius-pill);
        background: hsl(var(--card));
        font-family: var(--font-mono);
        font-size: var(--text-label);
        color: hsl(var(--muted-foreground));
    }

    .dot {
        width: 0.4rem;
        height: 0.4rem;
        border-radius: 50%;
        background: var(--module-peak);
    }

    /* A tile fills whatever box its parent gives it, and shows the busiest
       part of the chart: the day, not the night at its top. */
    .tile {
        width: 100%;
        height: 100%;
    }

    .tile .shot {
        object-position: 30% 55%;
    }
</style>
