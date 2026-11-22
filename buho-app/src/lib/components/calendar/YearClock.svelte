<script lang="ts">
    import Icon from '#lib/components/Icon.svelte';
    import { moduleById, type ModuleId } from '#lib/data/modules.ts';
    import { monthName } from '#lib/calendar/dates.ts';
    import {
        DIAL_ORDER,
        dialAt,
        dialPaths,
        dialPoint,
        quarterGrid,
        quarterSteps,
        type DialGeometry,
        type QuarterCell,
    } from '#lib/calendar/clock.ts';
    import { QUARTERS_PER_DAY } from '#lib/calendar/timeline.ts';
    import { sequentialRamp } from '#lib/visualizations/d3/chart.ts';
    import { colorAt } from '#lib/visualizations/healthRamp.ts';
    import type { ColorStop } from '#lib/visualizations/signalGrid.ts';

    /**
     * The open year laid round a clock face: each day a spoke, the 1st of
     * January just right of the top and the 31st of December just left of it,
     * running from midnight at the inner edge out to midnight at the rim, cut
     * into quarter-hours. Every module at once, a quarter-hour a module
     * recorded anything in painted in its colour, full — where several were
     * active, the one that happens in an instant covers the one that runs on
     * (see `DIAL_ORDER`). While the pointer is on a module elsewhere on the
     * page, that module alone, each quarter-hour shaded on its ramp by how much
     * it held; health alone, each quarter-hour in the colour of its average
     * heart rate on the health explorer's ramp. Either way the nights close
     * round the hole, the habits of the day run round the year as rings, and
     * whatever moves them, a summer's later evenings or a fortnight away,
     * bends the rings. Every quarter-hour of every day is a tile of its own,
     * outlined in a hairline.
     *
     * Drawn in SVG, so it stays sharp however far the page is zoomed into. The
     * dial is one path per module, or per shade of the one shown alone, and
     * the selected and hovered days' spokes are laid over it.
     */
    interface Props {
        quarters: Partial<Record<ModuleId, QuarterCell[]>>;
        /** The year's days, 'YYYY-MM-DD'. */
        days: string[];
        /** The module to show alone; every module while none is, or it has nothing to show. */
        module: ModuleId | null;
        /** The heart-rate ramp the health explorer paints in, which health alone is painted on. */
        heartStops: ColorStop[];
        selected: string | null;
        /** The day under the pointer, here or in the year's other charts. */
        hovered: string | null;
        onPick: (day: string) => void;
        onHover: (day: string | null) => void;
        size?: number;
    }

    let {
        quarters,
        days,
        module,
        heartStops,
        selected,
        hovered,
        onPick,
        onHover,
        size = 400,
    }: Props = $props();

    /** Radius of midnight: the hole holds the name of the module shown. */
    const INNER = 50;
    /** Room around the dial for the months' names. */
    const RIM = 16;
    /** Share of the turn left empty at the top, where the year turns: it holds the hours' names. */
    const GAP = 0.04;
    /** Most shades a module's ramp has. */
    const STEPS = 5;
    /** How many colours the heart rate is painted in: enough that the blend between stops reads as one. */
    const HEART_SHADES = 32;

    const geometry = $derived<DialGeometry>({
        cx: size / 2,
        cy: size / 2,
        inner: INNER,
        outer: size / 2 - RIM,
        days: days.length,
        gap: GAP,
    });

    const available = $derived(DIAL_ORDER.filter((id) => (quarters[id]?.length ?? 0) > 0));
    /** Health alone: each quarter-hour in the colour of its average heart rate. */
    const heart = $derived.by(() => {
        const cells = quarters.health ?? [];
        if (cells.length === 0 || heartStops.length < 2) return undefined;
        const lo = heartStops[0].value;
        const hi = heartStops[heartStops.length - 1].value;
        const at = (k: number) => lo + ((hi - lo) * k) / HEART_SHADES;
        const cuts = Array.from({ length: HEART_SHADES - 1 }, (_, k) => at(k + 1));
        const color = colorAt(heartStops);
        return {
            paths: dialPaths(quarterGrid(cells, days, cuts), geometry, HEART_SHADES),
            ramp: Array.from({ length: HEART_SHADES }, (_, k) => color(at(k + 0.5))),
            range: `${Math.round(lo).toLocaleString()}–${Math.round(hi).toLocaleString()} bpm`,
        };
    });

    const shown = $derived(
        module === 'health'
            ? heart
                ? module
                : null
            : module && available.includes(module)
              ? module
              : null
    );

    /** Every module at once, one colour each, in the order they cover each other. */
    const together = $derived(
        available.map((id) => ({
            id,
            d: dialPaths(quarterGrid(quarters[id] ?? [], days, []), geometry, 1)[0],
        }))
    );

    /** Each module alone, worked out at once, so pointing at another one swaps it in at once. */
    const alone = $derived(
        new Map(
            available.map((id) => {
                const cells = quarters[id] ?? [];
                const cuts = quarterSteps(cells, STEPS);
                const levels = cuts.length + 1;
                const paths = dialPaths(quarterGrid(cells, days, cuts), geometry, levels);
                return [id, { paths, ramp: sequentialRamp(id, levels) }];
            })
        )
    );
    const dial = $derived(shown === 'health' ? heart : shown ? alone.get(shown) : undefined);

    const xy = ([x, y]: [number, number]) => `${x.toFixed(2)},${y.toFixed(2)}`;

    /** The empty quarter-hours, faintly, so the dial keeps its shape: the whole year, the gap aside. */
    const ground = $derived.by(() => {
        const g = geometry;
        const { inner, outer } = g;
        return (
            `M${xy(dialPoint(g, 0, 1))}A${outer},${outer} 0 1 1 ${xy(dialPoint(g, g.days, 1))}` +
            `L${xy(dialPoint(g, g.days, 0))}A${inner},${inner} 0 1 0 ${xy(dialPoint(g, 0, 0))}Z`
        );
    });

    /** A day's spoke, midnight to midnight, as a path over the dial. */
    function spokePath(day: string | null): string | null {
        const i = day ? days.indexOf(day) : -1;
        if (i < 0) return null;
        return `M${xy(dialPoint(geometry, i + 0.5, 0))}L${xy(dialPoint(geometry, i + 0.5, 1))}`;
    }

    const selectedSpoke = $derived(spokePath(selected));
    const hoveredSpoke = $derived(hovered === selected ? null : spokePath(hovered));

    const radius = (hour: number) =>
        geometry.inner + ((geometry.outer - geometry.inner) * hour) / 24;

    /** The hours named up the gap, midnight just inside the hole and the next one just past the rim. */
    const hours = $derived(
        [0, 6, 12, 18, 24].map((hour) => {
            const nudge = hour === 0 ? -7 : hour === 24 ? 7 : 0;
            return { hour, y: geometry.cy - radius(hour) - nudge };
        })
    );

    /** Every quarter-hour of every day outlined: its rings between the two midnights, its spokes between days. */
    const tiles = $derived.by(() => {
        const g = geometry;
        const rings = Array.from({ length: QUARTERS_PER_DAY + 1 }, (_, q) => {
            const t = q / QUARTERS_PER_DAY;
            const r = g.inner + (g.outer - g.inner) * t;
            return `M${xy(dialPoint(g, 0, t))}A${r},${r} 0 1 1 ${xy(dialPoint(g, g.days, t))}`;
        });
        const spokes = Array.from(
            { length: g.days + 1 },
            (_, day) => `M${xy(dialPoint(g, day, 0))}L${xy(dialPoint(g, day, 1))}`
        );
        return rings.join('') + spokes.join('');
    });

    /** Where each month begins, as a day index, and its name round the rim. */
    const months = $derived.by(() => {
        const starts = days.flatMap((day, i) =>
            i === 0 || day.slice(5, 7) !== days[i - 1].slice(5, 7)
                ? [{ month: Number(day.slice(5, 7)) - 1, day: i }]
                : []
        );
        const label = 1 + RIM / 2 / (geometry.outer - geometry.inner);
        return starts.map((start, k) => {
            const end = starts[k + 1]?.day ?? days.length;
            const [x, y] = dialPoint(geometry, (start.day + end) / 2, label);
            return { name: monthName(start.month), x, y };
        });
    });

    /** The day under the pointer, if it is on the dial. */
    function locate(event: PointerEvent | MouseEvent): string | null {
        const box = (event.currentTarget as Element).getBoundingClientRect();
        const at = dialAt(geometry, event.clientX - box.left, event.clientY - box.top);
        return at ? (days[at.day] ?? null) : null;
    }

    function onMove(event: PointerEvent) {
        const day = locate(event);
        if (day !== hovered) onHover(day);
    }

    function onLeave() {
        onHover(null);
    }

    function onClick(event: MouseEvent) {
        const day = locate(event);
        if (day) onPick(day);
    }
