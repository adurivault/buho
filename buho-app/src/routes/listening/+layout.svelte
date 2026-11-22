<script lang="ts">
    import { moduleById } from '#lib/data/modules.ts';
    import Icon from '#lib/components/Icon.svelte';
    import { resolve } from '$app/paths';
    import SourceNav from '#lib/components/SourceNav.svelte';
    import ImportStatus from '#lib/components/ImportStatus.svelte';
    import ImportPill from '#lib/components/ImportPill.svelte';
    import HandheldGate from '#lib/components/handheld/HandheldGate.svelte';
    import { dataStore } from '#lib/stores/dataStore.svelte.ts';

    /* Named after the data, not the service that recorded it — the same
	   name the /sources matrix uses for this column. */
    const module = moduleById('listening');
    const title = module.label;

    let { children } = $props();

    const tabs = [
        { label: 'Explore', href: resolve('listening/explore') },
        { label: 'Guide', href: resolve('listening/guide') },
        { label: 'Others', href: resolve('listening/others') },
    ];

    /*
     * Nothing is loaded here.
     *
     * This layout used to generate a decade of invented listening on mount, so
     * that arriving at /listening/explore with nothing imported showed a full app
     * running on somebody else's habits. It made the page look alive and made
     * everything on it a lie — the visitor had no way of knowing, and for a
     * study participant that is data contamination, not a nice default.
     *
     * The sample is still one click away, from the module's welcome. See
     * `lib/demo/load.ts`.
     */
</script>

<div class="listening-shell" data-module={module.id}>
    <header class="listening-header" class:bare={!dataStore.loaded[module.id]}>
        <div class="header-left">
            <span class="source-title">
                <Icon name={module.icon} size={18} />{title}
            </span>
        </div>
        <!-- The views only differ once there is something to view: until then
             each of them shows the same welcome. -->
        <div class="header-center">
            {#if dataStore.loaded[module.id]}
                <SourceNav {tabs} ariaLabel="{title} views" />
            {/if}
        </div>
        <div class="header-right">
            <ImportPill {module} />
        </div>
    </header>

    <ImportStatus />

    <div class="listening-content">
        <HandheldGate {module}>{@render children()}</HandheldGate>
    </div>
</div>

<style>
    /* Full-screen column: header fixed at the top, content takes the rest.
	   Explore fits it exactly (no scroll); the Guide scrolls within it (overflow). */
    .listening-shell {
        display: flex;
        flex-direction: column;
        height: 100%;
    }

    .listening-content {
        flex: 1;
        min-height: 0;
        overflow-y: auto;
    }

    .listening-header {
        flex: none;
        z-index: 30;
        display: grid;
        grid-template-columns: 1fr auto 1fr;
        align-items: center;
        gap: 1rem;
        min-height: 52px;
        padding: 0.375rem 1rem;
        border-bottom: 1px solid hsl(var(--border));
        background: hsl(var(--background) / 0.85);
        backdrop-filter: blur(8px);
    }

    .header-left {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        min-width: 0;
    }

    /* The dataset's name in the heading face, after its glyph in the module's
       colour. */
    .source-title {
        flex: 0 0 auto;
        display: inline-flex;
        align-items: center;
        gap: 0.5rem;
        font-family: var(--font-display);
        font-size: var(--text-subheading);
        font-weight: 600;
        letter-spacing: -0.01em;
        color: hsl(var(--heading));
    }

    .source-title :global(svg) {
        color: var(--module-accent);
    }

    .header-center {
        justify-self: center;
    }

    .header-right {
        justify-self: end;
    }

    /* Two items on a phone, so two columns: the switcher takes what is left
	   over and the import control keeps its natural width. Declaring one column
	   fewer than there are children is what used to push the import control
	   onto a second row of its own. */
    @media (max-width: 767px) {
        .listening-header {
            grid-template-columns: minmax(0, 1fr) auto;
            gap: 0.5rem;
            padding-inline: 0.6rem;
        }
        /* Holds nothing but the title, which the switcher already names; an
           empty module has no switcher, so it keeps the title instead. */
        .listening-header:not(.bare) .header-left {
            display: none;
        }
        .bare .header-center {
            display: none;
        }
        .header-center {
            justify-self: start;
            min-width: 0;
        }
    }
</style>
