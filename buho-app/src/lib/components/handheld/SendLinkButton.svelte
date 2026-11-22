<script lang="ts">
    import { page } from '$app/state';
    import Share from '@lucide/svelte/icons/share';
    import { trackEvent } from '#lib/analytics.ts';
    import { sendLink, type SendOutcome } from '#lib/onboarding/sendLink.ts';

    /**
     * "Send me the link": the page you are on, handed to the phone's share sheet
     * so it can be opened on a computer.
     *
     * The phone does the sending, from the person's own account — see
     * `sendLink`. Buho never sees where it went.
     */
    interface Props {
        /** Which screen it sits on, for the analytics. */
        surface: string;
        /**
         * The address to send. Defaults to the page you are on, so the computer
         * opens on the same step: the funnel keeps its state in the URL.
         */
        url?: string;
    }

    let { surface, url }: Props = $props();

    let outcome = $state<SendOutcome | null>(null);

    async function send() {
        outcome = await sendLink(url ?? page.url.href, 'Buho — open on a computer');
        trackEvent('send-to-computer', { surface, outcome });
    }
</script>

<button type="button" class="send" onclick={send}>
    <Share size={18} aria-hidden="true" />
    Send me the link
</button>
<p class="status" aria-live="polite">
    {#if outcome === 'copied'}
        Link copied. Paste it into a message to yourself.
    {/if}
</p>

<style>
    .send {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 0.5rem;
        width: 100%;
        min-height: 48px;
        padding: 0 1.25rem;
        border-radius: var(--radius-pill);
        background: hsl(var(--primary));
        color: hsl(var(--primary-foreground));
        font-size: var(--text-lede);
        font-weight: 600;
        cursor: pointer;
        transition: opacity 0.15s;
    }

    .send:hover {
        opacity: 0.9;
    }

    .status {
        margin: 0;
        font-size: var(--text-small);
        color: hsl(var(--muted-foreground));
    }

    .status:empty {
        display: none;
    }
</style>
