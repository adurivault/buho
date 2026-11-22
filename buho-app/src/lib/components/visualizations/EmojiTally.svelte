<script lang="ts">
    import type { EmojiCount } from '#lib/utils/emoji.ts';

    interface Props {
        /** Most used first; the parent decides how many. */
        emojis: EmojiCount[];
        /** What the tally covers, spelled out in the tooltip. */
        hint?: string;
        /**
         * Makes each emoji a way into the search: the parent adds it as a term,
         * or takes it back out. Without it the chips are only figures.
         */
        onSelect?: (emoji: string) => void;
        /** The color of the search term an emoji already is, or null. */
        termColor?: (emoji: string) => string | null;
    }

    let {
        emojis,
        hint = 'Emojis typed in the current selection — reactions not counted',
        onSelect,
        termColor = () => null,
    }: Props = $props();
</script>

<!-- One line, always: a long tail of emoji scrolls sideways rather than
     wrapping onto a second row and eating the height the charts need. -->
<div class="tally" title={hint} aria-label={hint}>
    <span class="caption">Emojis</span>
    {#if emojis.length}
        {#each emojis as e (e.emoji)}
            {@const color = termColor(e.emoji)}
            {#if onSelect}
                <button
                    type="button"
                    class="chip"
                    class:searched={color !== null}
                    style:--term-color={color}
                    aria-pressed={color !== null}
                    title={color !== null
                        ? `Stop searching for ${e.emoji}`
                        : `Search for ${e.emoji}`}
                    onclick={() => onSelect(e.emoji)}
                >
                    <span class="glyph">{e.emoji}</span>
                    <span class="count">{e.count.toLocaleString()}</span>
                </button>
            {:else}
                <span class="chip">
                    <span class="glyph">{e.emoji}</span>
                    <span class="count">{e.count.toLocaleString()}</span>
                </span>
            {/if}
        {/each}
    {:else}
        <span class="empty">none typed here</span>
    {/if}
</div>

<style>
    .tally {
        display: flex;
        align-items: center;
        gap: 0.4rem;
        overflow-x: auto;
        scrollbar-width: thin;
    }

    .caption {
        flex: none;
        font-size: var(--text-label);
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: hsl(var(--muted-foreground));
    }

    .chip {
        flex: none;
        display: inline-flex;
        align-items: center;
        gap: 0.2rem;
        padding: 0.1rem 0.35rem;
        border: 1px solid transparent;
        border-radius: var(--radius-md);
        background: color-mix(in srgb, hsl(var(--foreground)) 8%, transparent);
        font: inherit;
        color: inherit;
    }

    button.chip {
        cursor: pointer;
        transition:
            background-color 0.15s ease,
            border-color 0.15s ease;
    }

    button.chip:hover {
        background: color-mix(in srgb, hsl(var(--foreground)) 14%, transparent);
    }

    /* An emoji the search is looking for wears its term's color, the one its
       dots and its marks carry everywhere else. */
    .chip.searched {
        border-color: var(--term-color);
        background: color-mix(in srgb, var(--term-color) 20%, transparent);
    }

    .glyph {
        font-size: var(--text-body);
        line-height: 1.2;
    }

    .count {
        font-size: var(--text-label);
        color: hsl(var(--muted-foreground));
        font-variant-numeric: tabular-nums;
    }

    .empty {
        font-size: var(--text-label);
        color: hsl(var(--muted-foreground));
    }
</style>
