<script lang="ts">
    import DropZone from '#lib/components/DropZone.svelte';
    import { deviceStore } from '#lib/stores/deviceStore.svelte.ts';
    import SendLinkButton from '#lib/components/handheld/SendLinkButton.svelte';

    /**
     * Step three: hand the file over.
     *
     * A second drop zone next to the window-wide one is not a duplicate: the
     * whole-window zone is a shortcut for people who know it is there, and this
     * is the target for somebody who has been told to expect one. It is the
     * same {@link DropZone} a source's how-to and an empty module show.
     *
     * Nothing here asks which service the file came from, and that is not an
     * omission — the importer sniffs each file's contents and routes it. Saying
     * so on the page is worth the two lines: it is the difference between "did I
     * pick the right thing?" and dropping the folder.
     */
    interface Props {
        /**
         * The export the funnel led here for, when it led here for one. Only
         * the analytics reads it: it is the one place in the app where the user
         * has *said* what they are about to drop, so it is the one place that
         * can tell a how-to that misleads from an export Buho can't read.
         */
        expected?: string;
    }

    let { expected }: Props = $props();
</script>

<div class="wrap">
    <DropZone surface="onboarding" {expected} />

    <!-- Steps one and two are done on the phone, because that is where a
         WhatsApp export is made — and so is this one, now that the buttons
         above survive a narrow screen. What wants a wider one is the reading,
         not the import, and that is a recommendation rather than a wall. -->
    <p class="handoff">
        This works on a phone. The file is right there, and Buho reads it here. The charts are drawn
        for a wider screen, though: opening this page on a computer is what gets you the full
        picture.
    </p>
    {#if deviceStore.showcase}
        <div class="handoff-send">
            <SendLinkButton surface="drop-step" />
        </div>
    {/if}

    <ul class="reassurance">
        <li>Every file is read locally, inside your browser. None of it is uploaded.</li>
        <li>
            Buho works out which service each file came from by looking inside it, so a whole export
            folder can go in at once.
        </li>
        <li>
            Nothing is written to disk and nothing is remembered: closing the page clears it, and
            reopening starts over.
        </li>
    </ul>
</div>

<style>
    .wrap {
        max-width: 44rem;
    }

    .handoff {
        margin: 1.25rem 0 0;
        padding: 0.85rem 1rem;
        border: 1px solid hsl(var(--border));
        border-radius: var(--radius-md);
        background: hsl(var(--secondary) / 0.4);
        font-size: var(--text-body);
    }

    .handoff-send {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        margin-top: 0.75rem;
    }

    @media (min-width: 768px) {
        .handoff {
            display: none;
        }
    }

    .reassurance {
        margin: 1.75rem 0 0;
        padding: 0;
        list-style: none;
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        font-size: var(--text-small);
        color: hsl(var(--muted-foreground));
    }

    .reassurance li {
        padding-left: 1rem;
        border-left: 2px solid hsl(var(--border));
    }
</style>
