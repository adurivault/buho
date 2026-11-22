import type { Component } from 'svelte';

export interface Section {
    id: string;
    // A registry of unrelated components: each one's props are checked where it
    // is written, not through this list.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    component: Component<any>;
    props?: Record<string, unknown>;
}

import TrackDurationRaceSection from '#lib/components/sections/TrackDurationRaceSection.svelte';
import ArtistMetricsScatterSection from '#lib/components/sections/ArtistMetricsScatterSection.svelte';
import TrackMetricsScatterSection from '#lib/components/sections/TrackMetricsScatterSection.svelte';
import DailyMetricsScatterSection from '#lib/components/sections/DailyMetricsScatterSection.svelte';

/**
 * Charts that don't serve the guide's narrative but are worth keeping: the track
 * race (a second race straight after the artist one adds nothing to the story)
 * and the free-axis scatters, which are exploratory by nature.
 */
export const sections: Section[] = [
    { id: 'track-duration-race', component: TrackDurationRaceSection },
    { id: 'artist-metrics-scatter', component: ArtistMetricsScatterSection },
    { id: 'track-metrics-scatter', component: TrackMetricsScatterSection },
    { id: 'daily-metrics-scatter', component: DailyMetricsScatterSection },
];
