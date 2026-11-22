<script lang="ts">
    import { moduleById, type ModuleId } from '#lib/data/modules.ts';
    import type { Measure } from '#lib/data/sql/measure.ts';
    import type { YearRow } from '#lib/calendar/years.ts';
    import { CALENDAR_ORDER, yearTotalText } from '#lib/calendar/figures.ts';
    import { monthDay, yearLabel } from '#lib/calendar/dates.ts';

    /**
     * The year switcher in the header: one button per year, each carrying six
     * thin bars — one per module, in the sidebar's order, scaled to that
     * module's best year. The numbers behind the bars are in the tooltip.
     *
     * A bar drawn at half strength is a year the module only partly covers
     * (its export starts late in it, or stops early); a flat grey tick is a
     * module with nothing that year, or nothing imported.
     *
     * The buttons stay on one line however many years there are: the strip
     * scrolls sideways, keeps the open year in view, and the arrows either side
     * step to the previous or next year that holds anything.
     */
    interface Props {
        rows: YearRow[];
        selected: number | null;
        loaded: Record<ModuleId, boolean>;
        measure: Measure;
        onPick: (year: number) => void;
    }

    let { rows, selected, loaded, measure, onPick }: Props = $props();

    const modules = CALENDAR_ORDER.map((id) => moduleById(id));

    /** The tallest bar, in pixels: a module's best year. */
    const BAR_HEIGHT = 16;

    let strip = $state<HTMLElement | null>(null);

    /** The years that hold anything, oldest first: where the arrows step. */
    const years = $derived(rows.filter((row) => row.lastDay).map((row) => row.year));
    const at = $derived(selected === null ? -1 : years.indexOf(selected));
    const previous = $derived(at > 0 ? years[at - 1] : null);
    const next = $derived(at >= 0 && at < years.length - 1 ? years[at + 1] : null);

    // Scroll the open year into the strip when it falls outside it.
    $effect(() => {
        void selected;
        void rows;
        if (!strip) return;
        const open = strip.querySelector<HTMLElement>('[aria-pressed="true"]');
        if (!open) return;
        const left = open.offsetLeft;
        const right = left + open.offsetWidth;
        if (left < strip.scrollLeft) strip.scrollLeft = left - 4;
        else if (right > strip.scrollLeft + strip.clientWidth) {
            strip.scrollLeft = right - strip.clientWidth + 4;
        }
    });

    function tooltip(row: YearRow): string {
        if (!row.lastDay) return `${row.year} · nothing recorded`;
        const parts = [`${row.year}${row.to ? `, to ${monthDay(row.to)}` : ''}`];
        for (const module of modules) {
            const glyph = row.glyphs[module.id];
            if (!loaded[module.id] || !glyph) continue;
            const from = glyph.from ? ` from ${monthDay(glyph.from)}` : '';
            parts.push(`${module.label} ${yearTotalText(module.id, glyph.total, measure)}${from}`);
        }
        return parts.join(' · ');
    }
</script>

<div class="picker">
    <button
        type="button"
        class="step"
        aria-label="Previous year"
        disabled={previous === null}
        onclick={() => previous !== null && onPick(previous)}
    >
        ‹
    </button>
    <nav class="years" aria-label="Year" bind:this={strip}>
        {#each rows as row (row.year)}
            <button
                type="button"
                class="year"
                aria-pressed={row.year === selected}
                aria-label={String(row.year)}
                title={tooltip(row)}
                disabled={!row.lastDay}
                onclick={() => onPick(row.year)}
            >
                <span class="glyph" aria-hidden="true">
                    {#each modules as module (module.id)}
                        {@const glyph = loaded[module.id] ? row.glyphs[module.id] : undefined}
                        <span
                            class="bar"
                            class:empty={!glyph}
                            class:partial={glyph && (glyph.from || glyph.to)}
                            data-module={module.id}
                            style:height="{glyph
                                ? Math.max(2, Math.round(glyph.share * BAR_HEIGHT))
                                : 1.5}px"
                        ></span>
                    {/each}
                </span>
                {yearLabel(row.year)}
            </button>
        {/each}
    </nav>
    <button
        type="button"
        class="step"
        aria-label="Next year"
        disabled={next === null}
        onclick={() => next !== null && onPick(next)}
    >
        ›
    </button>
</div>

<style>
    .picker {
        display: flex;
        align-items: center;
        gap: 2px;
        min-width: 0;
    }

    .years {
        position: relative;
        display: flex;
        flex-wrap: nowrap;
        gap: 2px;
        min-width: 0;
        padding: 2px;
        overflow-x: auto;
        scroll-behavior: smooth;
        scrollbar-width: none;
        border: 1px solid hsl(var(--border));
        border-radius: 9px;
        background: hsl(var(--secondary) / 0.5);
    }

    .years::-webkit-scrollbar {
        display: none;
    }

    .step {
        flex: none;
        width: 28px;
        height: 28px;
        border: 0;
        border-radius: var(--radius-sm);
        font: inherit;
        font-size: 1.15rem;
        line-height: 1;
        color: hsl(var(--muted-foreground));
        background: transparent;
        cursor: pointer;
    }

    .step:hover:not(:disabled) {
        color: hsl(var(--foreground));
        background: hsl(var(--accent));
    }

    .step:disabled {
        cursor: default;
        opacity: 0.35;
    }

    .year {
        flex: none;
        display: inline-flex;
        align-items: center;
        gap: 7px;
        padding: 0.25rem 0.7rem 0.25rem 0.6rem;
        border: 0;
        border-radius: var(--radius-sm);
        font: inherit;
        font-size: var(--text-body);
        font-variant-numeric: tabular-nums;
        color: hsl(var(--muted-foreground));
        background: transparent;
        cursor: pointer;
        transition:
            color 0.15s,
            background-color 0.15s;
    }

    .year:hover:not(:disabled) {
        color: hsl(var(--foreground));
        background: hsl(var(--accent));
    }

    .year[aria-pressed='true'] {
        font-weight: 600;
        color: hsl(var(--heading));
        background: hsl(var(--card));
        box-shadow: inset 0 0 0 1px hsl(var(--border-strong));
    }

    .year:disabled {
        cursor: default;
        opacity: 0.5;
    }

    .year:focus-visible {
        outline: 2px solid hsl(var(--ring));
        outline-offset: 1px;
    }

    .glyph {
        display: flex;
        align-items: flex-end;
        gap: 2px;
        height: 16px;
    }

    .bar {
        display: block;
        width: 3px;
        border-radius: 1.5px 1.5px 0 0;
        background: var(--module-fill);
    }

    .bar.partial {
        background: color-mix(in srgb, var(--module-fill) 50%, transparent);
    }

    .bar.empty {
        background: hsl(var(--border-strong));
    }
</style>
