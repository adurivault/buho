<script lang="ts">
    import { shotSrc, type Shot } from '#lib/shots.ts';

    /**
     * One explorer capture, in whichever theme the page is in.
     *
     * Both themes are in the markup and the stylesheet shows the one matching
     * `.dark` on <html>. The other is lazy and never displayed, so it is not
     * fetched unless the theme changes. The picture fills the box its parent
     * gives it and is cropped round its `focus`.
     */
    interface Props {
        shot: Shot;
        /** Empty when the picture repeats what is written next to it. */
        alt?: string;
    }

    let { shot, alt = '' }: Props = $props();
</script>

<span class="shot">
    <img
        class="for-light"
        src={shotSrc(shot, 'light')}
        {alt}
        loading="lazy"
        decoding="async"
        style:object-position={shot.focus}
    />
    <img
        class="for-dark"
        src={shotSrc(shot, 'dark')}
        {alt}
        loading="lazy"
        decoding="async"
        style:object-position={shot.focus}
    />
    <!-- The licence notice belongs to the picture; a link around it is
         named by its own caption. -->
    {#if shot.credit}
        <small class="credit" aria-hidden="true">{shot.credit}</small>
    {/if}
</span>

<style>
    .shot {
        position: relative;
        display: block;
        width: 100%;
        height: 100%;
        overflow: hidden;
        background: hsl(var(--card));
    }

    img {
        display: block;
        width: 100%;
        height: 100%;
        object-fit: cover;
    }

    :global(.dark) .for-light,
    :global(html:not(.dark)) .for-dark {
        display: none;
    }

    .credit {
        position: absolute;
        right: 0;
        bottom: 0;
        max-width: 100%;
        padding: 0.1rem 0.4rem;
        border-top-left-radius: var(--radius-sm);
        background: hsl(var(--card) / 0.85);
        font-size: var(--text-label);
        line-height: 1.35;
        text-align: right;
        color: hsl(var(--muted-foreground));
    }
</style>
