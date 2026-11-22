<script lang="ts" module>
    export type MessageHit = {
        id: number;
        /** Local wall-clock "YYYY-MM-DD HH:MM:SS". */
        sentAt: string;
        contact: string;
        sender: string;
        /** "Sent" for the user. */
        direction: string;
        isGroup: boolean;
        text: string;
    };
</script>

<script lang="ts">
    import Highlighted from './Highlighted.svelte';
    import type { SearchTerm } from '#lib/explorer/search.ts';

    /**
     * The messages a search found, newest first, across every conversation.
     *
     * The constellation shows where the hits fall and the ranking who they are
     * with; this is the list that lets you read them. A row opens its
     * conversation at that message — a hit on its own is rarely the whole story.
     */
    interface Props {
        hits: MessageHit[];
        /** How many messages the selection holds in all, before the display cap. */
        total: number;
        terms: readonly SearchTerm[];
        colors: readonly string[];
        onOpen: (hit: MessageHit) => void;
        onShowMore: () => void;
    }

    let { hits, total, terms, colors, onOpen, onShowMore }: Props = $props();

    const parse = (sentAt: string) => new Date(sentAt.replace(' ', 'T'));

    function formatWhen(sentAt: string): string {
        const d = parse(sentAt);
        return Number.isNaN(d.getTime())
            ? sentAt
            : d.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
    }

    /** Who wrote it, where the row alone would not say. */
    function author(hit: MessageHit): string | null {
        if (hit.direction === 'Sent') return 'You';
        return hit.isGroup ? hit.sender : null;
    }
</script>

<div class="results">
    <div class="head">
        <h3>Found</h3>
        <span class="count">
            {#if total > hits.length}
                newest {hits.length.toLocaleString()} of {total.toLocaleString()}
            {:else}
                {total.toLocaleString()} {total === 1 ? 'message' : 'messages'}
            {/if}
        </span>
    </div>

    {#if hits.length === 0}
        <p class="empty">No message matches. Fewer letters find more, and so do fewer filters.</p>
    {:else}
        <ol class="list">
            {#each hits as hit (hit.id)}
                {@const by = author(hit)}
                <li>
                    <button type="button" class="row" onclick={() => onOpen(hit)}>
                        <span class="meta">
                            <span class="contact">{hit.contact}</span>
                            <time datetime={hit.sentAt.replace(' ', 'T')}>
                                {formatWhen(hit.sentAt)}
                            </time>
                        </span>
                        <span class="text">
                            {#if by}<span class="by" class:you={by === 'You'}>{by}</span>{/if}
                            <Highlighted text={hit.text} {terms} {colors} short />
                        </span>
                    </button>
                </li>
            {/each}
        </ol>
        {#if total > hits.length}
            <button type="button" class="more" onclick={() => onShowMore()}>
                Show older
                <span>{(total - hits.length).toLocaleString()} left</span>
            </button>
        {/if}
    {/if}
</div>

<style>
    .results {
        display: flex;
        flex-direction: column;
        width: 100%;
        height: 100%;
        min-height: 0;
    }

    .head {
        flex: none;
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 0.5rem;
        margin-bottom: 0.5rem;
    }

    .head h3 {
        margin: 0;
        font-family: inherit;
        font-size: var(--text-small);
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: hsl(var(--muted-foreground));
    }

    .count {
        font-size: var(--text-label);
        color: hsl(var(--muted-foreground));
        font-variant-numeric: tabular-nums;
    }

    .list {
        flex: 1;
        min-height: 0;
        overflow-y: auto;
        margin: 0;
        padding: 0 0.25rem 0 0;
        list-style: none;
        display: flex;
        flex-direction: column;
    }

    .list li + li {
        border-top: 1px solid color-mix(in srgb, hsl(var(--border)) 70%, transparent);
    }

    .row {
        display: flex;
        flex-direction: column;
        gap: 0.2rem;
        width: 100%;
        padding: 0.45rem 0.4rem;
        border: none;
        border-radius: var(--radius-sm);
        background: transparent;
        color: hsl(var(--foreground));
        text-align: left;
        font: inherit;
        cursor: pointer;
        transition: background-color 0.12s ease;
    }

    .row:hover,
    .row:focus-visible {
        background: color-mix(in srgb, var(--module-accent) 9%, transparent);
    }

    .meta {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 0.5rem;
        min-width: 0;
    }

    .contact {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: var(--text-label);
        font-weight: 600;
    }

    time {
        flex: none;
        font-size: var(--text-label);
        color: hsl(var(--muted-foreground));
        font-variant-numeric: tabular-nums;
    }

    .text {
        font-size: var(--text-small);
        line-height: 1.4;
        color: hsl(var(--foreground) / 0.88);
        overflow-wrap: anywhere;
        display: -webkit-box;
        -webkit-line-clamp: 3;
        line-clamp: 3;
        -webkit-box-orient: vertical;
        overflow: hidden;
    }

    .by {
        margin-right: 0.3rem;
        font-size: var(--text-label);
        font-weight: 600;
        color: hsl(var(--muted-foreground));
    }

    .by.you {
        color: var(--module-accent);
    }

    .more {
        flex: none;
        align-self: center;
        display: flex;
        align-items: baseline;
        gap: 0.4rem;
        margin-top: 0.5rem;
        padding: 0.25rem 0.6rem;
        border: 1px solid hsl(var(--border));
        border-radius: var(--radius-md);
        background: transparent;
        color: hsl(var(--muted-foreground));
        font-size: var(--text-label);
        cursor: pointer;
    }

    .more:hover {
        color: hsl(var(--foreground));
        border-color: var(--module-accent);
    }

    .more span {
        opacity: 0.7;
        font-variant-numeric: tabular-nums;
    }

    .empty {
        font-size: var(--text-body);
        color: hsl(var(--muted-foreground));
    }
</style>
