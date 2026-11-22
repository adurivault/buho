<script lang="ts">
    import Icon from '#lib/components/Icon.svelte';
    import { moduleById, type ModuleId } from '#lib/data/modules.ts';
    import { serviceLabel } from '#lib/data/queries/activityQueries.ts';
    import type { Coverage } from '#lib/calendar/days.ts';
    import {
        CALENDAR_ORDER,
        dayTrackText,
        emptyTrackText,
        type FigureContext,
    } from '#lib/calendar/figures.ts';
    import { clock, fullDay } from '#lib/calendar/dates.ts';
    import {
        DAY_MINUTES,
        SPEED_BIN_MINUTES,
        type DayTimeline,
        type SpeedBin,
    } from '#lib/calendar/timeline.ts';
    import {
        conversationRows,
        serviceRows,
        type Tick,
        type TickRow,
    } from '#lib/calendar/tracks.ts';
    import { receivedColor, sentColor } from '#lib/utils/dimensionColors.ts';
    import { peakColor } from '#lib/visualizations/themeColors.ts';
    import { colorAt } from '#lib/visualizations/healthRamp.ts';
    import ChartTip from './ChartTip.svelte';

    /**
     * The open day on one clock, a track per module: places and trips,
     * listening, messages by contact, Google activity by service, steps and
     * heart rate per quarter-hour. Each module's figure for the day sits under
     * its name; what the track counts is in the name's tooltip, as on the
     * year's lanes. Messages and Google activity give a row per contact or
     * service, under a line carrying the module's name and total.
     *
     * Every mark carries its tooltip in `data-tip`, read by one pointer handler
     * on the whole body: a day can hold several hundred marks, and one listener
     * serves them all.
     */
    interface Props {
        day: DayTimeline;
        loaded: Record<ModuleId, boolean>;
        coverage: Partial<Record<ModuleId, Coverage>>;
        context: FigureContext;
        onAdd: (module: ModuleId) => void;
        /** The minute of the day under the pointer, null when it leaves the tracks. */
        onCursor: (minute: number | null) => void;
    }

    let { day, loaded, coverage, context, onAdd, onCursor }: Props = $props();

    const GUTTER = 160;
    const HOURS = [0, 3, 6, 9, 12, 15, 18, 21];
    /** Space above each module's first track. */
    const GAP: Record<ModuleId, number> = {
        positions: 0,
        listening: 12,
        messages: 14,
        activity: 14,
        steps: 14,
        health: 12,
    };

    type Track =
        | {
              kind: 'missing' | 'none';
              module: ModuleId;
              key: string;
              gap: number;
              note: string;
              /** A note in a contact or service row, under the module's heading. */
              small?: boolean;
          }
        | { kind: 'speed'; module: ModuleId; key: string; gap: number }
        | { kind: 'plays'; module: ModuleId; key: string; gap: number }
        | { kind: 'heading'; module: ModuleId; key: string; gap: number; unit: string }
        | {
              kind: 'ticks';
              module: ModuleId;
              key: string;
              gap: number;
              row: TickRow;
              unit: string;
          }
        | { kind: 'steps' | 'heart'; module: ModuleId; key: string; gap: number };

    let width = $state(0);

    let body = $state<HTMLDivElement | null>(null);
    let tip = $state<{ x: number; y: number; text: string } | null>(null);

    /** The minute under the pointer, drawn as a line across the tracks. */
    let cursor = $state<number | null>(null);

    function onMove(event: PointerEvent) {
        if (!body) return;
        const rect = body.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const lanes = rect.width - GUTTER;
        const minute =
            x >= GUTTER && lanes > 0
                ? Math.min(DAY_MINUTES - 1, Math.floor(((x - GUTTER) / lanes) * DAY_MINUTES))
                : null;
        if (minute !== cursor) {
            cursor = minute;
            onCursor(minute);
        }

        const mark = event.target instanceof Element ? event.target.closest('[data-tip]') : null;
        const text = mark?.getAttribute('data-tip');
        tip = text ? { x, y: event.clientY - rect.top, text } : null;
    }

    function onLeave() {
        tip = null;
        cursor = null;
        onCursor(null);
    }

    /** Whether the module's export reaches the open day. */
    function covers(module: ModuleId): boolean {
        const span = coverage[module];
        return span !== undefined && day.date >= span.first && day.date <= span.last;
    }

    /** The day's figure under a track's name, or what stands in for it on an empty day. */
    function figureOf(module: ModuleId): string {
        return (
            dayTrackText(module, day, context) ??
            emptyTrackText(module, covers(module), context.measure)
        );
    }

    function noteFor(module: ModuleId): string {
        const span = coverage[module];
        if (span && day.date < span.first) return `Export starts ${fullDay(span.first)}`;
        if (span && day.date > span.last) return `Export ends ${fullDay(span.last)}`;
        return 'No record';
    }

    const tracks = $derived.by(() => {
        const list: Track[] = [];
        const gap = (module: ModuleId) => (list.length === 0 ? 0 : GAP[module]);
        for (const module of CALENDAR_ORDER) {
            if (!loaded[module]) {
                list.push({ kind: 'missing', module, key: module, gap: gap(module), note: '' });
                continue;
            }
            const none = () =>
                list.push({
                    kind: 'none',
                    module,
                    key: module,
                    gap: gap(module),
                    note: noteFor(module),
                });
            if (module === 'positions') {
                if (day.positions?.points.length) {
                    list.push({ kind: 'speed', module, key: module, gap: gap(module) });
                } else none();
            } else if (module === 'listening') {
                if (day.listening?.plays.length)
                    list.push({ kind: 'plays', module, key: module, gap: gap(module) });
                else none();
            } else if (module === 'messages' || module === 'activity') {
                const rows =
                    module === 'messages'
                        ? conversationRows(day.messages ?? [])
                        : serviceRows(day.activity ?? [], serviceLabel);
                const unit =
                    module === 'messages'
                        ? 'Each message, a row per conversation: sent in one colour, received in the other'
                        : 'Each entry, a row per service';
                // The heading is there on every day, so the name never moves;
                // only the rows under it come and go.
                list.push({
                    kind: 'heading',
                    module,
                    key: `${module}-heading`,
                    gap: gap(module),
                    unit,
                });
                if (rows.length === 0) {
                    list.push({
                        kind: 'none',
                        module,
                        key: `${module}-none`,
                        gap: 3,
                        note: noteFor(module),
                        small: true,
                    });
                    continue;
                }
                rows.forEach((row, i) =>
                    list.push({
                        kind: 'ticks',
                        module,
                        // By position: two services can read as the same name.
                        key: `${module}-${i}`,
                        gap: 3,
                        row,
                        unit,
                    })
                );
            } else if (module === 'steps') {
                if ((day.steps ?? []).some((v) => v !== null)) {
                    list.push({ kind: 'steps', module, key: module, gap: gap(module) });
                } else none();
            } else if ((day.heartRate?.quarters ?? []).some((v) => v !== null)) {
                list.push({ kind: 'heart', module, key: module, gap: gap(module) });
            } else none();
        }
        return list;
    });

    const plays = $derived(day.listening?.plays ?? []);
    const steps = $derived(day.steps ?? []);
    const stepPeak = $derived(Math.max(1, ...steps.map((v) => v ?? 0)));
    const heart = $derived(day.heartRate?.quarters ?? []);
    const heartValues = $derived(heart.filter((v): v is number => v !== null));

    const heartColor = $derived.by(() => {
        const stops = day.heartRate?.stops ?? [];
        return stops.length < 2 ? () => peakColor('health') : colorAt(stops);
    });

    const share = (minute: number) =>
        (Math.max(0, Math.min(DAY_MINUTES, minute)) / DAY_MINUTES) * 100;

    /**
     * The speed at the top of the positions track. Square-root scale, so a walk
     * still shows beside a drive; a train or a plane runs off the top, and its
     * tooltip gives the real figure.
     */
    const SPEED_TOP_KMH = 130;
    const SPEED_HEIGHT = 30;

    const bins = $derived(day.positions?.bins ?? []);

    function speedHeight(kmh: number): number {
        return Math.sqrt(Math.min(kmh, SPEED_TOP_KMH) / SPEED_TOP_KMH) * (SPEED_HEIGHT - 2);
    }

    /** The curve as a stepped area, one flat top per bin, broken where nothing was recorded. */
    const speedPath = $derived.by(() => {
        let path = '';
        let open = false;
        bins.forEach((bin, i) => {
            if (!bin) {
                if (open) path += `L${i},${SPEED_HEIGHT}Z`;
                open = false;
                return;
            }
            const top = SPEED_HEIGHT - speedHeight(bin.kmh);
            path += open
                ? `L${i},${top}L${i + 1},${top}`
                : `M${i},${SPEED_HEIGHT}L${i},${top}L${i + 1},${top}`;
            open = true;
        });
        if (open) path += `L${bins.length},${SPEED_HEIGHT}Z`;
        return path;
    });

    function speedTip(i: number, bin: SpeedBin): string {
        const from = i * SPEED_BIN_MINUTES;
        const when = `${clock(from)}–${clock(from + SPEED_BIN_MINUTES)}`;
        if (bin.km <= 0) return `${when} · still`;
        const kmh = Math.round(bin.kmh).toLocaleString();
        const km = (Math.round(bin.km * 10) / 10).toLocaleString();
        return `${when} · ${kmh} km/h · ${km} km`;
    }

    /**
     * A message tick in the colours of who wrote: yours above, theirs below
     * when a minute held both. Activity ticks keep the module's colour.
     */
    function tickFill(tick: Tick): string | undefined {
        if (tick.sent === undefined) return undefined;
        const received = tick.count - tick.sent;
        if (received === 0) return sentColor();
        if (tick.sent === 0) return receivedColor();
        return `linear-gradient(${sentColor()} 0 50%, ${receivedColor()} 50% 100%)`;
    }

    function quarterTip(q: number, text: string): string {
        return `${clock(q * 15)}–${clock(q * 15 + 15)} · ${text}`;
    }

    function unitOf(track: Track): string {
        switch (track.kind) {
            case 'speed':
                return `Speed every ${SPEED_BIN_MINUTES} minutes, square-root scale up to ${SPEED_TOP_KMH} km/h`;
            case 'plays':
                return `Each play · ${plays.length.toLocaleString()} play${plays.length === 1 ? '' : 's'}`;
            case 'heading':
            case 'ticks':
                return track.unit;
            case 'steps':
                return 'Steps per 15 minutes';
            case 'heart':
                return heartValues.length
                    ? `Mean heart rate per 15 minutes · ${Math.round(Math.min(...heartValues))}–${Math.round(Math.max(...heartValues))} bpm`
                    : 'Mean heart rate per 15 minutes';
            default:
                return '';
        }
    }

    function heightOf(track: Track): number {
        switch (track.kind) {
            case 'missing':
                return 16;
            case 'none':
                // As tall as the track it stands in for, so nothing below it moves.
                if (track.small) return 13;
                if (track.module === 'positions') return SPEED_HEIGHT;
                if (track.module === 'steps') return 42;
                return 26;
            case 'speed':
                return SPEED_HEIGHT;
            case 'heading':
                return 18;
            case 'ticks':
                return 13;
            case 'steps':
                return 42;
            default:
                return 26;
        }
    }
