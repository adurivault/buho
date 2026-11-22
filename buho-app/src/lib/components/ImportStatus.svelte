<script lang="ts" module>
    import type { ImportReport } from '#lib/stores/dataStore.svelte.ts';

    /**
     * Shared by every copy of this component — each layout mounts its own — so
     * a report dismissed on one page stays dismissed on the next, and the time
     * it has already been up carries over instead of starting again.
     */
    let dismissedReport = $state<ImportReport | null>(null);
    let shown: { report: ImportReport; at: number } | null = null;
</script>

<script lang="ts">
    import { resolve } from '$app/paths';
    import { dataStore } from '#lib/stores/dataStore.svelte.ts';
    import { moduleById } from '#lib/data/modules.ts';
    import { sourceLabel } from '#lib/data/sources/catalog.ts';
    import ErrorDialog from './ErrorDialog.svelte';

    /**
     * How long the report stays up on its own. Long enough to read what landed
     * where; after that it is a strip of the page saying something already
     * known, and the sidebar and the pill keep saying it more quietly.
     */
    const AUTO_DISMISS_MS = 6000;
    /** What it is still given once the pointer or the focus leaves it. */
    const LINGER_MS = 2500;

    /**
     * Pointer over it, or focus inside it: someone is reading the report or
     * reaching for one of its links, and it must not vanish from under them.
     */
    let holding = $state(false);

    /**
     * What the last drop turned out to hold.
     *
     * It has to be said out loud now that a drop can fill a module you aren't
     * looking at: importing a Timeline export from the music page is the point
     * of the single drop zone, and without this it would look like nothing
     * happened. The sidebar icon lighting up is far too easy to miss.
     */
    const report = $derived(
        dataStore.lastImport && dataStore.lastImport !== dismissedReport
            ? dataStore.lastImport
            : null
    );

    $effect(() => {
        const current = report;
        if (!current || holding) return;
        if (shown?.report !== current) shown = { report: current, at: Date.now() };
        const left = AUTO_DISMISS_MS - (Date.now() - shown.at);
        const timer = setTimeout(() => (dismissedReport = current), Math.max(LINGER_MS, left));
        return () => clearTimeout(timer);
    });
</script>

{#if dataStore.loading}
    <div class="loading-banner">
        <span class="loading-text">{dataStore.loading.message}</span>
    </div>
    <div
        class="progress-track"
        role="progressbar"
        aria-label={dataStore.loading.message}
        aria-valuenow={Math.round((dataStore.loading.progress ?? 0) * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
    >
        <div
            class="progress-fill"
            class:indeterminate={dataStore.loading.progress == null}
            style:width={dataStore.loading.progress != null
                ? `${dataStore.loading.progress * 100}%`
                : undefined}
        ></div>
    </div>
{/if}

{#if dataStore.geo?.status === 'running'}
    <!-- Background enrichment: the app is already usable, so this row stays
         quieter than the blocking import bar above. -->
    <div class="loading-banner subtle">
        <span class="loading-text">{dataStore.geo.message}</span>
    </div>
    <div
        class="progress-track"
        role="progressbar"
        aria-label={dataStore.geo.message}
        aria-valuenow={Math.round((dataStore.geo.progress ?? 0) * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
    >
        <div
            class="progress-fill subtle"
            style:width={`${(dataStore.geo.progress ?? 0) * 100}%`}
        ></div>
    </div>
{/if}

{#if report}
    <div
        class="result-bar"
        role="status"
        onpointerenter={() => (holding = true)}
        onpointerleave={() => (holding = false)}
        onfocusin={() => (holding = true)}
        onfocusout={() => (holding = false)}
    >
        <span class="result-lead">Imported</span>
        <ul class="result-list">
            {#each report.modules as found (found.module)}
                {@const module = moduleById(found.module)}
                <li data-module={module.id}>
                    <a href={resolve(module.href)}>
                        {module.label} · {found.rows.toLocaleString()}
                    </a>
                    <span class="result-from">
                        from {found.services.map(sourceLabel).join(', ')}
                    </span>
                </li>
            {/each}
        </ul>
        {#if report.unrecognisedFiles > 0}
            <span class="result-skipped">
                {report.unrecognisedFiles.toLocaleString()} file{report.unrecognisedFiles > 1
                    ? 's'
                    : ''} in no format Buho reads — ignored.
            </span>
        {/if}
        <button
            type="button"
            class="result-dismiss"
            aria-label="Dismiss"
            onclick={() => (dismissedReport = dataStore.lastImport)}
        >
            ✕
        </button>
    </div>
{/if}

<ErrorDialog />

<style>
    .loading-banner {
        flex: none;
        display: flex;
        justify-content: center;
        padding: 0.5rem 1rem 0.4rem;
    }

    .loading-text {
        font-size: var(--text-body);
        color: hsl(var(--muted-foreground));
        text-align: center;
        font-variant-numeric: tabular-nums;
    }

    .progress-track {
        flex: none;
        position: relative;
        height: 3px;
        width: 100%;
        overflow: hidden;
        background: hsl(var(--secondary) / 0.6);
    }

    .progress-fill {
        position: relative;
        height: 100%;
        width: 0;
        overflow: hidden;
        border-radius: 0 999px 999px 0;
        background: hsl(var(--primary));
        transition: width 0.4s ease;
    }

    /* Subtle sheen so a paused phase still looks alive. */
    .progress-fill::after {
        content: '';
        position: absolute;
        inset: 0;
        background: linear-gradient(
            90deg,
            transparent,
            hsl(var(--primary-foreground) / 0.35),
            transparent
        );
        transform: translateX(-100%);
        animation: progress-sheen 1.3s ease-in-out infinite;
    }

    .loading-banner.subtle {
        padding: 0.35rem 1rem 0.3rem;
    }

    .loading-banner.subtle .loading-text {
        font-size: var(--text-small);
        opacity: 0.75;
    }

    .progress-fill.subtle {
        background: hsl(var(--primary) / 0.45);
    }

    .progress-fill.subtle::after {
        animation: none;
    }

    .progress-fill.indeterminate {
        width: 35%;
        animation: progress-indeterminate 1.1s ease-in-out infinite;
    }

    @keyframes progress-sheen {
        100% {
            transform: translateX(100%);
        }
    }

    @keyframes progress-indeterminate {
        0% {
            margin-left: -35%;
        }
        100% {
            margin-left: 100%;
        }
    }

    .result-bar {
        flex: none;
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: center;
        gap: 0.5rem 0.75rem;
        padding: 0.5rem 2.5rem;
        position: relative;
        font-size: var(--text-body);
        background: hsl(var(--secondary) / 0.5);
        border-bottom: 1px solid hsl(var(--border));
    }

    .result-lead {
        font-weight: 600;
    }

    .result-list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 0.5rem 0.75rem;
    }

    .result-list li {
        display: flex;
        align-items: baseline;
        gap: 0.35rem;
    }

    .result-list a {
        font-weight: 500;
        color: var(--module-accent);
        text-decoration: none;
        border-bottom: 1px solid currentColor;
        font-variant-numeric: tabular-nums;
    }

    .result-from,
    .result-skipped {
        font-size: var(--text-small);
        color: hsl(var(--muted-foreground));
    }

    .result-dismiss {
        position: absolute;
        top: 50%;
        right: 0.75rem;
        transform: translateY(-50%);
        border: none;
        background: transparent;
        cursor: pointer;
        color: hsl(var(--muted-foreground));
        line-height: 1;
    }

    .result-dismiss:hover {
        color: hsl(var(--foreground));
    }
</style>
