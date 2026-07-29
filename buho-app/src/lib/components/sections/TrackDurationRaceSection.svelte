<script lang="ts">
    import {
        getTopTracksMonthlyDuration,
        type TrackMonthlyDurationData,
    } from "$lib/data/queries/trackQueries";
    import { dataStore } from "$lib/stores/dataStore.svelte";
    import { spotifyFilterStore } from "$lib/stores/spotifyFilterStore.svelte";
    import BarChartRace, {
        type RaceRow,
    } from "$lib/components/visualizations/BarChartRace.svelte";

    let rows = $state<RaceRow[]>([]);
    let isVisible = $state(false);

    const formatHours = (hours: number) => `${hours.toFixed(1)}h`;
    const truncateLabel = (label: string) =>
        label.length > 46 ? `${label.slice(0, 43)}...` : label;

    $effect(() => {
        void dataStore.isDemo;
        void spotifyFilterStore.rangeKey;
        if (!isVisible || dataStore.isLoading || !dataStore.source) return;

        getTopTracksMonthlyDuration(null, {
            startDate: spotifyFilterStore.startDate,
            endDate: spotifyFilterStore.endDate,
        })
            .then((data: TrackMonthlyDurationData[]) => {
                rows = data.map((d) => ({
                    month: d.month,
                    name: d.item,
                    value: d.hours,
                }));
            })
            .catch((e) =>
                console.error("Failed to load track duration race data:", e),
            );
    });
</script>

<BarChartRace
    title="Bar Chart Race: listening time by track"
    {rows}
    formatValue={formatHours}
    formatName={truncateLabel}
    ariaLabel="Bar chart race of cumulative listening time by track"
    loadingLabel="Loading track duration race..."
    leftMargin={320}
    minWidth={980}
    onVisible={() => (isVisible = true)}
/>
