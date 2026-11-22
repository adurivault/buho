<script lang="ts">
    import Icon from '#lib/components/Icon.svelte';
    import { moduleById, type ModuleId } from '#lib/data/modules.ts';
    import type { Coverage, YearDays } from '#lib/calendar/days.ts';
    import { cityRanks, type YearData } from '#lib/calendar/yearData.ts';
    import {
        laneTotalText,
        laneUnit,
        yearTotalText,
        type FigureContext,
    } from '#lib/calendar/figures.ts';
    import type { YearGlyph } from '#lib/calendar/years.ts';
    import {
        emptyNote,
        LANE_HEAD,
        LANE_LABELS as GUTTER,
        LANE_LEFT as LEFT,
        LANE_PROJECTION as PROJECTION,
        leadIn,
        type Lane,
    } from '#lib/calendar/lanes.ts';
    import { dayOfYear, monthDay, monthName, shortDay } from '#lib/calendar/dates.ts';
    import { area, curveBasis, line } from 'd3';
    import { fillColor, themeHsl } from '#lib/visualizations/themeColors.ts';
    import { categoricalColor, otherColor } from '#lib/utils/dimensionColors.ts';
    import { themeStore } from '#lib/stores/themeStore.svelte.ts';

    /**
     * The open year, one lane of daily bars per module, on a shared axis of
     * days. Painted on one canvas — 365 columns times seven rows is no job for
     * the DOM — with the labels, the hatching and the selection laid over it.
     *
     * Left of each lane, its projection: the lane's bars laid flat against
     * their own axis, so each step of height says how many days stood that
     * tall, with the selected and hovered days' heights marked across it. The
     * pointer on a projection points at the day whose bar stands nearest its
     * height.
     *
     * Health stands each day at its heartbeats, the hours without the watch
     * filled with the year's usual heart rate at that hour (see `dayBeats`),
     * on its lane's scale from the year's calmest days to its busiest: the
     * time the watch was worn is not how hard the heart worked. Each bar is
     * split by the time in each heart-rate band, the filled hours in grey on
     * top.
     */
    interface Props {
        days: YearDays;
        data: YearData;
        /** Where each lane sits: `layoutYear`. */
        layout: { lanes: Lane[]; height: number };
        coverage: Partial<Record<ModuleId, Coverage>>;
        /** The year's last recorded day, when the year stops early: where the exports end. */
        end: string | null;
        /** Each module's year — its total sits under the lane's name. */
        glyphs: Partial<Record<ModuleId, YearGlyph>>;
        selected: string | null;
        /** The day under the pointer, here or in the year's other charts. */
        hovered: string | null;
        /** The first and last day anything was recorded on; only those can be picked. */
        first: string | null;
        last: string | null;
        context: FigureContext;
        onPick: (day: string) => void;
        onHover: (day: string | null) => void;
        /** The module whose lane the pointer is on; null once it is on none. */
        onModule: (module: ModuleId | null) => void;
        onAdd: (module: ModuleId) => void;
    }

    let {
        days,
        data,
        layout,
        coverage,
        end,
        glyphs,
        selected,
        hovered,
        first,
        last,
        context,
        onPick,
        onHover,
        onModule,
        onAdd,
    }: Props = $props();

    const DAY_MINUTES = 24 * 60;
    /** One step of height in a projection, in pixels. */
    const STEP = 2;

    let width = $state(0);
    let canvas = $state<HTMLCanvasElement | null>(null);

    const year = $derived(days.year);
    const count = $derived(days.days.length);
    const trackWidth = $derived(Math.max(0, width - LEFT));

    const zonesByDay = $derived(new Map((data.health?.days ?? []).map((d) => [d.date, d.minutes])));
    const cityByDay = $derived(new Map((data.positions ?? []).map((d) => [d.date, d.city])));
    const ranks = $derived(cityRanks(data.positions ?? []));

    const months = $derived(
        Array.from({ length: 12 }, (_, month) => ({
            name: monthName(month),
            share: dayOfYear(`${year}-${String(month + 1).padStart(2, '0')}-01`) / count,
        }))
    );

    const selectedShare = $derived(
        selected && selected.startsWith(String(year)) ? dayOfYear(selected) / count : null
    );
    const hoveredShare = $derived(
        hovered && hovered.startsWith(String(year)) ? dayOfYear(hovered) / count : null
    );

    /** Day `i`'s bar in a lane, in pixels: what the canvas draws for it. */
    function barHeight(lane: Lane, i: number): number {
        const fill = days.fills[lane.module]?.[i];
        if (fill == null) return 0;
        // Health starts at the year's calmest days: one of them still has a bar.
        if (lane.kind === 'zones') return Math.max(1, fill * lane.height);
        return fill <= 0 ? 0 : Math.max(1, fill * lane.height);
    }

    /** Weights a step of a projection shares with its neighbours, so it reads as a curve. */
    const KERNEL = [1, 4, 6, 4, 1];
    /** The axis a projection grows left from, by the bars. */
    const AXIS = PROJECTION - 1;
    const density = area<[number, number]>()
        .curve(curveBasis)
        .y((d) => d[1])
        .x0(AXIS)
        .x1((d) => AXIS - d[0] * AXIS);
    const outline = line<[number, number]>()
        .curve(curveBasis)
        .x((d) => AXIS - d[0] * AXIS)
        .y((d) => d[1]);

    /** Each lane's bars by height, a step at a time; days without a bar stay out. */
    const projections = $derived(
        layout.lanes.flatMap((lane) => {
            if (lane.state !== 'data' || lane.kind === 'city') return [];
            const bins = new Array<number>(Math.ceil(lane.height / STEP)).fill(0);
            const byHeight: { h: number; i: number }[] = [];
            for (let i = 0; i < count; i++) {
                const h = barHeight(lane, i);
                if (h <= 0) continue;
                bins[Math.min(bins.length - 1, Math.floor(h / STEP))]++;
                byHeight.push({ h, i });
            }
            byHeight.sort((a, b) => a.h - b.h || a.i - b.i);
            const smooth = bins.map((_, k) => {
                let sum = 0;
                let weight = 0;
                KERNEL.forEach((w, j) => {
                    const n = bins[k + j - 2];
                    if (n === undefined) return;
                    sum += w * n;
                    weight += w;
                });
                return sum / weight;
            });
            const peak = Math.max(...smooth) || 1;
            const floor = lane.top + lane.height;
            // Nothing at the lane's floor and top, so the curve closes on the axis.
            const points: [number, number][] = [
                [0, floor],
                ...smooth.map((n, k): [number, number] => [n / peak, floor - (k + 0.5) * STEP]),
                [0, lane.top],
            ];
            return [
                { lane, byHeight, area: density(points) ?? '', outline: outline(points) ?? '' },
            ];
        })
    );

    /**
     * The day whose bar stands nearest the pointer's height in the projection
     * it is on; none between two lanes.
     */
    function dayAtHeight(event: MouseEvent): string | null {
        const y = event.clientY - (event.currentTarget as Element).getBoundingClientRect().top;
        const projection = projections.find(
            (p) => y >= p.lane.top && y < p.lane.top + p.lane.height
        );
        const list = projection?.byHeight ?? [];
        if (!projection || list.length === 0) return null;
        const target = projection.lane.top + projection.lane.height - y;
        let lo = 0;
        let hi = list.length - 1;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (list[mid].h < target) lo = mid + 1;
            else hi = mid;
        }
        const before = list[lo - 1];
        const pick =
            before && Math.abs(before.h - target) <= Math.abs(list[lo].h - target)
                ? before
                : list[lo];
        return days.days[pick.i] ?? null;
    }

    function onProjectionMove(event: PointerEvent) {
        const day = dayAtHeight(event);
        if (day !== hovered) onHover(day);
    }

    function onProjectionClick(event: MouseEvent) {
        const day = dayAtHeight(event);
        if (day && first && last && day >= first && day <= last) onPick(day);
    }

    /** The selected and hovered days' heights in a lane, to mark across its projection. */
    function marks(lane: Lane): { hovered: boolean; h: number }[] {
        const out: { hovered: boolean; h: number }[] = [];
        if (selected && selectedShare !== null) {
            const h = barHeight(lane, dayOfYear(selected));
            if (h > 0) out.push({ hovered: false, h });
        }
        if (hovered && hovered !== selected && hoveredShare !== null) {
            const h = barHeight(lane, dayOfYear(hovered));
            if (h > 0) out.push({ hovered: true, h });
        }
        return out;
    }

    /** From the day after the exports' end to the 31st of December. */
    const tail = $derived(end ? (dayOfYear(end) + 1) / count : null);

    function cityColor(city: string): string {
        const rank = ranks.get(city);
        return rank !== undefined && rank < 8 ? categoricalColor(rank) : otherColor();
    }

    /** Column `i`'s left edge and width in whole pixels, so neighbours never overlap or part. */
    function column(i: number, step: number): [number, number] {
        const x = Math.floor(i * step);
        return [x, Math.max(1, Math.floor((i + 1) * step) - x)];
    }

    function draw() {
        if (!canvas || trackWidth <= 0) return;
        const dpr = window.devicePixelRatio || 1;
        canvas.width = Math.round(trackWidth * dpr);
        canvas.height = Math.round(layout.height * dpr);
        canvas.style.width = `${trackWidth}px`;
        canvas.style.height = `${layout.height}px`;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, trackWidth, layout.height);

        const step = trackWidth / count;
        for (const lane of layout.lanes) {
            if (lane.state !== 'data') continue;
            if (lane.kind === 'zones') drawZones(ctx, lane, step);
            else if (lane.kind === 'city') drawCities(ctx, lane, step);
            else drawBars(ctx, lane, step);
        }
    }

    /** Each day at its height on the lane's scale — the one the other two charts read too. */
    function drawBars(ctx: CanvasRenderingContext2D, lane: Lane, step: number) {
        const fills = days.fills[lane.module] ?? [];
        ctx.fillStyle = fillColor(lane.module);
        const floor = lane.top + lane.height;
        fills.forEach((fill, i) => {
            if (fill === null || fill <= 0) return;
            const h = Math.max(1, fill * lane.height);
            const [x, w] = column(i, step);
            ctx.fillRect(x, floor - h, w, h);
        });
    }

    /** Each day at its heartbeats, split by its time in each band, the filled hours on top. */
    function drawZones(ctx: CanvasRenderingContext2D, lane: Lane, step: number) {
        const stops = data.health?.stops ?? [];
        const floor = lane.top + lane.height;
        const filled = themeHsl('--border-strong', '#999185');
        days.days.forEach((day, i) => {
            const height = barHeight(lane, i);
            if (height <= 0) return;
            const [x, w] = column(i, step);
            const bands = zonesByDay.get(day) ?? [];
            // A day the clocks went back has 25 hours to share the bar between.
            const span = Math.max(
                DAY_MINUTES,
                bands.reduce((sum, v) => sum + v, 0)
            );
            let y = floor;
            bands.forEach((minutes, band) => {
                if (minutes <= 0 || !stops[band]) return;
                const h = (minutes / span) * height;
                y -= h;
                ctx.fillStyle = stops[band].color;
                ctx.fillRect(x, y, w, h);
            });
            ctx.fillStyle = filled;
            ctx.fillRect(x, floor - height, w, Math.max(0, y - (floor - height)));
        });
    }

    function drawCities(ctx: CanvasRenderingContext2D, lane: Lane, step: number) {
        days.days.forEach((day, i) => {
            const city = cityByDay.get(day);
            if (!city) return;
            const [x, w] = column(i, step);
            ctx.fillStyle = cityColor(city);
            ctx.fillRect(x, lane.top, w, lane.height);
        });
    }

    /** What a lane counts, and its year in full — the label's tooltip. */
    function laneTitle(lane: Lane): string {
        if (lane.kind === 'city') return 'Where each day began';
        const unit = laneUnit(lane.module, context.measure);
        const glyph = lane.state === 'data' ? glyphs[lane.module] : undefined;
        if (!glyph) return unit;
        const from = glyph.from ? `, from ${monthDay(glyph.from)}` : '';
        const to = glyph.to ? `, to ${monthDay(glyph.to)}` : '';
        return `${unit} · ${year}: ${yearTotalText(lane.module, glyph.total, context.measure)}${from}${to}`;
    }

    function dayAt(x: number): number {
        return Math.floor((x / trackWidth) * count);
    }

    function onMove(event: PointerEvent) {
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        const day = days.days[dayAt(event.clientX - rect.left)] ?? null;
        if (day !== hovered) onHover(day);
    }

    /**
     * The module whose lane the pointer is on, its name included; between two
     * lanes, the one before stays. A lane with nothing in it points at none.
     */
    function onLaneMove(event: PointerEvent) {
        const y = event.clientY - (event.currentTarget as Element).getBoundingClientRect().top;
        const lane = layout.lanes.find((l) => y >= l.top && y < l.top + l.height);
        if (lane) onModule(lane.state === 'data' ? lane.module : null);
    }

    function onLeave() {
        onHover(null);
    }

    function onClick(event: MouseEvent) {
        if (!canvas || !first || !last) return;
        const i = dayAt(event.clientX - canvas.getBoundingClientRect().left);
        const day = days.days[i];
        if (day && day >= first && day <= last) onPick(day);
    }

    $effect(() => {
        void themeStore.theme;
        void layout;
        void days;
        void trackWidth;
        draw();
    });
