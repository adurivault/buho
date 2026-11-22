<script lang="ts">
    import Activity from '@lucide/svelte/icons/activity';
    import Calendar from '@lucide/svelte/icons/calendar';
    import Footprints from '@lucide/svelte/icons/footprints';
    import ListMusic from '@lucide/svelte/icons/list-music';
    import Music from '@lucide/svelte/icons/music';
    import Triangle from '@lucide/svelte/icons/triangle';
    import type { IconName } from './icons';

    /**
     * One of the glyphs standing for a source or a dataset, drawn inline so the
     * app never fetches a remote asset. Stroke-based and inheriting
     * `currentColor`, like {@link NetworkIcon} — these identify a thing, they
     * aren't brand reproductions.
     *
     * Shared by the sidebar and the /sources matrix, which have to agree: the
     * matrix explains what lights up in the sidebar, and two drawings of the
     * same thing would quietly drift apart.
     *
     * Lucide covers four of them. Its icons are built on the same 24-unit grid
     * with the same stroke, so they sit beside the hand-drawn ones without
     * looking imported.
     */
    interface Props {
        name: IconName;
        size?: number;
    }

    let { name, size = 20 }: Props = $props();
</script>

{#if name === 'music-note'}
    <!-- The Listening dataset is a note, not a service mark: three services feed
         it, and none of them owns it. -->
    <Music {size} />
{:else if name === 'lastfm'}
    <!-- Last.fm plays nothing — it keeps the log of what everything else played,
         so its mark is the list, not a player. -->
    <ListMusic {size} />
{:else if name === 'footprints'}
    <Footprints {size} />
{:else if name === 'heartbeat'}
    <!-- A trace, not a heart: the dataset is what the watch measured while it
         was worn — pulse, breath, stress — not one organ. -->
    <Activity {size} />
{:else if name === 'calendar'}
    <Calendar {size} />
{:else if name === 'garmin'}
    <!-- Garmin's mark is a triangle; the footprints are the step data, which is
         only one of the two things its export carries. -->
    <Triangle {size} />
{:else}
    <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
        focusable="false"
    >
        {#if name === 'spotify'}
            <circle cx="12" cy="12" r="10" />
            <path d="M8 15c2-1 6-1 8 0" />
            <path d="M7 11.5c3-1.5 7-1.5 10 0" />
            <path d="M6 8c4-2 8-2 12 0" />
        {:else if name === 'deezer'}
            <!-- Deezer's mark is a bar-graph of stacked rules; four rising
                 columns read as that at 18px, where the real six would blur. -->
            <path d="M3 17h4M9 17h4M15 17h4" />
            <path d="M9 13h4M15 13h4" />
            <path d="M15 9h4" />
            <path d="M15 5h4" />
        {:else if name === 'strava'}
            <!-- Strava's mark is two chevrons of the same shape facing opposite
                 ways: a large one pointing up on the left, a smaller one pointing
                 down on the right, overlapping across the middle. Drawn as the
                 centre line of each band — at 18px the real outline, notch and
                 all, closes up into a blob. -->
            <path d="M5.5 14 10.5 4 15.5 14" />
            <path d="M11.8 14 15.4 21 19 14" />
        {:else if name === 'map-pin'}
            <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" />
            <circle cx="12" cy="9" r="2.5" />
        {:else if name === 'message'}
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        {:else}
            <circle cx="12" cy="12" r="3" />
            <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
            <path d="M4.9 4.9l2.9 2.9M16.2 16.2l2.9 2.9" />
            <path d="M19.1 4.9l-2.9 2.9M7.8 16.2l-2.9 2.9" />
        {/if}
    </svg>
{/if}
