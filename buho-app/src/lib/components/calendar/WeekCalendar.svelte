<script lang="ts">
    import { moduleById, type ModuleId } from '#lib/data/modules.ts';
    import type { YearDays } from '#lib/calendar/days.ts';
    import { CALENDAR_ORDER, dayFigureText, type FigureContext } from '#lib/calendar/figures.ts';
    import { weekSpan } from '#lib/calendar/lanes.ts';
    import {
        dayOfYear,
        monthName,
        shortDay,
        weekdayFromMonday,
        weekdayName,
    } from '#lib/calendar/dates.ts';

    /**
     * The open year week by week, Monday on top, each day coloured by the
     * module it stood out in — the one whose bar stands tallest in the lanes
     * that day — and the stronger the taller that bar. While the pointer is on
     * a module elsewhere on the page, or on its name in the legend, each day
     * in that module's colour alone, as strong as its own bar.
     *
     * Drawn on the lanes' axis of days: given the lanes' track width, a week's
     * cells span its seven days' bars above them, so a day reads straight down
     * from its lanes to its week. The weekday names hang left of the cells.
     */
    interface Props {
        days: YearDays;
        loaded: Record<ModuleId, boolean>;
        selected: string | null;
        /** The day under the pointer, here or in the year's other charts. */
        hovered: string | null;
        context: FigureContext;
        onPick: (day: string) => void;
        onHover: (day: string | null) => void;
        /** The module to show alone; every module while none is. */
        module: ModuleId | null;
        /** The module whose name in the legend the pointer is on; null once it is off the names. */
        onModule: (module: ModuleId | null) => void;
    }

    let { days, loaded, selected, hovered, context, onPick, onHover, module, onModule }: Props =
        $props();

    /** Space between two cells, in pixels. */
    const GAP = 2;
    /** The month names' row. */
    const TOP = 18;
    /** A weekday's row is as tall as a week is wide, within these bounds. */
    const ROW_MIN = 8;
    const ROW_MAX = 28;

    /** The lanes' track width: this chart is laid out on it. */
    let width = $state(0);

    const year = $derived(days.year);
    const count = $derived(days.days.length);
    /** Monday-first weekday of the 1st of January: how far into its week the year opens. */
    const offset = $derived(weekdayFromMonday(days.days[0]));
    /** As tall as a week is wide, so the cells come out square. */
    const row = $derived(Math.max(ROW_MIN, Math.min(ROW_MAX, (7 * width) / count)));
    const height = $derived(TOP + 7 * row - GAP);
    /** Left of the first week, which may start a few days before the 1st of January. */
    const labelX = $derived(Math.min(0, weekSpan(0, offset, count, width)[0]) - 6);

    const cells = $derived(
        days.days.map((day, i) => {
            const [from, to] = weekSpan(i, offset, count, width);
            return {
                day,
                x: from + GAP / 2,
                y: TOP + ((offset + i) % 7) * row,
                width: Math.max(0, to - from - GAP),
                paint: paintOf(i),
                tip: describe(day, i),
            };
        })
    );

    /** Where the lanes write each month's name, so the two read as one axis. */
    const months = $derived(
        Array.from({ length: 12 }, (_, month) => {
            const start = `${year}-${String(month + 1).padStart(2, '0')}-01`;
            return {
                name: monthName(month),
                x: Math.floor((dayOfYear(start) / count) * width) + 4,
            };
        })
    );

    const legend = $derived(
        CALENDAR_ORDER.map((id) => {
            const live = loaded[id] && (days.values[id] ?? []).some((value) => value !== null);
            return {
                id,
                label: moduleById(id).label,
                live,
                tip: !loaded[id] ? 'Not imported' : live ? '' : `No data in ${year}`,
            };
        })
    );

    /** The module a day is painted in, and its height in that module's lane; null for a blank day. */
    function paintOf(i: number): { module: ModuleId; fill: number } | null {
        if (!module) return days.standout[i] ?? null;
        const fill = days.fills[module]?.[i];
        return fill != null && fill > 0 ? { module, fill } : null;
    }

    function describe(day: string, i: number): string {
        const shown = module ?? days.standout[i]?.module;
        const value = shown ? days.values[shown]?.[i] : null;
        if (!shown) return `${shortDay(day)} · nothing recorded`;
        const label = moduleById(shown).label;
        if (!value) return `${shortDay(day)} · ${label}: nothing recorded`;
        return `${shortDay(day)} · ${label}: ${dayFigureText(shown, value, context)}`;
    }

    /** Stronger the taller the day's bar: a low day is a tint, a full bar is solid. */
    function fill(module: ModuleId, height: number): string {
        const strength = Math.round(14 + 86 * Math.max(0, Math.min(1, height)));
        return `color-mix(in srgb, var(--peak-${module}) ${strength}%, transparent)`;
    }

    function onKey(event: KeyboardEvent, day: string) {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        onPick(day);
    }

    function onMove(event: PointerEvent) {
        const target = event.target instanceof Element ? event.target.closest('[data-day]') : null;
        const day = target?.getAttribute('data-day') ?? null;
        if (day !== hovered) onHover(day);
    }

    function onLeave() {
        onHover(null);
    }
