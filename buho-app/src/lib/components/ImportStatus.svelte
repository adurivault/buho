<script lang="ts">
    import { dataStore } from "$lib/stores/dataStore.svelte";
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

{#if dataStore.error}
    <div class="error-bar" role="alert">
        <span>{dataStore.error.message}</span>
        {#if dataStore.error.link}
            <a href={dataStore.error.link} class="error-link"
                >Get help with export</a
            >
        {/if}
    </div>
{/if}

<style>
    .loading-banner {
        flex: none;
        display: flex;
        justify-content: center;
        padding: 0.5rem 1rem 0.4rem;
    }

    .loading-text {
        font-size: 0.85rem;
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
        content: "";
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

    .error-bar {
        flex: none;
        display: flex;
        justify-content: center;
        gap: 0.5rem;
        padding: 0.5rem 1rem;
        font-size: 0.85rem;
        color: hsl(var(--destructive-foreground, 0 0% 100%));
        background: hsl(var(--destructive) / 0.15);
        border-bottom: 1px solid hsl(var(--destructive) / 0.4);
    }

    .error-link {
        color: inherit;
        text-decoration: underline;
        white-space: nowrap;
    }
</style>
