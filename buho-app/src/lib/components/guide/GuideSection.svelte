<script lang="ts">
    import type { Snippet } from "svelte";
    import InfoHint from "$lib/components/InfoHint.svelte";
    import { sectionView } from "$lib/actions/sectionView";

    /**
     * One narrated chart in a guide: an anchor, a heading, the methodology note
     * behind the "?", and the reading-progress marker — the four things every
     * section repeated by hand.
     */
    interface Props {
        /** Anchor and analytics id, e.g. "messages-rhythm". */
        id: string;
        title: string;
        /** Shown behind the "?" next to the heading. */
        hint?: string;
        children: Snippet;
    }

    let { id, title, hint, children }: Props = $props();
</script>

<section class="viz" {id} use:sectionView={id}>
    <h2>
        {title}
        {#if hint}
            <InfoHint text={hint} />
        {/if}
    </h2>
    {@render children()}
</section>
