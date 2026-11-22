<script lang="ts">
    import Icon from '#lib/components/Icon.svelte';
    import { moduleById, type ModuleId } from '#lib/data/modules.ts';
    import type { YearDays } from '#lib/calendar/days.ts';
    import { CALENDAR_ORDER } from '#lib/calendar/figures.ts';

    /**
     * Every day of the open year as one dot, pulled towards each module's
     * anchor on the ring as hard as that day's bar stands tall in the module's
     * lane (the lanes' own scale), and resting where the pulls balance: the
     * average of the anchors' positions, weighted by the day's heights. A day
     * that was all music sits on the music anchor, a day of music and messages
     * between the two, an even day in the middle. A busy even day and a quiet
     * one both land in the middle, so a dot grows with the day's mean height.
     *
     * Coloured by the module the day stood out in. The selected and hovered
     * days show their pulls as springs to the anchors. Kept small: each anchor
     * is named by its module's icon alone.
     */
    interface Props {
        days: YearDays;
        loaded: Record<ModuleId, boolean>;
        selected: string | null;
        /** The day under the pointer, here or in the year's other charts. */
        hovered: string | null;
        onPick: (day: string) => void;
        onHover: (day: string | null) => void;
        /** The module to bring forward: the dots fade to how tall they stand in it. */
        module: ModuleId | null;
        /** The module whose anchor the pointer is on; null once it is off the anchors. */
        onModule: (module: ModuleId | null) => void;
        /** Width and height, in pixels. */
        size?: number;
    }

    let {
        days,
        loaded,
        selected,
        hovered,
        onPick,
        onHover,
        module,
        onModule,
        size = 140,
    }: Props = $props();

    /** How near a dot the pointer has to be to pick it, in pixels. */
    const REACH = 6;
    /** Room round the ring for the anchors' icons. */
    const RIM = 15;

    /** Whether the pointer is near a dot of this chart. */
    let pointing = $state(false);

    /** One anchor per module with anything this year, evenly round the ring from the top. */
    const anchors = $derived.by(() => {
        const live = CALENDAR_ORDER.filter(
            (id) => loaded[id] && (days.values[id] ?? []).some((value) => value !== null)
        );
        return live.map((id, k) => {
            const angle = -Math.PI / 2 + (k * 2 * Math.PI) / live.length;
            return { id, cos: Math.cos(angle), sin: Math.sin(angle) };
        });
    });

    const center = $derived(size / 2);
    const radius = $derived(Math.max(0, size / 2 - RIM));

    /** Every day with a height in any module, where its pulls balance. */
    const dots = $derived(
        days.days.flatMap((day, i) => {
            let sum = 0;
            let x = 0;
            let y = 0;
            const pulls = anchors.map((anchor) => {
                const pull = days.fills[anchor.id]?.[i] ?? 0;
                sum += pull;
                x += pull * anchor.cos;
                y += pull * anchor.sin;
                return pull;
            });
            if (sum <= 0) return [];
            return [
                {
                    day,
                    x: center + (radius * x) / sum,
                    y: center + (radius * y) / sum,
                    r: 0.9 + (2.1 * sum) / anchors.length,
                    module: days.standout[i]?.module ?? null,
                    pulls,
                },
            ];
        })
    );

    const byDay = $derived(new Map(dots.map((dot) => [dot.day, dot])));
    const selectedDot = $derived(selected ? (byDay.get(selected) ?? null) : null);
    const hoveredDot = $derived(
        hovered && hovered !== selected ? (byDay.get(hovered) ?? null) : null
    );
    const focus = $derived(anchors.findIndex((anchor) => anchor.id === module));

    function anchorAt(k: number): [number, number] {
        return [center + radius * anchors[k].cos, center + radius * anchors[k].sin];
    }

    function springs(dot: (typeof dots)[number]) {
        return dot.pulls.flatMap((pull, k) => {
            if (pull <= 0) return [];
            const [x, y] = anchorAt(k);
            return [{ id: anchors[k].id, x, y, width: 0.4 + 2 * pull }];
        });
    }

    function nearest(px: number, py: number): string | null {
        let best: string | null = null;
        let bestDistance = REACH;
        for (const dot of dots) {
            const distance = Math.hypot(dot.x - px, dot.y - py);
            if (distance < bestDistance) {
                bestDistance = distance;
                best = dot.day;
            }
        }
        return best;
    }

    function onMove(event: PointerEvent) {
        const rect = (event.currentTarget as Element).getBoundingClientRect();
        const day = nearest(event.clientX - rect.left, event.clientY - rect.top);
        pointing = day !== null;
        if (day !== hovered) onHover(day);
    }

    function onLeave() {
        pointing = false;
        onHover(null);
    }

    function onClick() {
        if (pointing && hovered) onPick(hovered);
    }
