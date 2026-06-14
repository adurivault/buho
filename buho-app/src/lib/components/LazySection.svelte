<script lang="ts">
    import { onMount } from "svelte";
    import type { Component } from "svelte";

    let {
        component: SectionComponent,
        props = {},
        minHeight = "32rem",
        rootMargin = "600px 0px",
    }: {
        component: Component<any>;
        props?: Record<string, any>;
        minHeight?: string;
        rootMargin?: string;
    } = $props();

    let host: HTMLElement;
    let visible = $state(false);

    onMount(() => {
        if (typeof IntersectionObserver === "undefined") {
            visible = true;
            return;
        }

        const observer = new IntersectionObserver(
            (entries) => {
                if (entries.some((entry) => entry.isIntersecting)) {
                    visible = true;
                    observer.disconnect();
                }
            },
            { rootMargin },
        );
        observer.observe(host);

        return () => observer.disconnect();
    });
</script>

<!-- The placeholder keeps an approximate height so the scrollbar and the
     guide's scroll-position restoration stay stable before sections mount. -->
<div bind:this={host} style={visible ? "" : `min-height: ${minHeight}`}>
    {#if visible}
        <SectionComponent {...props} />
    {/if}
</div>
