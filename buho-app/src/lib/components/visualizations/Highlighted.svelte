<script lang="ts">
    import { excerpt, highlight, type SearchTerm } from '#lib/explorer/search.ts';

    /**
     * A text with the search's hits marked, each in its term's color.
     *
     * The marks are the same matching as the filter, run again on just this
     * text: what is lit up here is exactly why the point counted.
     */
    interface Props {
        text: string;
        terms: readonly SearchTerm[];
        /** One color per term, in query order. */
        colors: readonly string[];
        /** Cut to the stretch around the first hit, for a row in a list. */
        short?: boolean;
    }

    let { text, terms, colors, short = false }: Props = $props();

    const segments = $derived.by(() => {
        const all = highlight(text, terms);
        return short ? excerpt(all) : all;
    });
</script>

{#each segments as segment, i (i)}{#if segment.term === -1}{segment.text}{:else}<mark
            style:--mark-color={colors[segment.term] ?? 'currentColor'}
        >
            {segment.text}
        </mark>{/if}{/each}

<style>
    mark {
        color: inherit;
        background: color-mix(in srgb, var(--mark-color) 32%, transparent);
        box-shadow: inset 0 -1.5px 0 var(--mark-color);
        border-radius: 0.2rem;
        padding: 0 0.05em;
    }
</style>