</script>

<div class="week-calendar" bind:clientWidth={width}>
    <svg
        {width}
        {height}
        role="group"
        aria-label="The days of {year}, by week"
        onpointermove={onMove}
        onpointerleave={onLeave}
    >
        {#each months as month (month.name)}
            <text class="label" x={month.x} y={TOP - 6}>{month.name}</text>
        {/each}
        {#each [0, 2, 4] as weekday (weekday)}
            <text class="label weekday" x={labelX} y={TOP + weekday * row + (row - GAP) / 2}>
                {weekdayName(weekday)}
            </text>
        {/each}
        {#each cells as cell (cell.day)}
            {#if cell.paint}
                <rect
                    class="cell"
                    class:selected={cell.day === selected}
                    class:hovered={cell.day === hovered}
                    data-day={cell.day}
                    x={cell.x}
                    y={cell.y}
                    width={cell.width}
                    height={row - GAP}
                    rx="2"
                    style:fill={fill(cell.paint.module, cell.paint.fill)}
                    role="button"
                    tabindex="-1"
                    aria-label={cell.tip}
                    onclick={() => onPick(cell.day)}
                    onkeydown={(event) => onKey(event, cell.day)}
                ></rect>
            {:else}
                <rect
                    class="cell empty"
                    class:selected={cell.day === selected}
                    class:hovered={cell.day === hovered}
                    data-day={cell.day}
                    x={cell.x + 0.5}
                    y={cell.y + 0.5}
                    width={Math.max(0, cell.width - 1)}
                    height={row - GAP - 1}
                    rx="2"
                ></rect>
            {/if}
        {/each}
    </svg>

    <div class="legend" role="presentation" onpointerleave={() => onModule(null)}>
        {#each legend as item (item.id)}
            <span
                class="key"
                class:off={!item.live}
                class:dim={module !== null && item.id !== module}
                title={item.tip || undefined}
                role="presentation"
                onpointerenter={() => onModule(item.live ? item.id : null)}
            >
                <span class="swatch" data-module={item.id}></span>{item.label}
            </span>
        {/each}
    </div>
</div>

<style>
    /* Nothing clips it: the weekday names hang left of its box. */
    .week-calendar {
        display: flex;
        flex-direction: column;
        gap: 8px;
        min-width: 0;
        overflow: visible;
    }

    svg {
        display: block;
        flex: none;
        overflow: visible;
    }

    .label {
        font-size: 0.62rem;
        fill: hsl(var(--muted-foreground));
    }

    .weekday {
        text-anchor: end;
        dominant-baseline: central;
    }

    .cell {
        cursor: pointer;
        outline: none;
    }

    .cell.empty {
        fill: transparent;
        stroke: hsl(var(--border));
        stroke-width: 1;
        cursor: default;
    }

    .cell.selected {
        stroke: hsl(var(--heading));
        stroke-width: 1.5;
    }

    /* The hovered day, here or in the other charts: a dashed ring, where the
       selected day's is solid. */
    .cell.hovered:not(.selected) {
        stroke: hsl(var(--foreground));
        stroke-width: 1;
        stroke-dasharray: 2 1.5;
    }

    .legend {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 4px 14px;
    }

    .key {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-size: var(--text-label);
        color: hsl(var(--muted-foreground));
        white-space: nowrap;
    }

    .key.off,
    .key.dim {
        opacity: 0.5;
    }

    .swatch {
        width: 9px;
        height: 9px;
        box-sizing: border-box;
        border-radius: 2px;
        background: var(--module-peak);
    }

    .off .swatch {
        background: transparent;
        border: 1px dashed hsl(var(--border-strong));
    }
</style>
