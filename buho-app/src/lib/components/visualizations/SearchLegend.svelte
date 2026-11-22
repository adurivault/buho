<script lang="ts" module>
    export type SearchLegendEntry = {
        /** The term as the query spells it. */
        label: string;
        /** How many points in the current selection it matched. */
        count: number;
        /** The term's color: its marks, and its dots when the constellation is painted by term. */
        color: string;
    };
</script>

<script lang="ts">
    import { X } from '@lucide/svelte';
    import { trackControl } from '#lib/analytics.ts';

    /**
     * The key to a search, laid over the constellation it colors.
     *
     * On the chart rather than beside the field for two reasons. It is the
     * chart's legend — the colors it explains are the dots under it. And it
     * floats: a legend in the page header grew the header with every comma, and
     * every chart below had to be laid out again, which on a large export is
     * the constellation rebuilding its index for a second at a time.
     *
     * The counts and the colors go out with a shared image; the controls do not.
     */
    interface Props {
        entries: SearchLegendEntry[];
        /** What a count counts, e.g. "messages". */
        countLabel: string;
        /** Whether the constellation is painted by term. */
        colorByActive: boolean;
        onToggleColorBy: () => void;
        onRemove: (label: string) => void;
        /** Analytics id of the Explorer. A literal, never a term. */
        vizId: string;
    }

    let { entries, countLabel, colorByActive, onToggleColorBy, onRemove, vizId }: Props = $props();
</script>

{#if entries.length}
    <div class="legend">
        <ul aria-label="Search terms">
            {#each entries as entry (entry.label)}
                <li class="term" style:--term-color={entry.color}>
                    <span class="swatch" aria-hidden="true"></span>
                    <span class="label">{entry.label}</span>
                    <span class="count" title="{entry.count.toLocaleString()} {countLabel}">
                        {entry.count.toLocaleString()}
                    </span>
                    <button
                        type="button"
                        class="remove"
                        data-export-hide
                        onclick={() => onRemove(entry.label)}
                        aria-label="Remove {entry.label} from the search"
                    >
                        <X size={11} strokeWidth={2.25} aria-hidden="true" />
                    </button>
                </li>
            {/each}
        </ul>
        <button
            type="button"
            class="color-by"
            class:active={colorByActive}
            data-export-hide
            role="switch"
            aria-checked={colorByActive}
            title="Color the constellation by term"
            onclick={() => {
                trackControl(vizId, 'color-by', 'search-term');
                onToggleColorBy();
            }}
        >
            <span class="dot" aria-hidden="true"></span>
            Color by term
        </button>
    </div>
{/if}

<style>
    .legend {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 0.35rem 0.6rem;
    }

    ul {
        display: flex;
        flex-wrap: wrap;
        gap: 0.35rem;
        margin: 0;
        padding: 0;
        list-style: none;
    }

    .term {
        display: inline-flex;
        align-items: center;
        gap: 0.35rem;
        height: 1.65rem;
        padding: 0 0.2rem 0 0.55rem;
        border: 1px solid color-mix(in srgb, var(--term-color) 50%, hsl(var(--border)));
        border-radius: var(--radius-pill);
        /* Opaque enough to read over the dots, clear enough to see they are there. */
        background: color-mix(
            in srgb,
            color-mix(in srgb, var(--term-color) 16%, hsl(var(--card))) 88%,
            transparent
        );
        font-size: var(--text-small);
        max-width: 16rem;
    }

    .swatch {
        flex: none;
        width: 0.55rem;
        height: 0.55rem;
        border-radius: 50%;
        background: var(--term-color);
    }

    .label {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: hsl(var(--foreground));
    }

    .count {
        flex: none;
        font-family: var(--font-mono);
        font-size: var(--text-label);
        color: hsl(var(--muted-foreground));
        font-variant-numeric: tabular-nums;
    }

    .remove {
        flex: none;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border: none;
        background: transparent;
        color: hsl(var(--muted-foreground));
        cursor: pointer;
        padding: 0.15rem;
        border-radius: var(--radius-pill);
    }

    .remove:hover {
        color: hsl(var(--foreground));
        background: color-mix(in srgb, hsl(var(--foreground)) 10%, transparent);
    }

    .color-by {
        display: inline-flex;
        align-items: center;
        gap: 0.4rem;
        height: 1.65rem;
        padding: 0 0.6rem 0 0.35rem;
        border: 1px solid hsl(var(--border));
        border-radius: var(--radius-pill);
        background: color-mix(in srgb, hsl(var(--card)) 88%, transparent);
        font: inherit;
        font-size: var(--text-label);
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: hsl(var(--muted-foreground));
        cursor: pointer;
        white-space: nowrap;
        transition:
            color 0.16s ease,
            border-color 0.16s ease;
    }

    .color-by:hover,
    .color-by.active {
        color: var(--module-accent);
        border-color: color-mix(in srgb, var(--module-accent) 55%, transparent);
    }

    /* Same control as the pies' "color by", so it reads as the same choice. */
    .dot {
        flex: none;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 14px;
        height: 14px;
        border: 1.5px solid hsl(var(--muted-foreground));
        border-radius: 50%;
        background: color-mix(in srgb, hsl(var(--card)) 86%, black 14%);
        transition: border-color 0.16s ease;
    }

    .dot::after {
        content: '';
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: color-mix(in srgb, hsl(var(--muted-foreground)) 55%, transparent);
        transition: background-color 0.16s ease;
    }

    .color-by:hover .dot,
    .color-by.active .dot {
        border-color: var(--module-accent);
    }

    .color-by.active .dot::after {
        background: var(--module-accent);
    }
</style>
