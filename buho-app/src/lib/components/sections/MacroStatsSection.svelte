<script lang="ts">
    import {
        getMacroStats,
        type MacroStats,
    } from "$lib/data/queries/behaviorQueries";
    import type { DateRange } from "$lib/data/queries/common";

    import { dataStore } from "$lib/stores/dataStore.svelte";
    import { spotifyFilterStore } from "$lib/stores/spotifyFilterStore.svelte";

    // State
    let stats = $state<MacroStats>({
        totalMinutes: 0,
        uniqueArtists: 0,
        uniqueTracks: 0,
        skipRate: 0,
    });

    function currentDateRange(): DateRange {
        return {
            startDate: spotifyFilterStore.startDate,
            endDate: spotifyFilterStore.endDate,
        };
    }

    // Effect to fetch data
    $effect(() => {
        const _range = spotifyFilterStore.rangeKey;

        // Run fetch when:
        // 1. Loading is complete (isLoading === false)
        // 2. AND we have a valid source (demo or user file loaded)
        if (!dataStore.isLoading && dataStore.source) {
            fetchStats();
        }
    });

    async function fetchStats() {
        try {
            stats = await getMacroStats(undefined, currentDateRange());
        } catch (e) {
            console.error("Failed to load macro stats", e);
        }
    }
</script>

<section class="macro-stats-section" aria-label="Macro Statistics">
    <div class="stat-item">
        <div class="stat-value">{stats.totalMinutes.toLocaleString()}</div>
        <div class="stat-label">Total Minutes</div>
    </div>

    <div class="stat-item">
        <div class="stat-value">{stats.uniqueArtists.toLocaleString()}</div>
        <div class="stat-label">Unique Artists</div>
    </div>

    <div class="stat-item">
        <div class="stat-value">{stats.uniqueTracks.toLocaleString()}</div>
        <div class="stat-label">Unique Tracks</div>
    </div>

    <div class="stat-item">
        <div class="stat-value">{stats.skipRate}%</div>
        <div class="stat-label">Skip Rate</div>
    </div>
</section>

<style>
    .macro-stats-section {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: var(--spacing-6, 1.5rem);
        padding: var(--spacing-8, 2rem) 0;
    }

    @media (min-width: 768px) {
        .macro-stats-section {
            grid-template-columns: repeat(4, 1fr);
        }
    }

    .stat-item {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
    }

    .stat-value {
        font-family: var(--font-mono, monospace);
        font-size: var(--font-size-hero, 3rem); /* Fallback 3rem */
        font-weight: 700;
        line-height: 1.1;
        color: var(--text-heading, #111);
        font-variant-numeric: tabular-nums;
    }

    .stat-label {
        font-family: var(--font-sans, sans-serif);
        font-size: var(--font-size-sm, 0.875rem);
        color: var(--text-description, #666);
        text-transform: uppercase;
        letter-spacing: 0.05em;
        margin-top: var(--spacing-2, 0.5rem);
    }

    :global(.dark) .stat-value {
        color: var(--text-heading-dark, #eee);
    }

    :global(.dark) .stat-label {
        color: var(--text-description-dark, #aaa);
    }
</style>
