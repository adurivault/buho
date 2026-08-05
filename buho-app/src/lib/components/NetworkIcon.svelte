<script lang="ts">
    import type { Network } from "$lib/types/messages";

    /**
     * Simplified monochrome glyph for a messaging service, drawn inline so the
     * app never fetches a remote asset. Stroke-based and sized like the sidebar
     * icons, inheriting `currentColor` so it follows the surrounding text —
     * these identify a service, they aren't brand reproductions.
     */
    interface Props {
        network: Network;
        size?: number;
    }

    let { network, size = 16 }: Props = $props();
</script>

<svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
>
    {#if network === "instagram"}
        <rect x="2.5" y="2.5" width="19" height="19" rx="5.5" />
        <circle cx="12" cy="12" r="4.2" />
        <circle cx="17.4" cy="6.6" r="0.9" fill="currentColor" stroke="none" />
    {:else if network === "whatsapp"}
        <!-- Bubble with the tail at the bottom left, and a handset inside. -->
        <path d="M21 11.6a8.6 8.6 0 0 1-12.9 7.5L3 20.6l1.6-4.9A8.6 8.6 0 1 1 21 11.6z" />
        <!-- The handset is a solid shape, not an outline: at 16 px a stroked
             version collapses into an unreadable smudge. -->
        <path
            d="M9.2 9.1c.3-.6.6-.6.9-.6h.6c.2 0 .5 0 .7.5l.6 1.4c.1.3 0 .5-.1.7l-.4.5c-.1.2-.3.3-.1.6a6 6 0 0 0 2.7 2.3c.3.1.5.1.7-.1l.5-.6c.2-.2.4-.2.6-.1l1.4.7c.3.2.4.3.4.5v.7c0 .3-.3.8-.9 1-.6.2-1.5.2-2.6-.2a9.5 9.5 0 0 1-5-4.6c-.4-1-.4-1.9 0-2.6z"
            fill="currentColor"
            stroke="none"
        />
    {:else if network === "messenger"}
        <!-- Rounded bubble with the pointed tail, and the filled bolt inside. -->
        <path d="M12 2.8c-5.2 0-9.2 3.8-9.2 8.9 0 2.9 1.3 5.4 3.4 7v4l3.2-1.8c.8.2 1.7.3 2.6.3 5.2 0 9.2-3.8 9.2-8.9S17.2 2.8 12 2.8z" />
        <path
            d="M6.9 14.3 11.4 9.6l2.4 2.5 3.3-2.4-4.5 4.7-2.4-2.5z"
            fill="currentColor"
            stroke="none"
        />
    {:else}
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    {/if}
</svg>
