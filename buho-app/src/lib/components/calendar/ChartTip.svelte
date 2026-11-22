<script lang="ts">
    /**
     * The calendar's tooltip: shown the moment the pointer lands on a mark,
     * beside it, and turned to the left of the pointer past the middle of the
     * chart so it never runs off its edge. A text of several lines — the start
     * of each message of a minute — is shown one line under the other.
     */
    interface Props {
        /** Pointer position, relative to the positioned parent — or to the window when `fixed`. */
        x: number;
        y: number;
        /** Width of that parent, or of the window. */
        width: number;
        text: string;
        /** For a chart in a scrolling box, which would clip a tooltip placed inside it. */
        fixed?: boolean;
    }

    let { x, y, width, text, fixed = false }: Props = $props();

    const flip = $derived(x > width * 0.6);
    /** One line per line of `text`: a message tooltip quotes several. */
    const lines = $derived(text.split('\n'));
</script>

<div
    class="tip"
    class:flip
    class:fixed
    class:quotes={lines.length > 1}
    style:left="{x}px"
    style:top="{y}px"
    role="tooltip"
>
    {#each lines as line, i (i)}
        <span class="line">{line}</span>
    {/each}
</div>

<style>
    .tip {
        position: absolute;
        z-index: 5;
        transform: translate(12px, 14px);
        pointer-events: none;
        border-radius: var(--radius-sm);
        border: 1px solid hsl(var(--border));
        padding: 0.3rem 0.45rem;
        font-size: var(--text-label);
        line-height: 1.3;
        width: max-content;
        max-width: 22rem;
        overflow-wrap: anywhere;
        color: hsl(var(--foreground));
        background: color-mix(in srgb, hsl(var(--card)) 92%, black 8%);
        box-shadow: 0 4px 14px rgb(0 0 0 / 0.18);
    }

    .line {
        display: block;
    }

    /* The first line says when and who; the quotes follow it. */
    .tip.quotes .line:first-child {
        font-weight: 600;
        margin-bottom: 2px;
    }

    .tip.flip {
        transform: translate(calc(-100% - 12px), 14px);
    }

    .tip.fixed {
        position: fixed;
        z-index: 50;
    }
</style>