</script>

<div class="lanes" bind:clientWidth={width} style:--labels="{GUTTER}px">
    <div class="months" style:height="{LANE_HEAD}px">
        {#each months as month (month.share)}
            <span class="month" style:left="calc({LEFT}px + (100% - {LEFT}px) * {month.share})">
                {month.name}
            </span>
        {/each}
        {#if selected && selectedShare !== null}
            <span
                class="pin"
                style:left="calc({LEFT}px + (100% - {LEFT}px) * {selectedShare + 0.5 / count})"
            >
                {shortDay(selected)}
            </span>
        {/if}
    </div>

    <div
        class="body"
        style:height="{layout.height}px"
        role="presentation"
        onpointermove={onLaneMove}
        onpointerleave={() => onModule(null)}
    >
        {#each layout.lanes as lane (lane.key)}
            {@const module = moduleById(lane.module)}
            <div
                class="row"
                class:missing={lane.state === 'missing'}
                style:top="{lane.top}px"
                style:height="{lane.height}px"
                data-module={module.id}
            >
                <div class="gutter" title={laneTitle(lane)}>
                    {#if lane.kind === 'city'}
                        <span class="city-label">City</span>
                    {:else}
                        {@const glyph = lane.state === 'data' ? glyphs[lane.module] : undefined}
                        <Icon name={module.icon} size={18} />
                        <span class="label">
                            <span class="name">{module.label}</span>
                            {#if glyph}
                                <span class="total">
                                    {laneTotalText(lane.module, glyph.total, context.measure)}
                                </span>
                            {/if}
                        </span>
                    {/if}
                </div>
                <div class="room" style:flex-basis="{LEFT - GUTTER}px"></div>
                <div class="track"></div>
            </div>
        {/each}

        <!-- The keyboard steps through the days with ← and →; a click is the pointer's way. -->
        <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
        <svg
            class="projections"
            style:left="{GUTTER}px"
            width={LEFT - GUTTER}
            height={layout.height}
            role="group"
            aria-label="Each lane's days by height"
            onpointermove={onProjectionMove}
            onpointerleave={onLeave}
            onclick={onProjectionClick}
        >
            {#each projections as projection (projection.lane.key)}
                {@const floor = projection.lane.top + projection.lane.height}
                <path
                    class="density"
                    d={projection.area}
                    style:fill="var(--fill-{projection.lane.module})"
                />
                <path
                    class="contour"
                    d={projection.outline}
                    style:stroke="var(--peak-{projection.lane.module})"
                />
                {#each marks(projection.lane) as mark (mark.hovered)}
                    <line
                        class="tick"
                        class:tick-hovered={mark.hovered}
                        x1="0"
                        x2={LEFT - GUTTER}
                        y1={floor - mark.h}
                        y2={floor - mark.h}
                    />
                {/each}
            {/each}
        </svg>

        <div class="layer" style:left="{LEFT}px">
            {#each months.slice(1) as month (month.share)}
                <div class="month-line" style:left="{month.share * 100}%"></div>
            {/each}
            <canvas
                bind:this={canvas}
                onpointermove={onMove}
                onpointerleave={onLeave}
                onclick={onClick}
            ></canvas>

            {#each layout.lanes as lane (lane.key)}
                {#if lane.state === 'missing'}
                    <div class="hatch note" style:top="{lane.top}px" style:height="{lane.height}px">
                        Not imported
                        <button type="button" class="add" onclick={() => onAdd(lane.module)}>
                            Add
                        </button>
                    </div>
                {:else if lane.state === 'empty' && lane.kind !== 'city'}
                    <div class="hatch note" style:top="{lane.top}px" style:height="{lane.height}px">
                        {emptyNote(coverage[lane.module], year)}
                    </div>
                {:else if lane.kind !== 'city'}
                    {@const lead = leadIn(coverage[lane.module], year, count, dayOfYear)}
                    {#if lead}
                        <div
                            class="hatch lead"
                            style:top="{lane.top}px"
                            style:height="{lane.height}px"
                            style:width="{lead.share * 100}%"
                        >
                            {lead.text}
                        </div>
                    {/if}
                {/if}
            {/each}

            {#if tail !== null && tail < 1}
                <div class="hatch tail" style:left="{tail * 100}%">
                    Exports end {end ? monthDay(end) : ''}
                </div>
            {/if}

            {#if selectedShare !== null}
                <div
                    class="selection"
                    style:left="{selectedShare * 100}%"
                    style:width="max(3px, {100 / count}%)"
                ></div>
            {/if}

            {#if hoveredShare !== null && hovered !== selected}
                <div
                    class="hovered"
                    style:left="{hoveredShare * 100}%"
                    style:width="max(3px, {100 / count}%)"
                ></div>
            {/if}
        </div>
    </div>
</div>

<style>
    .lanes {
        display: flex;
        flex-direction: column;
    }

    .months {
        position: relative;
    }

    .month {
        position: absolute;
        bottom: 4px;
        padding-left: 4px;
        font-size: var(--text-label);
        color: hsl(var(--muted-foreground));
        white-space: nowrap;
    }

    .month-line {
        position: absolute;
        top: 0;
        bottom: 0;
        width: 1px;
        background: hsl(var(--border));
    }

    .pin {
        position: absolute;
        bottom: 2px;
        z-index: 2;
        transform: translateX(-50%);
        padding: 2px 8px;
        border: 1px solid hsl(var(--border));
        border-radius: var(--radius-sm);
        font-size: var(--text-label);
        font-weight: 600;
        white-space: nowrap;
        color: hsl(var(--foreground));
        background: hsl(var(--popover));
        box-shadow: 0 4px 14px rgb(0 0 0 / 0.18);
        pointer-events: none;
    }

    .body {
        position: relative;
    }

    .row {
        position: absolute;
        left: 0;
        right: 0;
        display: flex;
        align-items: stretch;
    }

    .gutter {
        flex: 0 0 var(--labels);
        box-sizing: border-box;
        display: flex;
        align-items: center;
        gap: 8px;
        min-width: 0;
        padding-right: 8px;
        color: hsl(var(--foreground));
    }

    .gutter :global(svg) {
        flex: none;
        color: var(--module-accent);
    }

    .missing .gutter {
        opacity: 0.5;
    }

    .label {
        display: flex;
        flex-direction: column;
        gap: 1px;
        min-width: 0;
    }

    .name {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        font-size: 0.82rem;
        font-weight: 600;
        line-height: 1.2;
        white-space: nowrap;
    }

    .total {
        font-size: var(--text-small);
        font-weight: 600;
        line-height: 1.2;
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
        color: var(--module-accent);
    }

    .city-label {
        padding-left: 26px;
        font-size: var(--text-label);
        line-height: 1;
        color: hsl(var(--muted-foreground));
    }

    .room {
        flex: 0 0 auto;
    }

    .projections {
        position: absolute;
        top: 0;
        overflow: visible;
        cursor: pointer;
    }

    .projections path,
    .projections line {
        pointer-events: none;
    }

    .projections .density {
        opacity: 0.28;
    }

    .projections .contour {
        fill: none;
        stroke-width: 1.25;
        stroke-linejoin: round;
    }

    /* The selected day's height, across the projection to the bars' edge;
       dashed for the hovered one, as in the lanes. */
    .projections .tick {
        stroke: hsl(var(--heading));
        stroke-width: 1.5;
    }

    .projections .tick-hovered {
        stroke: hsl(var(--foreground));
        stroke-width: 1;
        stroke-dasharray: 2 2;
    }

    .track {
        flex: 1 1 auto;
        min-width: 0;
        background: color-mix(in srgb, hsl(var(--secondary)) 45%, transparent);
    }

    .layer {
        position: absolute;
        top: 0;
        right: 0;
        bottom: 0;
    }

    canvas {
        position: absolute;
        inset: 0;
        cursor: pointer;
    }

    .hatch {
        position: absolute;
        box-sizing: border-box;
        display: flex;
        align-items: center;
        gap: 10px;
        overflow: hidden;
        padding: 0 12px;
        font-size: var(--text-label);
        line-height: 1;
        white-space: nowrap;
        color: hsl(var(--muted-foreground));
        background: repeating-linear-gradient(
            135deg,
            hsl(var(--border)) 0 1px,
            transparent 1px 6px
        );
    }

    /* The pointer goes through to the canvas, so the hovered column follows it
       across every lane; only the Add link takes the click. */
    .note {
        left: 0;
        right: 0;
        pointer-events: none;
    }

    .note .add {
        pointer-events: auto;
    }

    .lead {
        left: 0;
        padding-left: 8px;
        pointer-events: none;
    }

    .tail {
        top: 0;
        bottom: 0;
        right: 0;
        align-items: flex-start;
        justify-content: center;
        padding-top: 8px;
        background: repeating-linear-gradient(
            135deg,
            hsl(var(--border)) 0 1px,
            hsl(var(--background)) 1px 6px
        );
        pointer-events: none;
    }

    .add {
        border: 0;
        padding: 0;
        font: inherit;
        color: hsl(var(--muted-foreground));
        text-decoration: underline;
        text-underline-offset: 2px;
        background: transparent;
        cursor: pointer;
    }

    .add:hover {
        color: hsl(var(--foreground));
    }

    .selection {
        position: absolute;
        top: -4px;
        bottom: -4px;
        transform: translateX(-1px);
        border-radius: 2px;
        background: color-mix(in srgb, hsl(var(--heading)) 20%, transparent);
        box-shadow: 0 0 0 1px color-mix(in srgb, hsl(var(--heading)) 45%, transparent);
        pointer-events: none;
    }

    /* The hovered day: an outline without the selection's fill, so the two
       never read as the same mark. */
    .hovered {
        position: absolute;
        top: -2px;
        bottom: -2px;
        transform: translateX(-1px);
        border-radius: 2px;
        background: color-mix(in srgb, hsl(var(--foreground)) 7%, transparent);
        outline: 1px dashed color-mix(in srgb, hsl(var(--foreground)) 55%, transparent);
        pointer-events: none;
    }
</style>
