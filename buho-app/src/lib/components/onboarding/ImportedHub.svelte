<script lang="ts">
    import { resolve } from '$app/paths';
    import Icon from '#lib/components/Icon.svelte';
    import { dataStore } from '#lib/stores/dataStore.svelte.ts';
    import { DATA_MODULES, type ModuleId } from '#lib/data/modules.ts';

    /**
     * What the landing page becomes once something has been imported.
     *
     * The funnel has done its job at that point and standing between someone and
     * their own data would be the whole problem it was built to fix. So it is
     * replaced, not collapsed: here is what landed, here is the way in.
     *
     * Counts come from the inventory rather than from the last import, because
     * imports accumulate — after a second drop, the last report describes only
     * that drop, and the question this page answers is what is in there now.
     * Rows, never minutes: a Last.fm history carries no durations at all, so a
     * listening time would read as zero for anyone who arrived that way.
     */
    interface Props {
        onAddMore: () => void;
    }

    let { onAddMore }: Props = $props();

    const filled = $derived.by(() => {
        const rows = new Map<ModuleId, number>();
        for (const source of dataStore.inventory) {
            for (const holding of source.holdings) {
                rows.set(holding.module, (rows.get(holding.module) ?? 0) + holding.rows);
            }
        }
        return DATA_MODULES.filter((module) => (rows.get(module.id) ?? 0) > 0).map((module) => ({
            module,
            rows: rows.get(module.id) ?? 0,
        }));
    });

    const sourceCount = $derived(dataStore.inventory.length);
</script>

<h1>Your data is in.</h1>
<p class="subtitle">
    {sourceCount}
    {sourceCount === 1 ? 'export' : 'exports'} loaded, in your browser only. Pick where to start.
</p>

<ul class="modules">
    {#each filled as entry (entry.module.id)}
        <li data-module={entry.module.id}>
            <a href={resolve(entry.module.href)}>
                <span class="glyph">
                    <Icon name={entry.module.icon} size={22} />
                </span>
                <span class="text">
                    <span class="name">{entry.module.label}</span>
                    <span class="blurb">{entry.module.blurb}</span>
                </span>
                <span class="count">{entry.rows.toLocaleString()}</span>
            </a>
        </li>
    {/each}
</ul>

<p class="more">
    <!-- Called with no arguments on purpose: the handler takes none, and
         forwarding the click event would smuggle it into an optional parameter. -->
    <button onclick={() => onAddMore()}>Add another export →</button>
</p>

<style>
    h1 {
        margin: 0;
        font-size: clamp(1.6rem, 4vw, 2.25rem);
    }

    .subtitle {
        margin: 0.75rem 0 0;
        color: hsl(var(--muted-foreground));
    }

    .modules {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(19rem, 1fr));
        gap: 0.6rem;
        margin: 2rem 0 0;
        padding: 0;
        list-style: none;
    }

    .modules a {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        padding: 0.9rem 1rem;
        border: 1px solid hsl(var(--border));
        border-radius: var(--radius-md);
        background: hsl(var(--card));
        transition:
            border-color 0.15s,
            background-color 0.15s;
    }

    .modules a:hover {
        border-color: var(--module-accent);
        background: color-mix(in srgb, var(--module-accent) 6%, hsl(var(--card)));
    }

    .glyph {
        display: flex;
        flex: none;
        align-items: center;
        justify-content: center;
        width: 2.25rem;
        height: 2.25rem;
        border-radius: var(--radius-pill);
        color: var(--module-accent);
        background: color-mix(in srgb, var(--module-accent) 12%, transparent);
    }

    .text {
        display: flex;
        min-width: 0;
        flex-direction: column;
        gap: 0.1rem;
    }

    .name {
        font-weight: 600;
    }

    .blurb {
        font-size: var(--text-small);
        color: hsl(var(--muted-foreground));
    }

    .count {
        margin-left: auto;
        flex: none;
        padding-left: 0.5rem;
        font-family: var(--font-mono);
        font-size: var(--text-small);
        color: hsl(var(--muted-foreground));
    }

    .more {
        margin: 2rem 0 0;
    }

    .more button {
        font-size: var(--text-body);
        color: hsl(var(--muted-foreground));
        text-decoration: underline;
        text-underline-offset: 4px;
        cursor: pointer;
        transition: color 0.15s;
    }

    .more button:hover {
        color: hsl(var(--foreground));
    }
</style>
