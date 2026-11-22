<script lang="ts">
    import { resolve } from '$app/paths';
    import Icon from '#lib/components/Icon.svelte';
    import NetworkIcon from '#lib/components/NetworkIcon.svelte';
    import DropZone from '#lib/components/DropZone.svelte';
    import Welcome from '#lib/components/Welcome.svelte';
    import { sourcesFilling } from '#lib/data/sources/catalog.ts';
    import type { DataModule } from '#lib/data/modules.ts';
    import { MODULE_SHOTS } from '#lib/shots.ts';

    /**
     * What a module shows before it holds anything: its welcome.
     *
     * It says what the module holds and the questions it answers, takes the
     * file where the visitor is looking, and names the exports that would fill
     * it. The heading names the
     * data rather than the absence of it: "No health loaded" described the
     * table, and every empty module read the same.
     *
     * The drop zone is the action. A button that opened a dialog hid the fact
     * that a file can simply be dropped, though the whole window already takes
     * one. The sample, where there is one, sits under it, one click away.
     *
     * It stays a short screen on purpose. Spelling the export procedure out
     * here was tried and was worse: arriving at a page of instructions, before
     * you know what the module even is, is more to read than anyone has a
     * reason to. Each export's chip links to its how-to instead.
     *
     * Beside it, the module's explorer as the demo draws it, so the page also
     * shows what the export becomes. The layout is {@link Welcome}'s, shared
     * with the calendar.
     */
    interface Props {
        module: DataModule;
    }

    let { module }: Props = $props();

    let building = $state(false);

    /** The exports that fill this module, soonest first. */
    const sources = $derived(sourcesFilling(module.id));

    /**
     * The one export to go and ask for, when there is only one.
     *
     * With a single source the zone can name it and the line under it can say
     * how long it takes. With several there is a choice to make, and the chips
     * make it better than a sentence listing three services.
     */
    const only = $derived(sources.length === 1 ? sources[0] : null);

    const dropTitle = $derived(
        only ? `Drop your ${only.label} export here` : 'Drop your export here'
    );
    const pickTitle = $derived(only ? `Pick your ${only.label} export` : 'Pick your export');
    const hint = $derived(
        only
            ? 'The .zip as it arrives, or the unzipped folder.'
            : 'A .zip, a folder or loose files. Buho works out which export it is.'
    );

    /**
     * The generator is behind a dynamic import, so the invented data and its
     * vocabulary never reach anyone who came with an export of their own.
     */
    async function loadSample() {
        building = true;
        try {
            const { loadDemo } = await import('#lib/demo/load.ts');
            await loadDemo(module.id);
        } finally {
            building = false;
        }
    }
</script>

<Welcome
    subject={module.heading.subject}
    rest={module.heading.rest}
    summary={module.blurb}
    questions={module.questions}
    preview={MODULE_SHOTS[module.id]}
    previewName="{module.label} explorer"
    demo={module.hasDemo ? { onLoad: loadSample, building } : undefined}
>
    {#snippet zone()}
        <DropZone surface="module" expected={only?.id} title={dropTitle} {pickTitle} {hint} />
    {/snippet}

    {#snippet feeds()}
        {#if only}
            <p>
                Request the export from
                <a href={resolve('/sources/[source]', { source: only.id })}>{only.label}</a>. It
                takes {only.delay.toLowerCase()}.
            </p>
        {:else}
            <p>Request the export from:</p>
            <ul>
                {#each sources as source (source.id)}
                    <li>
                        <a href={resolve('/sources/[source]', { source: source.id })}>
                            {#if source.network}
                                <NetworkIcon network={source.network} size={14} />
                            {:else}
                                <Icon name={source.icon} size={14} />
                            {/if}
                            <span>{source.label}</span>
                            <span class="wait">{source.delay.toLowerCase()}</span>
                        </a>
                    </li>
                {/each}
            </ul>
        {/if}
    {/snippet}
</Welcome>

<style>
    p {
        margin: 0;
    }

    p a {
        color: hsl(var(--foreground));
        font-weight: 600;
        text-decoration: underline;
        text-underline-offset: 3px;
    }

    p a:hover {
        text-decoration-thickness: 2px;
    }

    ul {
        display: flex;
        flex-wrap: wrap;
        gap: 0.4rem;
        margin: 0.5rem 0 0;
        padding: 0;
        list-style: none;
    }

    li a {
        display: inline-flex;
        align-items: center;
        gap: 0.4rem;
        padding: 0.3rem 0.7rem;
        border: 1px solid hsl(var(--border));
        border-radius: var(--radius-pill);
        background: hsl(var(--card));
        font-size: var(--text-small);
        color: hsl(var(--foreground));
        text-decoration: none;
        transition: border-color 0.15s;
    }

    li a:hover {
        border-color: hsl(var(--foreground) / 0.45);
    }

    .wait {
        color: hsl(var(--muted-foreground));
        font-size: var(--text-label);
    }
</style>
