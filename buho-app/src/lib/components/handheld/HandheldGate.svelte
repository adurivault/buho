<script lang="ts">
    import type { Snippet } from 'svelte';
    import { page } from '$app/state';
    import { resolve } from '$app/paths';
    import type { DataModule } from '#lib/data/modules.ts';
    import { deviceStore } from '#lib/stores/deviceStore.svelte.ts';
    import ExplorerPoster from './ExplorerPoster.svelte';

    /**
     * Wraps a module's pages and, on a phone, puts the Explorer's poster where
     * the Explorer would be. Every other page of the module (the guide, the
     * extras) goes through untouched.
     *
     * The Explorer is not mounted at all behind the poster, so a phone that only
     * looks at the poster never runs its queries.
     */
    interface Props {
        module: DataModule;
        children: Snippet;
    }

    let { module, children }: Props = $props();

    const exploring = $derived(page.url.pathname.startsWith(resolve(module.href)));
</script>

{#if deviceStore.showcase && exploring}
    <ExplorerPoster {module} />
{:else}
    {@render children()}
{/if}
