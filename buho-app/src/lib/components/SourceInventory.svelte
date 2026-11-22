<script lang="ts">
    import { dataStore } from '#lib/stores/dataStore.svelte.ts';
    import { moduleById } from '#lib/data/modules.ts';
    import Icon from '#lib/components/Icon.svelte';
    import NetworkIcon from '#lib/components/NetworkIcon.svelte';

    /**
     * What is loaded, export by export, with a way to take any of it back out.
     *
     * The counterpart to imports always accumulating: drop the wrong archive and
     * this is where it goes. Removal is scoped to that export's own rows, so
     * removing Deezer leaves Spotify's plays where they are even though the two
     * share a table.
     */

    /** The source one click away from being removed. Only ever one at a time. */
    let confirming = $state<string | null>(null);

    /** "Positions · 128 610 — Steps · 9 169 852" */
    function holdingsLabel(
        holdings: { module: Parameters<typeof moduleById>[0]; rows: number }[]
    ): string {
        return holdings
            .map((h) => `${moduleById(h.module).label} · ${h.rows.toLocaleString()}`)
            .join(' — ');
    }

    async function remove(id: string) {
        confirming = null;
        await dataStore.removeSource(id);
    }
</script>

{#if dataStore.inventory.length > 0}
    <section class="inventory">
        <h3 class="heading">What's loaded</h3>
        <ul>
            {#each dataStore.inventory as source (source.id)}
                <li>
                    <span class="glyph">
                        {#if source.network}
                            <NetworkIcon network={source.network} size={18} />
                        {:else}
                            <Icon name={source.icon} size={18} />
                        {/if}
                    </span>
                    <span class="named">
                        <span class="label">{source.label}</span>
                        <span class="holdings">{holdingsLabel(source.holdings)}</span>
                    </span>

                    {#if confirming === source.id}
                        <!-- Two steps because nothing here is persisted: getting
                             it back means finding the file on disk again. -->
                        <span class="confirm">
                            <button
                                type="button"
                                class="danger"
                                onclick={() => remove(source.id)}
                                disabled={!!dataStore.loading}
                            >
                                Remove
                            </button>
                            <button type="button" class="quiet" onclick={() => (confirming = null)}>
                                Cancel
                            </button>
                        </span>
                    {:else}
                        <button
                            type="button"
                            class="quiet"
                            onclick={() => (confirming = source.id)}
                            disabled={!!dataStore.loading}
                            aria-label="Remove {source.label}"
                        >
                            Remove
                        </button>
                    {/if}
                </li>
            {/each}
        </ul>
    </section>
{/if}

<style>
    .inventory {
        margin-top: 1rem;
        border: 1px solid hsl(var(--border));
        border-radius: var(--radius-lg);
        background: hsl(var(--secondary) / 0.3);
        padding: 0.75rem;
    }

    .heading {
        font-size: var(--text-small);
        font-weight: 600;
        color: hsl(var(--muted-foreground));
        text-transform: uppercase;
        letter-spacing: 0.04em;
    }

    ul {
        list-style: none;
        margin: 0.5rem 0 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 0.125rem;
    }

    li {
        display: flex;
        align-items: center;
        gap: 0.6rem;
        padding: 0.35rem 0.25rem;
        font-size: var(--text-body);
    }

    li + li {
        border-top: 1px solid hsl(var(--border) / 0.6);
    }

    .glyph {
        flex: none;
        display: flex;
        color: hsl(var(--muted-foreground));
    }

    .named {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-wrap: wrap;
        align-items: baseline;
        gap: 0.5rem;
    }

    .label {
        font-weight: 500;
    }

    .holdings {
        font-size: var(--text-small);
        color: hsl(var(--muted-foreground));
        font-variant-numeric: tabular-nums;
    }

    .confirm {
        display: flex;
        align-items: center;
        gap: 0.25rem;
        flex: none;
    }

    button {
        flex: none;
        border: none;
        border-radius: var(--radius-pill);
        padding: 0.2rem 0.7rem;
        font-size: var(--text-small);
        cursor: pointer;
        background: transparent;
        transition:
            color 0.15s,
            background-color 0.15s;
    }

    button:disabled {
        opacity: 0.5;
        cursor: default;
    }

    .quiet {
        color: hsl(var(--muted-foreground));
    }

    .quiet:hover:not(:disabled) {
        color: hsl(var(--foreground));
        background: hsl(var(--accent));
    }

    .danger {
        font-weight: 600;
        color: hsl(var(--destructive-foreground, 0 0% 100%));
        background: hsl(var(--destructive));
    }

    .danger:hover:not(:disabled) {
        opacity: 0.9;
    }
</style>
