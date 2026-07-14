<script lang="ts">
    import {
        getTopArtistsMonthlyDuration,
        type ArtistMonthlyDurationData,
    } from "$lib/data/queries/artistQueries";
    import { dataStore } from "$lib/stores/dataStore.svelte";
    import { spotifyFilterStore } from "$lib/stores/spotifyFilterStore.svelte";
    import BarChartRace, {
        type RaceRow,
    } from "$lib/components/visualizations/BarChartRace.svelte";

    let rows = $state<RaceRow[]>([]);
    let isVisible = $state(false);

    const formatHours = (hours: number) => `${hours.toFixed(1)}h`;

    $effect(() => {
        void dataStore.isDemo;
        void spotifyFilterStore.rangeKey;
        if (!isVisible || dataStore.isLoading || !dataStore.source) return;

        getTopArtistsMonthlyDuration(null, {
            startDate: spotifyFilterStore.startDate,
            endDate: spotifyFilterStore.endDate,
        })
            .then((data: ArtistMonthlyDurationData[]) => {
                rows = data.map((d) => ({
                    month: d.month,
                    name: d.artist,
                    value: d.hours,
                }));
            })
            .catch((e) =>
                console.error("Failed to load artist duration race data:", e),
            );
    });
</script>

<BarChartRace
    title="Bar Chart Race: listening time by artist"
    {rows}
    formatValue={formatHours}
    ariaLabel="Bar chart race of cumulative listening time by artist"
    loadingLabel="Loading artist duration race..."
    onVisible={() => (isVisible = true)}
/>
