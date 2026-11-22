<script lang="ts">
    import { resolve } from '$app/paths';
    import { page } from '$app/state';
    import SourceHowTo from '#lib/components/SourceHowTo.svelte';
    import BigScreenNote from '#lib/components/handheld/BigScreenNote.svelte';
    import type { CatalogSource } from '#lib/data/sources/catalog.ts';
    import { queryForStep } from '#lib/onboarding/funnel.ts';
    import { deviceStore } from '#lib/stores/deviceStore.svelte.ts';

    /**
     * Step two: go and get the file.
     *
     * The instructions are {@link SourceHowTo}, the same component the import
     * dialog and the per-source page render, so there is one copy of every
     * how-to in the app and no chance of two of them drifting. What this adds is
     * the way onward — and a way out, to the full reference under /sources, for
     * anyone who wants to know what is in the archive before asking for it.
     */
    interface Props {
        source: CatalogSource;
        onNext: () => void;
        onBack: () => void;
    }

    let { source, onNext, onBack }: Props = $props();

    /**
     * On a phone, the address to send yourself: the drop step for this export,
     * so the computer opens exactly where the file goes in.
     */
    const dropUrl = $derived(
        new URL(`${resolve('/')}${queryForStep({ kind: 'drop', source })}`, page.url.origin).href
    );
</script>

<!-- Uncoloured, like every other screen whose subject is an export. This wore
     the accent of the module the export feeds, which made step two green for
     Spotify and Deezer and red for Instagram — the colour of a dataset the
     visitor has not met yet, mistakable for the service's own. -->
<div class="wrap">
    <p class="meta">
        <span>{source.format}</span>
        <span aria-hidden="true">·</span>
        <span>{source.size}</span>
        <span aria-hidden="true">·</span>
        <span>{source.delay}</span>
    </p>

    <SourceHowTo {source} />

    {#if deviceStore.showcase}
        <div class="handoff">
            <BigScreenNote title="Then, on a computer" surface="export-step" url={dropUrl}>
                {#if source.madeOnPhone}
                    Once the file has reached you, open Buho on a computer and drop it in. This link
                    opens on that step.
                {:else}
                    When {source.label} sends it, open the email on a computer and drop the file into
                    Buho. This link opens on that step.
                {/if}
            </BigScreenNote>
        </div>
    {/if}

    <div class="onward">
        <button class="primary" onclick={onNext}>I have the file →</button>
        <button class="quiet" onclick={onBack}>Pick something else</button>
    </div>

    <p class="reference">
        <a href={resolve('/sources/[source]', { source: source.id })}>
            Everything about the {source.label} export: what lands on disk, and which of it Buho opens
            →
        </a>
    </p>
</div>

<style>
    .wrap {
        max-width: 44rem;
    }

    .meta {
        display: flex;
        flex-wrap: wrap;
        gap: 0.4rem;
        margin: 0 0 1.25rem;
        font-size: var(--text-small);
        color: hsl(var(--muted-foreground));
    }

    .handoff {
        margin-top: 2rem;
    }

    .onward {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 0.75rem;
        margin-top: 2rem;
        padding-top: 1.5rem;
        border-top: 1px solid hsl(var(--border));
    }

    .primary {
        padding: 0.5rem 1.1rem;
        border-radius: var(--radius-pill);
        background: hsl(var(--primary));
        color: hsl(var(--background));
        font-size: var(--text-body);
        font-weight: 600;
        cursor: pointer;
        transition: opacity 0.15s;
    }

    .primary:hover {
        opacity: 0.9;
    }

    .quiet {
        padding: 0.5rem 1.1rem;
        border: 1px solid hsl(var(--border));
        border-radius: var(--radius-pill);
        font-size: var(--text-body);
        cursor: pointer;
        transition: border-color 0.15s;
    }

    .quiet:hover {
        border-color: hsl(var(--foreground) / 0.45);
    }

    .reference {
        margin: 1.5rem 0 0;
        font-size: var(--text-small);
    }

    .reference a {
        color: hsl(var(--muted-foreground));
        text-decoration: underline;
        text-underline-offset: 4px;
        transition: color 0.15s;
    }

    .reference a:hover {
        color: hsl(var(--foreground));
    }
</style>