</script>

<figure class="year-clock" style:width="{size}px">
    <div class="plot" style:width="{size}px" style:height="{size}px">
        <svg class="dial" width={size} height={size} aria-hidden="true">
            <path class="ground" d={ground} />
            {#if dial}
                {#each dial.paths as d, k (k)}
                    {#if d}
                        <path class="layer" {d} style:fill={dial.ramp[k]} />
                    {/if}
                {/each}
            {:else}
                {#each together as layer (layer.id)}
                    {#if layer.d}
                        <path class="layer" d={layer.d} style:fill="var(--fill-{layer.id})" />
                    {/if}
                {/each}
            {/if}
            <path class="tiles" d={tiles} />
        </svg>
        {#if shown}
            {@const info = moduleById(shown)}
            <div class="shown" data-module={shown}>
                <Icon name={info.icon} size={16} />
                {#if shown === 'health' && heart}
                    <span class="name">Heart rate</span>
                    <span
                        class="gradient"
                        aria-hidden="true"
                        style:background="linear-gradient(to right, {heart.ramp.join(', ')})"
                    ></span>
                    <span class="range">{heart.range}</span>
                {:else}
                    <span class="name">{shown === 'activity' ? 'Activity' : info.label}</span>
                    <span class="ramp" aria-hidden="true">
                        {#each dial?.ramp ?? [] as color, k (k)}
                            <i style:background={color}></i>
                        {/each}
                    </span>
                {/if}
            </div>
        {/if}
        <!-- The keyboard steps through the days with ← and →; a click is the pointer's way. -->
        <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
        <svg
            class="over"
            width={size}
            height={size}
            role="group"
            aria-label="Pick a day on the year’s clock"
            onpointermove={onMove}
            onpointerleave={onLeave}
            onclick={onClick}
        >
            {#each hours as label (label.hour)}
                <text class="hour" x={geometry.cx} y={label.y}>
                    {String(label.hour).padStart(2, '0')}
                </text>
            {/each}
            {#each months as month (month.name)}
                <text class="month" x={month.x} y={month.y}>{month.name}</text>
            {/each}
            {#if hoveredSpoke}
                <path class="spoke hovered" d={hoveredSpoke} />
            {/if}
            {#if selectedSpoke}
                <path class="spoke halo" d={selectedSpoke} />
                <path class="spoke selected" d={selectedSpoke} />
            {/if}
        </svg>
    </div>
</figure>

<style>
    .year-clock {
        margin: 0;
    }

    .plot {
        position: relative;
    }

    svg {
        position: absolute;
        inset: 0;
        display: block;
        overflow: visible;
    }

    .ground {
        fill: hsl(var(--muted));
        opacity: 0.47;
    }

    .tiles {
        fill: none;
        stroke: hsl(var(--background));
        stroke-width: 0.3;
    }

    .shown {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 4px;
        pointer-events: none;
    }

    .shown :global(svg) {
        color: var(--module-accent);
    }

    .name {
        font-size: var(--text-label);
        line-height: 1;
        white-space: nowrap;
        color: hsl(var(--foreground));
    }

    .ramp {
        display: flex;
        gap: 1px;
    }

    .ramp i {
        width: 7px;
        height: 4px;
        border-radius: 1px;
    }

    .gradient {
        width: 39px;
        height: 4px;
        border-radius: 1px;
    }

    .range {
        font-size: 0.62rem;
        line-height: 1;
        white-space: nowrap;
        font-variant-numeric: tabular-nums;
        color: hsl(var(--muted-foreground));
    }

    .over {
        cursor: pointer;
    }

    .hour,
    .month {
        font-size: 0.62rem;
        fill: hsl(var(--muted-foreground));
        text-anchor: middle;
        dominant-baseline: middle;
    }

    .hour {
        font-variant-numeric: tabular-nums;
    }

    .spoke {
        fill: none;
        stroke-linecap: round;
    }

    .spoke.halo {
        stroke: hsl(var(--background));
        stroke-width: 4.5;
    }

    .spoke.selected {
        stroke: hsl(var(--heading));
        stroke-width: 1.5;
    }

    /* The hovered day, here or in the other charts: dashed, where the selected
       day's spoke is solid. */
    .spoke.hovered {
        stroke: hsl(var(--foreground));
        stroke-width: 1;
        stroke-dasharray: 3 2;
    }
</style>
