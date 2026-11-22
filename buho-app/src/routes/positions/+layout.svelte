<script lang="ts">
    import { moduleById } from '#lib/data/modules.ts';
    import Icon from '#lib/components/Icon.svelte';
    import { resolve } from '$app/paths';
    import SourceNav from '#lib/components/SourceNav.svelte';
    import ImportStatus from '#lib/components/ImportStatus.svelte';
    import ImportPill from '#lib/components/ImportPill.svelte';
    import HandheldGate from '#lib/components/handheld/HandheldGate.svelte';

    /* Named after the data, not the service that recorded it — the same
	   name the /sources matrix uses for this column. */
    const module = moduleById('positions');
    const title = module.label;

    let { children } = $props();

    const tabs = [
        { label: 'Explore', href: resolve('positions/explore') },
        { label: 'Other', href: resolve('positions/guide') },
    ];
</script>

<div class="positions-shell" data-module={module.id}>
    <header class="positions-header">
        <div class="header-left">
            <span class="source-title">
                <Icon name={module.icon} size={18} />{title}
            </span>
        </div>

        <div class="header-center">
            <SourceNav {tabs} ariaLabel="Google Maps views" />
        </div>

        <div class="header-right">
            <ImportPill {module} />
        </div>
    </header>

    <ImportStatus />

    <div class="positions-content">
        <HandheldGate {module}>{@render children()}</HandheldGate>
    </div>
</div>

<style>
    .positions-shell {
        display: flex;
        flex-direction: column;
        height: 100%;
    }

    .positions-content {
        flex: 1;
        min-height: 0;
        overflow-y: auto;
    }

    .positions-header {
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
        .positions-header {
            grid-template-columns: minmax(0, 1fr) auto;
            gap: 0.5rem;
            padding-inline: 0.6rem;
        }
        /* Holds nothing but the title, which the switcher below already names. */
        .header-left {
            display: none;
        }
        .header-center {
            justify-self: start;
            min-width: 0;
        }
    }
</style>
