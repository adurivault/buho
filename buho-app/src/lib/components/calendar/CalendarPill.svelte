<script lang="ts">
    import { dataStore } from '#lib/stores/dataStore.svelte.ts';
    import { DATA_MODULES } from '#lib/data/modules.ts';

    /**
     * The header's data status for the calendar, and the way into the import
     * dialog — `ImportPill`, but for every module at once: how many modules are
     * loaded (which exports fill them is in the tooltip, so the pill stays
     * short however many there are), or that what is on screen is the sample.
     */
    interface Props {
        onAdd: () => void;
    }

    let { onAdd }: Props = $props();

    const demoModules = $derived(DATA_MODULES.filter((module) => dataStore.isSample(module.id)));
    const loadedCount = $derived(
        DATA_MODULES.filter((module) => dataStore.loaded[module.id]).length
    );

    /** "4 modules" on the pill; which exports fill them, in its tooltip. */
    const count = $derived(`${loadedCount} module${loadedCount === 1 ? '' : 's'}`);
    const sources = $derived(dataStore.inventory.map((source) => source.label).join(', '));

    async function clearDemo() {
        for (const module of demoModules) await dataStore.clearDemo(module.id);
    }
</script>

<div class="pill">
    {#if dataStore.loading}
        <span class="dot loading"></span>
        <span class="muted">{dataStore.loading.message}</span>
    {:else if demoModules.length > 0}
        <button
            class="chip"
            type="button"
            onclick={clearDemo}
            title="Clear the demo data: {demoModules.map((m) => m.label.toLowerCase()).join(', ')}"
        >
            <span class="dot demo"></span>
            <span class="demo-text">Demo data</span>
            <span class="clear" aria-hidden="true">✕</span>
        </button>
        <button class="btn primary" type="button" onclick={onAdd}>
            Explore <span class="long">my personal data</span>
        </button>
    {:else if loadedCount > 0}
        <span class="dot ok" title="Viewing your own data"></span>
        <span class="ok-text" title={sources || undefined}>{count}</span>
        <button class="btn" type="button" onclick={onAdd}>Add more</button>
    {:else}
        <button class="btn primary" type="button" onclick={onAdd}>
            Import <span class="long">my data</span>
        </button>
    {/if}
</div>

<style>
    .pill {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        border: 1px solid hsl(var(--border));
        border-radius: var(--radius-pill);
        padding: 0.25rem 0.35rem 0.25rem 0.75rem;
        background: hsl(var(--secondary) / 0.4);
        font-size: var(--text-body);
    }

    .dot {
        width: 0.5rem;
        height: 0.5rem;
        border-radius: 50%;
        flex: none;
    }

    .dot.loading {
        background: hsl(var(--primary));
        animation: pulse 1.2s ease-in-out infinite;
    }

    .dot.demo {
        background: hsl(var(--muted-foreground));
    }

    .dot.ok {
        background: hsl(var(--owl));
    }

    .muted {
        color: hsl(var(--muted-foreground));
    }

    .demo-text {
        font-weight: 500;
        white-space: nowrap;
    }

    .chip {
        display: flex;
        align-items: center;
        gap: 0.4rem;
        margin: -0.1rem 0;
        padding: 0.1rem 0.5rem 0.1rem 0.1rem;
        border: none;
        border-radius: var(--radius-pill);
        font: inherit;
        cursor: pointer;
        color: hsl(var(--muted-foreground));
        background: transparent;
        transition:
            color 0.15s,
            background-color 0.15s;
    }

    .chip:hover {
        color: hsl(var(--foreground));
        background: hsl(var(--accent));
    }

    .clear {
        font-size: var(--text-label);
        opacity: 0.7;
    }

    .ok-text {
        max-width: 26rem;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-weight: 500;
        color: hsl(var(--owl));
    }

    .btn {
        flex: none;
        border: none;
        border-radius: var(--radius-pill);
        padding: 0.2rem 0.7rem;
        font: inherit;
        font-size: var(--text-small);
        white-space: nowrap;
        cursor: pointer;
        color: hsl(var(--muted-foreground));
        background: transparent;
        transition:
            color 0.15s,
            background-color 0.15s;
    }

    .btn:hover {
        color: hsl(var(--foreground));
        background: hsl(var(--accent));
    }

    .btn.primary {
        color: hsl(var(--primary-foreground));
        background: hsl(var(--primary));
        font-weight: 600;
    }

    .btn.primary:hover {
        opacity: 0.9;
    }

    @keyframes pulse {
        0%,
        100% {
            opacity: 1;
        }
        50% {
            opacity: 0.4;
        }
    }
</style>
