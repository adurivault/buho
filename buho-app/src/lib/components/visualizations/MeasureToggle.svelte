<script lang="ts" module>
    export type MeasureOption<T extends string = string> = {
        key: T;
        label: string;
        /** Shown under the control: what the number now counts. */
        hint?: string;
    };
</script>

<script lang="ts">
    /**
     * Picks what every figure on an explorer counts.
     *
     * Deliberately sits *with* the breakdowns it rescales rather than up in the
     * page header: when the control is far from the charts, changing it looks
     * like nothing happened. Here the pies and bars redraw right beside it.
     */
    interface Props {
        options: MeasureOption[];
        value: string;
        onChange: (key: string) => void;
        /** Leading label; set to null for a bare control. */
        label?: string | null;
    }

    let { options, value, onChange, label = "Measure" }: Props = $props();

    const active = $derived(options.find((o) => o.key === value) ?? options[0]);
</script>

<div class="measure">
    {#if label}
        <span class="measure-label">{label}</span>
    {/if}
    <div class="measure-toggle" role="group" aria-label={label ?? "Measure"}>
        {#each options as option (option.key)}
            <button
                type="button"
                class="measure-btn"
                class:active={value === option.key}
                aria-pressed={value === option.key}
                onclick={() => onChange(option.key)}
            >
                {option.label}
            </button>
        {/each}
    </div>
    {#if active?.hint}
        <span class="measure-hint">{active.hint}</span>
    {/if}
</div>

<style>
    .measure {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 0.3rem;
        flex: none;
    }

    .measure-label {
        font-size: 0.7rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: hsl(var(--muted-foreground));
    }

    .measure-toggle {
        display: inline-flex;
        border: 1px solid hsl(var(--border));
        border-radius: 0.55rem;
        overflow: hidden;
        background: hsl(var(--background));
    }

    .measure-btn {
        padding: 0.4rem 0.75rem;
        font-size: 0.8rem;
        cursor: pointer;
        color: hsl(var(--muted-foreground));
        background: transparent;
        border: none;
        border-left: 1px solid hsl(var(--border));
        transition:
            color 0.18s ease,
            background-color 0.18s ease;
    }

    .measure-btn:first-child {
        border-left: none;
    }

    .measure-btn:hover {
        color: hsl(var(--foreground));
    }

    .measure-btn.active {
        color: hsl(var(--background));
        background: var(--source-accent, hsl(var(--foreground)));
        font-weight: 600;
    }

    .measure-hint {
        font-size: 0.68rem;
        color: hsl(var(--muted-foreground));
    }
</style>