</script>

<div class="radviz" style:width="{size}px" style:height="{size}px">
    {#if anchors.length > 0}
        <!-- The keyboard steps through the days with ← and →; a click is the pointer's way. -->
        <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
        <svg
            width={size}
            height={size}
            class:picking={pointing}
            role="group"
            aria-label="The days of {days.year}, each pulled towards the modules it was busy in"
            onpointermove={onMove}
            onpointerleave={onLeave}
            onclick={onClick}
        >
            <circle class="orbit" cx={center} cy={center} r={radius} />
            {#each dots as dot (dot.day)}
                <circle
                    class="dot"
                    cx={dot.x}
                    cy={dot.y}
                    r={dot.r}
                    style:fill={dot.module
                        ? `var(--peak-${dot.module})`
                        : 'hsl(var(--muted-foreground))'}
                    style:opacity={focus >= 0 ? 0.06 + 0.84 * dot.pulls[focus] : 0.5}
                />
            {/each}

            {#if hoveredDot}
                {#each springs(hoveredDot) as spring (spring.id)}
                    <line
                        class="spring hovered"
                        x1={hoveredDot.x}
                        y1={hoveredDot.y}
                        x2={spring.x}
                        y2={spring.y}
                        stroke-width={spring.width}
                        style:stroke="var(--peak-{spring.id})"
                    />
                {/each}
                <circle class="mark hovered" cx={hoveredDot.x} cy={hoveredDot.y} r="3" />
            {/if}
            {#if selectedDot}
                {#each springs(selectedDot) as spring (spring.id)}
                    <line
                        class="spring"
                        x1={selectedDot.x}
                        y1={selectedDot.y}
                        x2={spring.x}
                        y2={spring.y}
                        stroke-width={spring.width}
                        style:stroke="var(--peak-{spring.id})"
                    />
                {/each}
                <circle
                    class="mark"
                    cx={selectedDot.x}
                    cy={selectedDot.y}
                    r="3.5"
                    style:fill={selectedDot.module
                        ? `var(--peak-${selectedDot.module})`
                        : 'hsl(var(--foreground))'}
                />
            {/if}

            {#each anchors as anchor, k (anchor.id)}
                {@const [x, y] = anchorAt(k)}
                <circle
                    class="anchor"
                    cx={x}
                    cy={y}
                    r={focus === k ? 4 : 3}
                    style:fill="var(--peak-{anchor.id})"
                />
            {/each}
        </svg>

        {#each anchors as anchor (anchor.id)}
            {@const label = anchor.id === 'activity' ? 'Activity' : moduleById(anchor.id).label}
            <span
                class="icon"
                class:off={focus >= 0 && anchors[focus].id !== anchor.id}
                style:left="{center + (radius + 9) * anchor.cos}px"
                style:top="{center + (radius + 9) * anchor.sin}px"
                data-module={anchor.id}
                title={label}
                aria-label={label}
                role="presentation"
                onpointerenter={() => onModule(anchor.id)}
                onpointerleave={() => onModule(null)}
            >
                <Icon name={moduleById(anchor.id).icon} size={12} />
            </span>
        {/each}

        {#if anchors.length < 3}
            <p class="note">Needs three modules</p>
        {/if}
    {/if}
</div>

<style>
    .radviz {
        position: relative;
        flex: none;
    }

    svg {
        display: block;
        overflow: visible;
    }

    svg.picking {
        cursor: pointer;
    }

    .orbit {
        fill: none;
        stroke: hsl(var(--border));
        stroke-width: 1;
    }

    .spring {
        stroke-linecap: round;
        opacity: 0.75;
        pointer-events: none;
    }

    .spring.hovered {
        opacity: 0.6;
        stroke-dasharray: 2 2;
    }

    .mark {
        stroke: hsl(var(--background));
        stroke-width: 1.5;
        pointer-events: none;
    }

    .mark.hovered {
        fill: hsl(var(--background));
        stroke: hsl(var(--foreground));
        stroke-width: 1.25;
    }

    .anchor {
        stroke: hsl(var(--background));
        stroke-width: 1.5;
        pointer-events: none;
    }

    .icon {
        position: absolute;
        display: inline-flex;
        transform: translate(-50%, -50%);
        color: var(--module-accent);
    }

    .icon.off {
        opacity: 0.4;
    }

    .note {
        position: absolute;
        left: 0;
        right: 0;
        bottom: -14px;
        margin: 0;
        text-align: center;
        font-size: 0.62rem;
        color: hsl(var(--muted-foreground));
    }
</style>
