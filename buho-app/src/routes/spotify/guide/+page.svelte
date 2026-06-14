<script lang="ts">
    import { onDestroy, onMount, tick } from "svelte";
    import LazySection from "$lib/components/LazySection.svelte";
    import { sections } from "./sections";
    import {
        uiStore,
        setSpotifyGuideScrollTop,
    } from "$lib/stores/uiStore.svelte";

    onMount(async () => {
        await tick();

        // Wait another tick to ensure DOM is fully painted
        await tick();

        const mainContent = document.querySelector(".spotify-content");
        if (
            mainContent instanceof HTMLElement &&
            uiStore.spotifyGuideScrollTop > 0
        ) {
            mainContent.scrollTop = uiStore.spotifyGuideScrollTop;

            // Add scroll listener directly to track position continuously
            // instead of just on destroy, to handle navigation via sidebar
            mainContent.addEventListener("scroll", handleScroll, {
                passive: true,
            });
        } else if (mainContent instanceof HTMLElement) {
            mainContent.addEventListener("scroll", handleScroll, {
                passive: true,
            });
        }
    });

    onDestroy(() => {
        const mainContent = document.querySelector(".spotify-content");
        if (mainContent instanceof HTMLElement) {
            mainContent.removeEventListener("scroll", handleScroll);
            setSpotifyGuideScrollTop(mainContent.scrollTop);
        }
    });

    function handleScroll(e: Event) {
        const target = e.target as HTMLElement;
        setSpotifyGuideScrollTop(target.scrollTop);
    }
</script>

<div class="guide-container w-full max-w-none px-6 pt-10 pb-6">
    <header class="mb-12 text-center">
        <h1 class="h1 mb-4">Your Audio Journey</h1>
        <p class="text-lg text-surface-600 dark:text-surface-300">
            Scroll to explore your listening history
        </p>
        <div class="mt-8 animate-bounce text-primary-500">↓</div>
    </header>

    <main class="space-y-12" data-testid="guide-sections">
        {#each sections as section (section.id)}
            <div id={section.id} data-testid="section-{section.id}">
                <LazySection
                    component={section.component}
                    props={section.props}
                />
            </div>
        {/each}
    </main>
</div>
