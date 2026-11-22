<script lang="ts" module>
    export type ContactRankRow = {
        contact: string;
        /** Total for the active measure, both sides of the conversation. */
        messages: number;
        /** The part of that total written by the user. */
        sent: number;
        isGroup: boolean;
        /**
         * Group threads only: what each of the others wrote, biggest first. Absent
         * on a one-to-one thread, where "them" is a single person anyway.
         */
        parts?: { sender: string; value: number }[];
    };
</script>

<script lang="ts">
    import { participantColor, RECEIVED_COLOR, SENT_COLOR } from '#lib/utils/dimensionColors.ts';

    interface Props {
        rows: ContactRankRow[];
        /** Unit `messages` and `sent` are counted in, for the tooltips. */
        measureLabel?: string;
        selected?: string | null;
        onSelect?: (value: string | null) => void;
    }

    let { rows, measureLabel = 'messages', selected = null, onSelect }: Props = $props();

    // Pinned in the shared registry, so the Direction pie says the same thing.
    const sentColor = SENT_COLOR;
    const receivedColor = RECEIVED_COLOR;

    const anyGroup = $derived(rows.some((r) => r.parts && r.parts.length > 1));

    let hostEl = $state<HTMLDivElement>();
    let tooltip = $state({ visible: false, x: 0, y: 0, label: '', value: '' });

    /** Same placement rule as the pies: below-right, flipped near the edge. */
    function positionTooltip(event: PointerEvent) {
        if (!hostEl) return;
        const rect = hostEl.getBoundingClientRect();
        let x = event.clientX - rect.left + 12;
        let y = event.clientY - rect.top + 12;
        if (x + 200 > rect.width) x = event.clientX - rect.left - 200 - 12;
        tooltip.x = Math.max(0, x);
        tooltip.y = Math.max(0, y);
    }

    function showSegment(event: PointerEvent, row: ContactRankRow, label: string, value: number) {
        tooltip.label = label;
        tooltip.value =
            `${fmt(value)} ${measureLabel} · ` +
            `${row.messages > 0 ? Math.round((value / row.messages) * 100) : 0}%` +
            ` of ${row.contact}`;
        tooltip.visible = true;
        positionTooltip(event);
    }

    /**
     * Moves bubble up from the segments, so a move that started on one only
     * repositions what the segment already put in the tooltip.
     */
    function showRow(event: PointerEvent, row: ContactRankRow) {
        if ((event.target as HTMLElement)?.classList?.contains('seg')) {
            positionTooltip(event);
            return;
        }
        tooltip.label = row.contact;
        tooltip.value = summary(row);
        tooltip.visible = true;
        positionTooltip(event);
    }

    const hideTooltip = () => (tooltip.visible = false);

    // One linear scale over the conversation totals, so bar length reads as
    // volume and the ranking stays legible at a glance.
    const maxTotal = $derived(rows.reduce((m, r) => Math.max(m, r.messages), 0));

    /** Bar length, in percent of the row width. */
    const barPct = (row: ContactRankRow) => (maxTotal > 0 ? (row.messages / maxTotal) * 100 : 0);

    /**
     * Every bar is centred on the row, so it is the green/blue boundary that
     * carries the imbalance: dead centre is an even conversation, and the further
     * right it sits the more of the thread is yours.
     */
    const barLeft = (row: ContactRankRow) => 50 - barPct(row) / 2;

    const share = (row: ContactRankRow) =>
        row.messages > 0 ? Math.min(1, Math.max(0, row.sent / row.messages)) : 0;

    const sentShare = (row: ContactRankRow) => Math.round(share(row) * 100);

    const fmt = (value: number) => Math.round(value).toLocaleString();

    function summary(row: ContactRankRow): string {
        const received = row.messages - row.sent;
        return (
            `you ${fmt(row.sent)} ${measureLabel}, them ${fmt(received)} · ` +
            `${sentShare(row)}% written by you`
        );
    }

    function select(contact: string) {
        onSelect?.(selected === contact ? null : contact);
    }
</script>

