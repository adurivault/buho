<script lang="ts">
    import type { Snippet } from 'svelte';
    import Monitor from '@lucide/svelte/icons/monitor';
    import SendLinkButton from './SendLinkButton.svelte';

    /**
     * The note that says the rest of this happens on a computer, with the way to
     * get there in one tap.
     *
     * Advice, never a wall: it sits in the page beside whatever still works on a
     * phone, and nothing is hidden behind it.
     */
    interface Props {
        title: string;
        /** Which screen it sits on, for the analytics. */
        surface: string;
        /** The address to send, when it is not the page you are on. */
        url?: string;
        children: Snippet;
    }

    let { title, surface, url, children }: Props = $props();
</script>

<section class="note">
    <div class="head">
        <Monitor size={20} aria-hidden="true" />
        <h2>{title}</h2>
    </div>
    <p class="body">{@render children()}</p>
    <SendLinkButton {surface} {url} />
    <p class="fine">
        Opens your phone's share sheet, to mail or AirDrop it to yourself. Only the address is sent.
    </p>
</section>

<style>
    .note {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
        padding: 1.25rem;
        border-radius: var(--radius-lg);
        background: hsl(var(--secondary));
    }

    .head {
        display: flex;
        align-items: center;
        gap: 0.6rem;
        color: hsl(var(--heading));
    }

    h2 {
        margin: 0;
        font-size: var(--text-subheading);
    }

    .body {
        margin: 0;
        font-size: var(--text-body);
        line-height: 1.6;
        color: hsl(var(--muted-foreground));
    }

    .fine {
        margin: 0;
        font-size: var(--text-small);
        line-height: 1.5;
        color: hsl(var(--muted-foreground));
    }
</style>
