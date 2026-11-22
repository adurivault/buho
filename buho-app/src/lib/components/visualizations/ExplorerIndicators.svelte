<script lang="ts" module>
    export type Indicator = {
        /** Already formatted, in the browser's locale. */
        value: string;
        label: string;
    };
</script>

<script lang="ts">
    /**
     * The figures across the top of an Explorer, over the whole export: each a
     * value in the module's colour above its label.
     */
    interface Props {
        items: Indicator[];
    }

    let { items }: Props = $props();
</script>

<div class="indicators" aria-label="Global indicators">
    {#each items as item (item.label)}
        <div class="indicator">
            <span class="value">{item.value}</span>
            <span class="label">{item.label}</span>
        </div>
    {/each}
</div>

<style>
    .indicators {
        display: flex;
        gap: 1.5rem;
    }

    .indicator {
        display: flex;
        flex-direction: column;
        line-height: 1.1;
    }

    .value {
        font-size: var(--text-figure);
        font-weight: 700;
        color: var(--module-accent);
        font-variant-numeric: tabular-nums;
    }

    .label {
        font-size: var(--text-label);
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: hsl(var(--muted-foreground));
    }
</style>
