<script lang="ts">
    import SunburstExplorer from './SunburstExplorer.svelte';
    import type { ArtistSunburstRow } from '#lib/data/queries/artistQueries.ts';
    import { listeningExplorerFilters } from '#lib/stores/listeningExplorerFilters.svelte.ts';
    import {
        buildSunburstHierarchy,
        type PlayMeasure,
        type SunburstNode,
    } from '#lib/visualizations/sunburstHierarchy.ts';
    import { openSpotify, hasOpenModifier, MODIFIER_LABEL } from '#lib/utils/spotify.ts';

    // Spotify-specific shell around the generic SunburstExplorer: builds the
    // artist→album→track hierarchy and wires Spotify cross-filtering + ⌘-click play.
    interface Props {
        rows: ArtistSunburstRow[];
        width: number;
        height?: number;
        /** What an arc's angle counts. Rebuilds the tree when it changes. */
        measure?: PlayMeasure;
    }
    let { rows, width, height = Infinity, measure = 'minutes' }: Props = $props();

    const data = $derived(buildSunburstHierarchy(rows, measure));

    const KEY_BY_DEPTH = { 1: 'artist_name', 2: 'album_name', 3: 'track_name' };
    const OTHER_LABELS = ['Other artists', 'Other albums', 'Other tracks'];

    const formatValue = $derived((value: number) =>
        measure === 'plays'
            ? `${Math.round(value).toLocaleString()} play${Math.round(value) === 1 ? '' : 's'}`
            : `${Math.round(value).toLocaleString()} min`
    );

    function canOpen(node: SunburstNode): boolean {
        return !!node.trackUri;
    }

    function onLeafOpen(node: SunburstNode, event: MouseEvent): boolean {
        if (hasOpenModifier(event) && node.trackUri) return openSpotify(node.trackUri);
        return false;
    }
</script>

<SunburstExplorer
    {data}
    {width}
    {height}
    filters={listeningExplorerFilters}
    keyByDepth={KEY_BY_DEPTH}
    rootLabel="All artists"
    {formatValue}
    otherLabels={OTHER_LABELS}
    {canOpen}
    {onLeafOpen}
    openHint={`${MODIFIER_LABEL}+click to play on Spotify`}
    testId="artist-sunburst-explorer"
/>
