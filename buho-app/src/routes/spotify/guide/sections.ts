import type { Component } from 'svelte';

export interface Section {
    id: string;
    component: Component<any>;
    props?: Record<string, any>;
}

import MacroStatsSection from '$lib/components/sections/MacroStatsSection.svelte';
import ArtistDurationRaceSection from '$lib/components/sections/ArtistDurationRaceSection.svelte';
import TrackDurationRaceSection from '$lib/components/sections/TrackDurationRaceSection.svelte';
import ArtistRidgelineSection from '$lib/components/sections/ArtistRidgelineSection.svelte';
import GuideToExploreHandoffSection from '$lib/components/sections/GuideToExploreHandoffSection.svelte';

export const sections: Section[] = [
    {
        id: 'macro-stats',
        component: MacroStatsSection
    },
    {
        id: 'artist-duration-race',
        component: ArtistDurationRaceSection
    },
    {
        id: 'track-duration-race',
        component: TrackDurationRaceSection
    },
    {
        id: 'artist-ridgeline',
        component: ArtistRidgelineSection
    },
    {
        id: 'guide-to-explore-handoff',
        component: GuideToExploreHandoffSection
    }
];
