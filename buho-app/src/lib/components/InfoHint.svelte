<script lang="ts">
    type Props = {
        /** Explanation shown on hover / focus. */
        text: string;
        label?: string;
    };

    let { text, label = "What is this?" }: Props = $props();

    let open = $state(false);
</script>

<span class="hint">
    <button
        type="button"
        class="dot"
        aria-label={label}
        aria-expanded={open}
        onmouseenter={() => (open = true)}
        onmouseleave={() => (open = false)}
        onfocus={() => (open = true)}
        onblur={() => (open = false)}
        onclick={() => (open = !open)}>?</button
    >
    {#if open}
        <span class="bubble" role="tooltip">{text}</span>
    {/if}
</span>

<style>
    .hint {
        position: relative;
        display: inline-flex;
        vertical-align: middle;
        margin-left: 0.45rem;
    }

    .dot {
        width: 1.15rem;
        height: 1.15rem;
        border-radius: 50%;
        border: 1px solid hsl(var(--border));
        background: hsl(var(--secondary) / 0.5);
        color: hsl(var(--muted-foreground));
        font-size: 0.7rem;
        font-weight: 600;
        line-height: 1;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        cursor: help;
        padding: 0;
        transition:
            color 0.15s,
            border-color 0.15s;
    }
    .dot:hover,
    .dot:focus-visible {
        color: hsl(var(--foreground));
        border-color: hsl(var(--foreground) / 0.5);
    }

    .bubble {
        position: absolute;
        top: calc(100% + 0.4rem);
        left: 50%;
        transform: translateX(-50%);
        z-index: 40;
        width: max-content;
        max-width: 22rem;
        padding: 0.5rem 0.65rem;
        border-radius: 0.4rem;
        border: 1px solid hsl(var(--border));
        background: hsl(var(--popover, var(--background)));
        color: hsl(var(--muted-foreground));
        font-size: 0.8rem;
        font-weight: 400;
        line-height: 1.4;
        text-align: left;
        white-space: normal;
        box-shadow: 0 4px 14px rgb(0 0 0 / 0.3);
    }

    @media (max-width: 640px) {
        .bubble {
            max-width: 15rem;
        }
    }
</style>
