<script lang="ts">
    import Modal from './Modal.svelte';
    import { FEEDBACK_EMAIL, FEEDBACK_HREF } from '#lib/feedback.ts';

    /**
     * The ask for feedback.
     *
     * A dialog rather than a bare `mailto:` on the sidebar icon: a click that
     * throws someone into a half-configured mail client, with no warning, reads
     * as the page breaking.
     *
     * The address is a link *and* text you can copy — a `mailto:` is useless to
     * anyone writing from a webmail the browser knows nothing about, and a bare
     * string is a chore for everyone who does have a client set up.
     */
    interface Props {
        open: boolean;
        onClose: () => void;
    }

    let { open = $bindable(), onClose }: Props = $props();

    let copied = $state(false);
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function copy() {
        try {
            await navigator.clipboard.writeText(FEEDBACK_EMAIL);
            copied = true;
            if (timer) clearTimeout(timer);
            timer = setTimeout(() => (copied = false), 2000);
        } catch {
            // No clipboard, or no permission for it. The address is on screen
            // and selectable, so there is still a way through.
        }
    }

    $effect(() => {
        if (open) copied = false;
    });
</script>

<Modal bind:open {onClose} label="Send feedback">
    <h2 class="pr-8 text-lg font-semibold">Ideas, a data source to add, feedback</h2>

    <p class="mt-2 text-sm text-muted-foreground">Send me an email — I read all of them.</p>

    <div
        class="mt-5 flex items-center justify-between gap-3 rounded-lg border border-border bg-secondary/30 p-3"
    >
        <a
            class="text-sm font-medium break-all text-foreground underline-offset-4 hover:underline"
            href={FEEDBACK_HREF}
        >
            {FEEDBACK_EMAIL}
        </a>
        <button
            class="shrink-0 rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
            onclick={copy}
        >
            {copied ? 'Copied' : 'Copy'}
        </button>
    </div>
</Modal>
