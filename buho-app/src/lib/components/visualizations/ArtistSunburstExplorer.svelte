<script lang="ts">
    import SunburstExplorer from "./SunburstExplorer.svelte";
    import type { ArtistSunburstRow } from "$lib/data/queries/artistQueries";
    import { spotifyExplorerFilters } from "$lib/stores/spotifyExplorerFilters.svelte";
    import {
        buildSunburstHierarchy,
        type SunburstNode,
    } from "$lib/visualizations/sunburstHierarchy";
    import { openSpotify, hasOpenModifier, MODIFIER_LABEL } from "$lib/utils/spotify";

    // Spotify-specific shell around the generic SunburstExplorer: builds the
    // artist→album→track hierarchy and wires Spotify cross-filtering + ⌘-click play.
    interface Props {
        rows: ArtistSunburstRow[];
        width: number;
        height?: number;
    }
    let { rows, width, height = Infinity }: Props = $props();

    const data = $derived(buildSunburstHierarchy(rows));

    const KEY_BY_DEPTH = { 1: "artist_name", 2: "album_name", 3: "track_name" };
    const OTHER_LABELS = ["Other artists", "Other albums", "Other tracks"];

    function formatMinutes(minutes: number): string {
        return `${Math.round(minutes).toLocaleString()} min`;
    }

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
    filters={spotifyExplorerFilters}
    keyByDepth={KEY_BY_DEPTH}
    rootLabel="All artists"
    formatValue={formatMinutes}
    otherLabels={OTHER_LABELS}
    {canOpen}
    {onLeafOpen}
    openHint={`${MODIFIER_LABEL}+click to play on Spotify`}
    testId="artist-sunburst-explorer"
/>