</script>

<div class="tracks" bind:clientWidth={width}>
    <div class="hours">
        {#each HOURS as hour (hour)}
            <span class="hour" style:left="calc({GUTTER}px + (100% - {GUTTER}px) * {hour / 24})">
                {clock(hour * 60)}
            </span>
        {/each}
    </div>

    <div
        class="body"
        role="group"
        aria-label="The day's tracks"
        bind:this={body}
        onpointermove={onMove}
        onpointerleave={onLeave}
    >
        {#each HOURS as hour (hour)}
            <div
                class="hour-line"
                style:left="calc({GUTTER}px + (100% - {GUTTER}px) * {hour / 24})"
            ></div>
        {/each}

        {#each tracks as track (track.key)}
            {@const module = moduleById(track.module)}
            <div
                class="track"
                class:missing={track.kind === 'missing'}
                style:margin-top="{track.gap}px"
                data-module={module.id}
            >
                <div
                    class="gutter"
                    style:height="{heightOf(track)}px"
                    title={unitOf(track) || undefined}
                >
                    {#if track.kind === 'ticks'}
                        <span class="indent"></span>
                        <span class="row-name">{track.row.label}</span>
                        <span class="row-count">{track.row.count.toLocaleString()}</span>
                    {:else if track.kind === 'heading'}
                        <Icon name={module.icon} size={18} />
                        <span class="name">{module.label}</span>
                        <span class="figure">{figureOf(track.module)}</span>
                    {:else if track.kind === 'none' && track.small}
                        <span class="indent"></span>
                    {:else}
                        {@const figure = track.kind === 'missing' ? null : figureOf(track.module)}
                        <Icon name={module.icon} size={18} />
                        <span class="label">
                            <span class="name">{module.label}</span>
                            {#if figure}
                                <span class="figure">{figure}</span>
                            {/if}
                        </span>
                    {/if}
                </div>

                <div
                    class="lane"
                    class:bare={track.kind === 'heading'}
                    style:height="{heightOf(track)}px"
                >
                    {#if track.kind === 'heading'}
                        {#if track.module === 'messages'}
                            <span class="legend">
                                <i style:background={sentColor()}></i>Sent
                                <i style:background={receivedColor()}></i>Received
                            </span>
                        {/if}
                    {:else if track.kind === 'missing'}
                        <div class="hatch">
                            Not imported
                            <button type="button" class="add" onclick={() => onAdd(track.module)}>
                                Add
                            </button>
                        </div>
                    {:else if track.kind === 'none'}
                        <div class="hatch">{track.note}</div>
                    {:else if track.kind === 'speed'}
                        <svg
                            class="speed"
                            viewBox="0 0 {bins.length} {SPEED_HEIGHT}"
                            preserveAspectRatio="none"
                            aria-hidden="true"
                        >
                            <path d={speedPath} />
                        </svg>
                        {#each bins as bin, i (i)}
                            {#if bin}
                                <div
                                    class="speed-hit"
                                    style:left="{(i / bins.length) * 100}%"
                                    style:width="{100 / bins.length}%"
                                    data-tip={speedTip(i, bin)}
                                ></div>
                            {/if}
                        {/each}
                    {:else if track.kind === 'plays'}
                        {#each plays as play, i (i)}
                            <div
                                class="play"
                                style:left="{share(play.start)}%"
                                style:width="max(1px, {share(play.start + (play.minutes ?? 0)) -
                                    share(play.start)}%)"
                                data-tip="{clock(play.start)} · {play.track ??
                                    'Unknown track'}{play.artist ? ` — ${play.artist}` : ''}"
                            ></div>
                        {/each}
                    {:else if track.kind === 'ticks'}
                        {#each track.row.ticks as tick (tick.minute)}
                            <div
                                class="tick"
                                style:left="{share(tick.minute)}%"
                                style:background={tickFill(tick)}
                                data-tip={tick.tip}
                            ></div>
                        {/each}
                    {:else if track.kind === 'steps'}
                        <div class="quarters">
                            {#each steps as value, q (q)}
                                <div
                                    class="step"
                                    style:height="{value
                                        ? Math.max(1, (value / stepPeak) * 40)
                                        : 0}px"
                                    data-tip={quarterTip(
                                        q,
                                        value ? `${value.toLocaleString()} steps` : 'no steps'
                                    )}
                                ></div>
                            {/each}
                        </div>
                    {:else if track.kind === 'heart'}
                        <div class="quarters band">
                            {#each heart as value, q (q)}
                                <div
                                    class="beat"
                                    style:background={value === null
                                        ? 'transparent'
                                        : heartColor(value)}
                                    data-tip={quarterTip(
                                        q,
                                        value === null ? 'no reading' : `${Math.round(value)} bpm`
                                    )}
                                ></div>
                            {/each}
                        </div>
                    {/if}
                </div>
            </div>
        {/each}

        {#if cursor !== null}
            <div
                class="cursor"
                style:left="calc({GUTTER}px + (100% - {GUTTER}px) * {cursor / DAY_MINUTES})"
            ></div>
        {/if}

        {#if tip}
            <ChartTip x={tip.x} y={tip.y} {width} text={tip.text} />
        {/if}
    </div>
</div>

<style>
    .tracks {
        display: flex;
        flex-direction: column;
        margin-top: 8px;
    }

    .hours {
        position: relative;
        height: 22px;
    }

    .hour {
        position: absolute;
        bottom: 4px;
        padding-left: 4px;
        font-family: var(--font-mono);
        font-size: 0.7rem;
        color: hsl(var(--muted-foreground));
        white-space: nowrap;
    }

    .body {
        position: relative;
        display: flex;
        flex-direction: column;
    }

    .cursor {
        position: absolute;
        top: 0;
        bottom: 0;
        width: 1px;
        background: color-mix(in srgb, hsl(var(--foreground)) 45%, transparent);
        pointer-events: none;
    }

    .hour-line {
        position: absolute;
        top: 0;
        bottom: 0;
        width: 1px;
        background: hsl(var(--border));
    }

    .track {
        position: relative;
        display: flex;
        align-items: center;
    }

    .gutter {
        flex: 0 0 160px;
        box-sizing: border-box;
        display: flex;
        align-items: center;
        gap: 8px;
        min-width: 0;
        padding-right: 12px;
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
        font-size: var(--text-body);
        font-weight: 600;
        line-height: 1.2;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .figure {
        font-size: var(--text-small);
        font-weight: 600;
        line-height: 1.2;
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
        color: var(--module-accent);
    }

    .indent {
        flex: 0 0 18px;
    }

    .row-name {
        flex: 1 1 auto;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        font-size: var(--text-label);
        line-height: 1;
        white-space: nowrap;
    }

    .row-count {
        font-family: var(--font-mono);
        font-size: 0.68rem;
        line-height: 1;
        font-variant-numeric: tabular-nums;
        color: hsl(var(--muted-foreground));
    }

    .lane {
        position: relative;
        flex: 1 1 auto;
        min-width: 0;
        overflow: hidden;
        background: color-mix(in srgb, hsl(var(--secondary)) 45%, transparent);
    }

    /* The line naming messages or activity carries no marks of its own. */
    .lane.bare {
        background: transparent;
    }

    .legend {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        height: 100%;
        font-size: var(--text-label);
        color: hsl(var(--muted-foreground));
    }

    .legend i {
        width: 8px;
        height: 8px;
        border-radius: 2px;
    }

    .legend i:not(:first-child) {
        margin-left: 8px;
    }

    .hatch {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        gap: 10px;
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

    .speed {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
    }

    .speed path {
        fill: var(--module-fill);
    }

    .speed-hit {
        position: absolute;
        top: 0;
        bottom: 0;
    }

    .play {
        position: absolute;
        top: 3px;
        height: 20px;
        border-radius: 1px;
        background: var(--module-fill);
    }

    .tick {
        position: absolute;
        top: 1px;
        width: 2px;
        height: 11px;
        border-radius: 1px;
        background: var(--module-peak);
    }

    .quarters {
        display: flex;
        align-items: flex-end;
        gap: 1px;
        height: 100%;
    }

    .quarters.band {
        align-items: stretch;
        gap: 0;
    }

    .step {
        flex: 1 1 0;
        min-width: 0;
        background: var(--module-fill);
    }

    .beat {
        flex: 1 1 0;
        min-width: 0;
    }
</style>
