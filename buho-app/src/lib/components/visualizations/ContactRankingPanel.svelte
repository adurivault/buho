<script lang="ts" module>
    export type ContactRankRow = {
        contact: string;
        messages: number;
        sent: number;
    };
</script>

<script lang="ts">
    import { stickyColor } from "$lib/utils/dimensionColors";

    interface Props {
        rows: ContactRankRow[];
        /** Store key used for the sticky palette, e.g. "contact". */
        filterKey?: string;
        selected?: string | null;
        onSelect?: (value: string | null) => void;
    }

    let {
        rows,
        filterKey = "contact",
        selected = null,
        onSelect,
    }: Props = $props();

    const max = $derived(rows.reduce((m, r) => Math.max(m, r.messages), 0));

    /** Share of the thread written by me, as a percentage. */
    const sentShare = (row: ContactRankRow) =>
        row.messages > 0 ? Math.round((row.sent / row.messages) * 100) : 0;

    function select(contact: string) {
        onSelect?.(selected === contact ? null : contact);
    }
</script>

<div class="panel">
    <div class="panel-head">
        <h3>People</h3>
        <span class="count">{rows.length.toLocaleString()}</span>
    </div>

    {#if rows.length === 0}
        <p class="empty">Nothing matches the current filters.</p>
    {:else}
        <ul class="list">
            {#each rows as row (row.contact)}
                <li>
                    <button
                        type="button"
                        class="row"
                        class:selected={selected === row.contact}
                        aria-pressed={selected === row.contact}
                        onclick={() => select(row.contact)}
                        title={`${row.contact} — ${row.messages.toLocaleString()} messages, ${sentShare(row)}% written by you`}
                    >
                        <span
                            class="bar"
                            style:width={`${max > 0 ? (row.messages / max) * 100 : 0}%`}
                            style:background={stickyColor(
                                filterKey,
                                row.contact,
                            )}
                        ></span>
                        <span class="name">{row.contact}</span>
                        <span class="value">
                            {row.messages.toLocaleString()}
                        </span>
                    </button>
                </li>
            {/each}
        </ul>
    {/if}
</div>

<style>
    .panel {
        display: flex;
        flex-direction: column;
        width: 100%;
        height: 100%;
        min-height: 0;
    }

    .panel-head {
        flex: none;
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        margin-bottom: 0.5rem;
    }

    .panel-head h3 {
        margin: 0;
        font-size: 0.8rem;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: hsl(var(--muted-foreground));
    }

    .count {
        font-size: 0.75rem;
        color: hsl(var(--muted-foreground));
        font-variant-numeric: tabular-nums;
    }

    .list {
        flex: 1;
        min-height: 0;
        overflow-y: auto;
        margin: 0;
        padding: 0;
        list-style: none;
        display: flex;
        flex-direction: column;
        gap: 1px;
    }

    .row {
        position: relative;
        display: flex;
        align-items: center;
        gap: 0.5rem;
        width: 100%;
        padding: 0.28rem 0.5rem;
        border: none;
        border-radius: 0.35rem;
        background: transparent;
        color: hsl(var(--foreground));
        font-size: 0.8rem;
        text-align: left;
        cursor: pointer;
        overflow: hidden;
    }

    /* The bar sits behind the label rather than beside it, so long names keep
       the full width of the panel. */
    .bar {
        position: absolute;
        inset: 0 auto 0 0;
        opacity: 0.28;
        border-radius: 0.35rem;
        pointer-events: none;
    }

    .row:hover .bar {
        opacity: 0.45;
    }

    .row.selected {
        outline: 1px solid var(--accent-messages, #3b82f6);
    }

    .row.selected .bar {
        opacity: 0.55;
    }

    .name {
        position: relative;
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .value {
        position: relative;
        flex: none;
        font-variant-numeric: tabular-nums;
        color: hsl(var(--muted-foreground));
    }

    .empty {
        font-size: 0.85rem;
        color: hsl(var(--muted-foreground));
    }
</style>
