<script lang="ts" module>
    export type ReaderMessage = {
        id: number;
        /** Local wall-clock "YYYY-MM-DD HH:MM:SS". */
        sentAt: string;
        sender: string;
        /** "Sent" for the user, anything else for the other side. */
        direction: string;
        text: string;
        mediaKind: string;
        /** Reaction emojis, comma-separated. */
        reactions: string;
    };
</script>

<script lang="ts">
    import { ChevronDown, ChevronUp } from '@lucide/svelte';
    import { participantColor } from '#lib/utils/dimensionColors.ts';
    import type { SearchTerm } from '#lib/explorer/search.ts';
    import Highlighted from './Highlighted.svelte';

    interface Props {
        contact: string;
        /** Chronological, already narrowed to the active filters. */
        messages: ReaderMessage[];
        /** How many messages the filters actually match, before the display cap. */
        total: number;
        /**
         * How many of `total` come after the ones shown. Zero unless the window
         * was opened on a message further back than the end of the thread.
         */
        later?: number;
        isGroup?: boolean;
        /** Widens the window into the thread; the parent decides by how much. */
        onLoadEarlier?: () => void;
        onLoadLater?: () => void;
        onClose?: () => void;
        /**
         * An active search: its terms are marked in the bubbles, and `hits` — the
         * ids of every matching message in the thread, in order, shown or not —
         * can be stepped through.
         */
        terms?: readonly SearchTerm[];
        colors?: readonly string[];
        hits?: readonly number[];
        /** The message to bring into view and mark, if any. */
        focusId?: number | null;
        /** Asks the parent to open the window on another message. */
        onFocus?: (id: number) => void;
    }

    let {
        contact,
        messages,
        total,
        later = 0,
        isGroup = false,
        onLoadEarlier,
        onLoadLater,
        onClose,
        terms = [],
        colors = [],
        hits = [],
        focusId = null,
        onFocus,
    }: Props = $props();

    let scroller = $state<HTMLDivElement | null>(null);
    const earlier = $derived(Math.max(0, total - messages.length - later));
    const hasEarlier = $derived(earlier > 0);
    const hasLater = $derived(later > 0);
    const searching = $derived(terms.length > 0);

    /** Where the focused message sits among the hits; -1 when it is not one. */
    const hitPosition = $derived(focusId === null ? -1 : hits.indexOf(focusId));
    const previousHit = $derived(
        hitPosition > 0 ? hits[hitPosition - 1] : hitPosition === -1 ? hits.at(-1) : undefined
    );
    const nextHit = $derived(hitPosition !== -1 ? hits[hitPosition + 1] : undefined);

    // "YYYY-MM-DD HH:MM:SS" carries no zone, and new Date() reads it as local —
    // which is exactly what it is (cf. import/buildRows).
    const parse = (sentAt: string) => new Date(sentAt.replace(' ', 'T'));

    const dayOf = (sentAt: string) => sentAt.slice(0, 10);

    function formatDay(sentAt: string): string {
        const d = parse(sentAt);
        return Number.isNaN(d.getTime()) ? sentAt : d.toLocaleDateString();
    }

    function formatTime(sentAt: string): string {
        const d = parse(sentAt);
        return Number.isNaN(d.getTime())
            ? ''
            : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    /** An attachment with no text still happened: the bubble says which kind. */
    const placeholder = (m: ReaderMessage) =>
        m.mediaKind && m.mediaKind !== 'none' ? `[${m.mediaKind}]` : '[no text]';

    // A run is a block of consecutive messages from one person on one day: only
    // the first carries a name, only the last a time, like the apps do.
    const runs = $derived.by(() => {
        const out: { day: string; sender: string; items: ReaderMessage[] }[] = [];
        for (const m of messages) {
            const day = dayOf(m.sentAt);
            const last = out[out.length - 1];
            if (last && last.day === day && last.sender === m.sender) {
                last.items.push(m);
            } else {
                out.push({ day, sender: m.sender, items: [m] });
            }
        }
        return out;
    });

    // Height before older messages get prepended, so the view can be held on the
    // message the reader was looking at instead of jumping.
    let anchorHeight: number | null = null;
    let lastContact: string | null = null;
    let lastFocus: number | null = null;

    function loadEarlier() {
        anchorHeight = scroller?.scrollHeight ?? null;
        onLoadEarlier?.();
    }

    /** Centre one bubble in the scroller, without scrolling the page around it. */
    function reveal(el: HTMLElement, id: number): boolean {
        const bubble = el.querySelector<HTMLElement>(`[data-id="${id}"]`);
        if (!bubble) return false;
        el.scrollTop = bubble.offsetTop - el.clientHeight / 2 + bubble.offsetHeight / 2;
        return true;
    }

    $effect(() => {
        void messages;
        const el = scroller;
        if (!el) return;
        const focus = focusId;
        if (focus !== null && (focus !== lastFocus || contact !== lastContact)) {
            // Opened on one message — a search hit — rather than on the end.
            lastContact = contact;
            anchorHeight = null;
            if (reveal(el, focus)) lastFocus = focus;
        } else if (contact !== lastContact) {
            // Open on the most recent message, like reopening a thread.
            lastContact = contact;
            lastFocus = focus;
            anchorHeight = null;
            el.scrollTop = el.scrollHeight;
        } else if (anchorHeight !== null) {
            el.scrollTop += el.scrollHeight - anchorHeight;
            anchorHeight = null;
        }
    });
</script>

<div class="reader">
    <div class="reader-head">
        <h3 title={contact}>{contact}</h3>
        <div class="head-right">
            {#if searching}
                <span class="hits" aria-label="Matches in this conversation">
                    <span class="count">
                        {#if hits.length === 0}
                            no match
                        {:else if hitPosition === -1}
                            {hits.length.toLocaleString()}
                            {hits.length === 1 ? 'match' : 'matches'}
                        {:else}
                            match {(hitPosition + 1).toLocaleString()} of {hits.length.toLocaleString()}
                        {/if}
                    </span>
                    <button
                        type="button"
                        class="step"
                        disabled={previousHit === undefined}
                        onclick={() => previousHit !== undefined && onFocus?.(previousHit)}
                        aria-label="Previous match"
                        title="Previous match"
                    >
                        <ChevronUp size={14} strokeWidth={2.25} aria-hidden="true" />
                    </button>
                    <button
                        type="button"
                        class="step"
                        disabled={nextHit === undefined}
                        onclick={() => nextHit !== undefined && onFocus?.(nextHit)}
                        aria-label="Next match"
                        title="Next match"
                    >
                        <ChevronDown size={14} strokeWidth={2.25} aria-hidden="true" />
                    </button>
                </span>
            {:else}
                <span class="count">
                    {#if hasLater}
                        {messages.length.toLocaleString()} of {total.toLocaleString()}
                    {:else if hasEarlier}
                        last {messages.length.toLocaleString()} of {total.toLocaleString()}
                    {:else}
                        {total.toLocaleString()} messages
                    {/if}
                </span>
            {/if}
            <button
                type="button"
                class="close"
                onclick={() => onClose?.()}
                aria-label="Close conversation"
            >
                ×
            </button>
        </div>
    </div>

    {#if messages.length === 0}
        <p class="empty">No message in this conversation matches the filters.</p>
    {:else}
        <div class="scroller" bind:this={scroller}>
            {#if hasEarlier}
                <button type="button" class="earlier" onclick={loadEarlier}>
                    Load earlier messages
                    <span>{earlier.toLocaleString()} left</span>
                </button>
            {/if}
            {#each runs as run, i (run.items[0].id)}
                {#if i === 0 || runs[i - 1].day !== run.day}
                    <div class="day"><span>{formatDay(run.items[0].sentAt)}</span></div>
                {/if}
                <div class="run" class:mine={run.items[0].direction === 'Sent'}>
                    {#if isGroup && run.items[0].direction !== 'Sent'}
                        <span class="sender" style:color={participantColor(run.sender)}>
                            {run.sender}
                        </span>
                    {/if}
                    {#each run.items as m (m.id)}
                        <div class="bubble" data-id={m.id} class:focused={m.id === focusId}>
                            <span class="text" class:missing={!m.text}>
                                {#if m.text && searching}
                                    <Highlighted text={m.text} {terms} {colors} />
                                {:else}
                                    {m.text || placeholder(m)}
                                {/if}
                            </span>
                            {#if m.reactions}
                                <span class="reactions">
                                    {m.reactions.split(',').join(' ')}
                                </span>
                            {/if}
                        </div>
                    {/each}
                    <span class="time">
                        {formatTime(run.items[run.items.length - 1].sentAt)}
                    </span>
                </div>
            {/each}
            {#if hasLater}
                <button type="button" class="earlier" onclick={() => onLoadLater?.()}>
                    Load later messages
                    <span>{later.toLocaleString()} left</span>
                </button>
            {/if}
        </div>
    {/if}
</div>

<style>
    .reader {
        display: flex;
        flex-direction: column;
        width: 100%;
        height: 100%;
        min-height: 0;
    }

    .reader-head {
        flex: none;
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 0.5rem;
        margin-bottom: 0.5rem;
    }

    .reader-head h3 {
        margin: 0;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: var(--text-small);
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: hsl(var(--muted-foreground));
    }

    .head-right {
        flex: none;
        display: flex;
        align-items: baseline;
        gap: 0.5rem;
    }

    .count {
        font-size: var(--text-label);
        color: hsl(var(--muted-foreground));
        font-variant-numeric: tabular-nums;
    }

    .close {
        border: none;
        background: transparent;
        color: hsl(var(--muted-foreground));
        font-size: var(--text-lede);
        line-height: 1;
        padding: 0 0.15rem;
        cursor: pointer;
    }

    .close:hover {
        color: hsl(var(--foreground));
    }

    .scroller {
        /* The offset parent of the bubbles, so revealing one can be measured. */
        position: relative;
        flex: 1;
        min-height: 0;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 0.35rem;
        padding-right: 0.25rem;
    }

    .earlier {
        flex: none;
        align-self: center;
        display: flex;
        align-items: baseline;
        gap: 0.4rem;
        margin-bottom: 0.25rem;
        padding: 0.25rem 0.6rem;
        border: 1px solid hsl(var(--border));
        border-radius: var(--radius-md);
        background: transparent;
        color: hsl(var(--muted-foreground));
        font-size: var(--text-label);
        cursor: pointer;
    }

    .earlier:hover {
        color: hsl(var(--foreground));
        border-color: var(--module-accent);
    }

    .earlier span {
        opacity: 0.7;
        font-variant-numeric: tabular-nums;
    }

    .day {
        display: flex;
        justify-content: center;
        margin: 0.5rem 0 0.15rem;
    }

    .day span {
        font-size: var(--text-label);
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: hsl(var(--muted-foreground));
        background: color-mix(in srgb, hsl(var(--foreground)) 8%, transparent);
        padding: 0.1rem 0.45rem;
        border-radius: var(--radius-md);
    }

    .run {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 2px;
        max-width: 82%;
    }

    .run.mine {
        align-self: flex-end;
        align-items: flex-end;
    }

    .sender {
        font-size: var(--text-label);
        font-weight: 600;
        padding: 0 0.2rem;
    }

    .bubble {
        padding: 0.3rem 0.55rem;
        border-radius: 0.85rem;
        background: color-mix(in srgb, hsl(var(--foreground)) 10%, transparent);
        color: hsl(var(--foreground));
        font-size: var(--text-small);
        line-height: 1.35;
        /* Long links and pasted blocks must not push the column wider. */
        overflow-wrap: anywhere;
    }

    .run.mine .bubble {
        background: color-mix(in srgb, var(--module-accent) 30%, transparent);
    }

    /* The message the reader was opened on: ringed, and pulsed once so the eye
       finds it after the jump. */
    .bubble.focused {
        box-shadow: 0 0 0 1.5px var(--module-accent);
        animation: found 1.1s ease-out 1;
    }

    @keyframes found {
        0% {
            box-shadow: 0 0 0 7px color-mix(in srgb, var(--module-accent) 45%, transparent);
        }
        100% {
            box-shadow: 0 0 0 1.5px var(--module-accent);
        }
    }

    @media (prefers-reduced-motion: reduce) {
        .bubble.focused {
            animation: none;
        }
    }

    .hits {
        display: inline-flex;
        align-items: center;
        gap: 0.15rem;
    }

    .hits .count {
        margin-right: 0.2rem;
    }

    .step {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 1.35rem;
        height: 1.35rem;
        border: 1px solid hsl(var(--border));
        border-radius: var(--radius-sm);
        background: transparent;
        color: hsl(var(--foreground));
        cursor: pointer;
    }

    .step:hover:not(:disabled) {
        border-color: var(--module-accent);
        color: var(--module-accent);
    }

    .step:disabled {
        opacity: 0.35;
        cursor: default;
    }

    .text.missing {
        color: hsl(var(--muted-foreground));
        font-style: italic;
    }

    .reactions {
        display: block;
        margin-top: 0.15rem;
        font-size: var(--text-label);
        line-height: 1;
    }

    .time {
        font-size: var(--text-label);
        color: hsl(var(--muted-foreground));
        font-variant-numeric: tabular-nums;
        padding: 0 0.2rem;
    }

    .empty {
        font-size: var(--text-body);
        color: hsl(var(--muted-foreground));
    }
</style>
