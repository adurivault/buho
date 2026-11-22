<script lang="ts">
    import { getTopTracksMonthly, type TrackMonthlyPoint } from '#lib/data/queries/trackQueries.ts';
    import { dataStore } from '#lib/stores/dataStore.svelte.ts';
    import { listeningFilterStore } from '#lib/stores/listeningFilterStore.svelte.ts';
    import { listeningMeasure } from '#lib/stores/listeningMeasure.svelte.ts';
    import { formatMeasure } from '#lib/utils/measure.ts';
    import BarChartRace, { type RaceRow } from '#lib/components/visualizations/BarChartRace.svelte';

    let rows = $state<RaceRow[]>([]);
    let isVisible = $state(false);

    const measure = $derived(listeningMeasure.measure);
    const formatValue = $derived((v: number) => formatMeasure(measure, v));
    const truncateLabel = (label: string) =>
        label.length > 46 ? `${label.slice(0, 43)}...` : label;

    $effect(() => {
        void dataStore.isDemo;
        void listeningFilterStore.rangeKey;
        const active = measure;
        if (!isVisible || dataStore.isLoading || !dataStore.loaded.listening) return;

        getTopTracksMonthly(null, active, {
            startDate: listeningFilterStore.startDate,
            endDate: listeningFilterStore.endDate,
        })
            .then((data: TrackMonthlyPoint[]) => {
                rows = data.map((d) => ({
                    month: d.month,
                    name: d.item,
                    value: d.value,
                }));
            })
            .catch((e) => console.error('Failed to load track race data:', e));
    });
</script>

<BarChartRace
    title="Bar Chart Race: tracks"
    {rows}
    {formatValue}
    formatName={truncateLabel}
    ariaLabel="Bar chart race of cumulative listening by track"
    loadingLabel="Loading track race..."
    leftMargin={320}
    minWidth={980}
    onVisible={() => (isVisible = true)}
/>
