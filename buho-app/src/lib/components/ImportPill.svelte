<script lang="ts">
    import { dataStore } from '#lib/stores/dataStore.svelte.ts';
    import type { DataModule } from '#lib/data/modules.ts';
    import ImportDialog from '#lib/components/ImportDialog.svelte';
    import { trackEvent } from '#lib/analytics.ts';

    /**
     * The header's data status, and the way into the import dialog.
     *
     * One component for all five headers. What it says is read off the
     * inventory rather than a per-module summary query: since any drop can fill
     * any module, "what's in here" is the same question everywhere — which
     * exports contributed, and how much.
     */
    interface Props {
        module: DataModule;
    }

    let { module }: Props = $props();

    let dialogOpen = $state(false);

    const loaded = $derived(dataStore.loaded[module.id]);
    /**
     * Asked per module, not globally: with samples for both music and messages,
     * "are we on demo data?" has two different answers on two different pages.
     */
    const onDemo = $derived(dataStore.isSample(module.id));

    /** "Google Timeline · 128 610 — Garmin Connect · 412 907" */
    const summary = $derived(
        dataStore.inventory
            .flatMap((source) =>
                source.holdings
                    .filter((holding) => holding.module === module.id)
                    .map((holding) => `${source.label} · ${holding.rows.toLocaleString()}`)
            )
            .join(' — ')
    );

    function openDialog() {
        trackEvent('import-open', { module: module.id });
        dialogOpen = true;
    }

    async function loadSample() {
        const { loadDemo } = await import('#lib/demo/load.ts');
        await loadDemo(module.id);
    }
</script>

<ImportDialog bind:open={dialogOpen} onClose={() => (dialogOpen = false)} focus={module.id} />

<div class="pill">
    {#if dataStore.loading}
        <span class="dot loading"></span>
        <span class="muted">{dataStore.loading.message}</span>
    {:else if onDemo}
        <!-- The badge is the way out. Until it was a button the only exit from
             the sample was importing something over it, which is no help to
             somebody who just wants the page to stop showing invented data. -->
        <button
            class="chip"
            type="button"
            onclick={() => dataStore.clearDemo(module.id)}
            title="Clear the demo data and leave {module.label.toLowerCase()} empty"
        >
            <span class="dot demo"></span>
            <span class="demo-text">Demo data</span>
            <span class="clear" aria-hidden="true">✕</span>
        </button>
        <button class="btn primary" type="button" onclick={openDialog}>
            Explore <span class="long">my personal data</span>
        </button>
    {:else if loaded}
        <span class="dot ok" title="Viewing your own data"></span>
        <span class="ok-text" title={summary}>{summary || 'Your data'}</span>
        <button class="btn" type="button" onclick={openDialog}>Add more</button>
    {:else}
        <button class="btn primary" type="button" onclick={openDialog}>
            Import <span class="long">my {module.label.toLowerCase()}</span>
        </button>
        {#if module.hasDemo}
            <!-- Offered, never assumed. The sample used to load itself, which
                 meant nobody was ever told they were looking at it. -->
            <button class="btn" type="button" onclick={loadSample}> Load demo data </button>
        {/if}
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
        border-radius: var(--radius-pill);
        cursor: pointer;
        color: hsl(var(--muted-foreground));
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

    /* A phone's header has room for the switcher and a control, not for a
       sentence: what is left here is the state dot, the demo warning — the one
       thing nobody should have to widen a window to see — and the buttons. */
    @media (max-width: 767px) {
        .pill {
            gap: 0.35rem;
            padding: 0.25rem 0.3rem 0.25rem 0.5rem;
        }

        /* Which exports are loaded, and the running import's message: both are
           said again below the header, by ImportStatus. */
        .ok-text,
        .muted {
            display: none;
        }

        .long {
            display: none;
        }

        .btn {
            padding: 0.2rem 0.55rem;
        }
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
