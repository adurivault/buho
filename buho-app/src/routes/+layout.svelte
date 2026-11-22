<script lang="ts">
    import { onMount } from 'svelte';
    import '../app.css';
    import AppSidebar from '#lib/components/AppSidebar.svelte';
    import DropOverlay from '#lib/components/DropOverlay.svelte';
    import { initErrorTracking } from '#lib/analytics.ts';
    import { initTheme } from '#lib/stores/themeStore.svelte.ts';

    let { children } = $props();

    // DuckDB boots on demand (`initDuckDB` in #lib/data/db), never with the page.
    onMount(() => {
        initTheme();
        initErrorTracking();
    });
</script>

<!-- Mounted once, at the root: the drop zone is the window, on every route. -->
<DropOverlay />

<div class="app-container">
    <AppSidebar />
    <main class="main-content">
        {@render children()}
    </main>
</div>

<style>
    .app-container {
        display: flex;
        /* Dynamic viewport units: on a phone `100vh` is the height with the
		   browser's URL bar retracted, so a full-height page is taller than the
		   screen until you scroll. */
        height: 100vh;
        height: 100dvh;
    }

    .main-content {
        flex-grow: 1;
        position: relative; /* For overlay */
        overflow-y: auto;
    }

    /* The rail leaves the flex row and becomes a fixed bottom bar at this width
	   (see AppSidebar), so it no longer takes space of its own: the scroller has
	   to reserve it, or the last 56px of every page sit underneath it. */
    @media (max-width: 767px) {
        .main-content {
            padding-bottom: calc(var(--nav-rail-size) + env(safe-area-inset-bottom, 0px));
        }
    }
</style>
