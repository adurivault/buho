<script lang="ts">
    import { moduleById } from '#lib/data/modules.ts';
    import Icon from '#lib/components/Icon.svelte';
    import ImportStatus from '#lib/components/ImportStatus.svelte';
    import ImportPill from '#lib/components/ImportPill.svelte';
    import HandheldGate from '#lib/components/handheld/HandheldGate.svelte';

    /* Named after the data, not the service that recorded it — the same
	   name the /sources matrix uses for this column. */
    const module = moduleById('steps');
    const title = module.label;

    let { children } = $props();
</script>

<div class="steps-shell" data-module={module.id}>
    <header class="steps-header">
        <div class="header-left">
            <span class="source-title">
                <Icon name={module.icon} size={18} />{title}
            </span>
        </div>

        <div class="header-right">
            <ImportPill {module} />
        </div>
    </header>

    <ImportStatus />

    <div class="steps-content">
        <HandheldGate {module}>{@render children()}</HandheldGate>
    </div>
</div>

<style>
    .steps-shell {
        display: flex;
        flex-direction: column;
        height: 100%;
    }

    .steps-content {
        flex: 1;
        min-height: 0;
        overflow-y: auto;
    }

    .steps-header {
        flex: none;
        z-index: 30;
        display: grid;
        grid-template-columns: 1fr auto;
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

    .header-right {
        justify-self: end;
    }

    /* The title stays on a phone here: these modules have no view switcher, so
	   dropping it left a bar with nothing in it but the import control. */
    @media (max-width: 767px) {
        .steps-header {
            padding-inline: 0.6rem;
        }
    }
</style>
