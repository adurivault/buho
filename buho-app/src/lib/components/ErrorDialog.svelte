<script lang="ts">
    import { dataStore } from '#lib/stores/dataStore.svelte.ts';
    import Modal from './Modal.svelte';
    import { resolve } from '$app/paths';
    import { FEEDBACK_EMAIL, FEEDBACK_HREF } from '#lib/feedback.ts';

    /**
     * An import that went nowhere, said out loud.
     *
     * This used to be a thin red strip above the page, which is the wrong shape
     * for it: a failed drop is a dead end, and the message it carries is the
     * longest in the app — the whole list of formats Buho takes. A strip that
     * narrow either truncates it or turns into a wall of red nobody reads,
     * while the person is still looking at the drop zone below it.
     *
     * An import failure is also the best moment to hear about a file Buho
     * should have read, so the address rides along — quietly, under a rule, in
     * the smallest type on the panel. It lives here rather than in the error
     * text because the store raises failures, it doesn't write invitations.
     */
    let open = $state(false);
    /** Which error is on screen, so dismissing one doesn't suppress the next. */
    let shown: unknown = null;

    $effect(() => {
        const error = dataStore.error;
        if (error && error !== shown) {
            shown = error;
            open = true;
        }
    });

    function close() {
        open = false;
        // Cleared for good: leaving it set would have the next unrelated render
        // decide there is still a failure to report.
        dataStore.setError(null);
    }
</script>

{#if dataStore.error}
    <Modal bind:open onClose={close} label="Import failed">
        <h2 class="pr-8 text-lg font-semibold">That didn't work</h2>

        <p class="mt-2 text-sm text-muted-foreground">
            {dataStore.error.message}
        </p>

        <p class="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm">
            {#if dataStore.error.link}
                <a class="text-foreground underline underline-offset-4" href={dataStore.error.link}>
                    Get help with export
                </a>
            {/if}
            <!-- Closes on the way out: left open, the dialog would sit over the
                 very answer it points to. -->
            <a
                class="text-foreground underline underline-offset-4"
                href="{resolve('faq')}#wont-read-my-file"
                onclick={close}
            >
                Common fixes
            </a>
        </p>

        <!-- Deliberately quiet, and last: what went wrong is the point of this
             dialog, and reporting it is an offer. Given a panel of its own it
             read as the thing being asked for. -->
        <p class="mt-5 border-t border-border pt-3 text-xs text-muted-foreground">
            Should Buho have read your file? Tell me which export it was at
            <a
                class="text-muted-foreground underline underline-offset-2 hover:text-foreground"
                href={FEEDBACK_HREF}
            >
                {FEEDBACK_EMAIL}
            </a>.
        </p>
    </Modal>
{/if}