<div class="panel" bind:this={hostEl}>
    <div class="panel-head">
        <h3>Conversations</h3>
        <span class="count">{rows.length.toLocaleString()}</span>
    </div>
    <div class="legend" aria-hidden="true">
        <span class="key" style:background={sentColor}></span>
        <span>you</span>
        <span class="key" style:background={receivedColor}></span>
        <span>them</span>
        {#if anyGroup}
            <span class="note">· groups: one colour per person</span>
        {/if}
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
                        onpointermove={(e) => showRow(e, row)}
                        onpointerleave={hideTooltip}
                    >
                        <span
                            class="bar"
                            style:left={`${barLeft(row)}%`}
                            style:width={`${barPct(row)}%`}
                            aria-hidden="true"
                        >
                            <span
                                class="seg you"
                                role="presentation"
                                style:width={`${share(row) * 100}%`}
                                style:background={sentColor}
                                onpointerenter={(e) => showSegment(e, row, 'You', row.sent)}
                            ></span>
                            {#if row.parts?.length}
                                {@const parts = row.parts}
                                {#each parts as part, i (part.sender)}
                                    <span
                                        class="seg"
                                        role="presentation"
                                        class:last={i === parts.length - 1}
                                        style:width={`${(part.value / row.messages) * 100}%`}
                                        style:background={participantColor(part.sender)}
                                        onpointerenter={(e) =>
                                            showSegment(e, row, part.sender, part.value)}
                                    ></span>
                                {/each}
                            {:else}
                                <span
                                    class="seg last"
                                    role="presentation"
                                    style:background={receivedColor}
                                    onpointerenter={(e) =>
                                        showSegment(e, row, row.contact, row.messages - row.sent)}
                                ></span>
                            {/if}
                        </span>
                        <span class="axis" aria-hidden="true"></span>
                        <span class="label">
                            <span class="name">{row.contact}</span>
                            {#if row.isGroup}
                                <span class="group">group</span>
                            {/if}
                            <span class="value">{fmt(row.messages)}</span>
                        </span>
                    </button>
                </li>
            {/each}
        </ul>
    {/if}

    {#if tooltip.visible}
        <div class="chart-tooltip" style={`left:${tooltip.x}px; top:${tooltip.y}px;`}>
            <strong>{tooltip.label}</strong>
            <span>{tooltip.value}</span>
        </div>
    {/if}
</div>

<style>
    .panel {
        position: relative;
        display: flex;
        flex-direction: column;
        width: 100%;
        height: 100%;
        min-height: 0;
    }

    /* Mirrors the dimension pies, so hovering a bar and hovering a slice look
       like the same gesture. */

    .panel-head {
        flex: none;
        display: flex;
        align-items: baseline;
        justify-content: space-between;
    }

    .panel-head h3 {
        margin: 0;
        font-size: var(--text-small);
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: hsl(var(--muted-foreground));
    }

    .count {
        font-size: var(--text-small);
        color: hsl(var(--muted-foreground));
        font-variant-numeric: tabular-nums;
    }

    .legend {
        flex: none;
        display: flex;
        align-items: center;
        gap: 0.3rem;
        margin: 0.3rem 0 0.5rem;
        font-size: var(--text-label);
        color: hsl(var(--muted-foreground));
    }

    .legend .key {
        width: 0.6rem;
        height: 0.6rem;
    }

    .legend .key + span {
        margin-right: 0.4rem;
    }

    .legend .note {
        opacity: 0.7;
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
        display: block;
        width: 100%;
        padding: 0.3rem 0.5rem;
        border: none;
        /* Square: rounded ends on a full-height block turn the stack into a
           column of pills, and soften the very edges the ranking is read on. */
        border-radius: 0;
        background: transparent;
        color: hsl(var(--foreground));
        font-size: var(--text-small);
        text-align: left;
        cursor: pointer;
        overflow: hidden;
    }

    /* Painted after the bar, so the label reads over the block — but transparent
       to the pointer, or it would mask the segment under it. */
    .label {
        position: relative;
        display: flex;
        align-items: center;
        gap: 0.4rem;
        pointer-events: none;
    }

    .bar {
        position: absolute;
        top: 0;
        bottom: 0;
        display: flex;
        /* Enough for the two sides to carry, not so much that the name has to be
           read through them. */
        opacity: 0.55;
        pointer-events: none;
    }

    .seg {
        display: block;
        height: 100%;
        /* Each segment answers for itself on hover; the row answers for the rest. */
        pointer-events: auto;
    }

    /* Absorbs the rounding of the other widths, so the bar always closes flush. */
    .seg.last {
        flex: 1;
    }

    /* A cut in the panel's own ground rather than a drawn line: it reads as one
       block ending and the next starting, at any bar width. */
    .seg + .seg {
        border-left: 2px solid var(--bg-secondary, hsl(var(--card)));
    }

    /* Reads as a notch cut through the block, and stays visible on the bare
       background of the short rows. */
    .axis {
        position: absolute;
        top: 0;
        bottom: 0;
        left: 50%;
        width: 1px;
        background: hsl(var(--foreground));
        opacity: 0.25;
        pointer-events: none;
    }

    .row:hover .bar {
        opacity: 0.7;
    }

    .row.selected {
        outline: 1px solid var(--module-accent);
        outline-offset: -1px;
    }

    .row.selected .bar {
        opacity: 0.8;
    }

    .name {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    /* In a group "them" is several people, so the imbalance is partly
       mechanical — the row says so rather than reading as a social fact. */
    .group {
        flex: none;
        font-size: var(--text-label);
        text-transform: uppercase;
        letter-spacing: 0.04em;
        padding: 0.05rem 0.25rem;
        /* Its own ground, so it does not have to be read off whichever side of
           the conversation it happens to land on. */
        background: color-mix(in srgb, hsl(var(--background)) 70%, transparent);
        color: hsl(var(--foreground));
        opacity: 0.75;
    }

    .value {
        flex: none;
        font-variant-numeric: tabular-nums;
        color: hsl(var(--foreground));
        opacity: 0.8;
    }

    .empty {
        font-size: var(--text-body);
        color: hsl(var(--muted-foreground));
    }
</style>
