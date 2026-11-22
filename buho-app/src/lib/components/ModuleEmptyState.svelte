<script lang="ts">
    import { resolve } from '$app/paths';
    import Lock from '@lucide/svelte/icons/lock';
    import CirclePlay from '@lucide/svelte/icons/circle-play';
    import Icon from '#lib/components/Icon.svelte';
    import NetworkIcon from '#lib/components/NetworkIcon.svelte';
    import DropZone from '#lib/components/DropZone.svelte';
    import { sourcesFilling } from '#lib/data/sources/catalog.ts';
    import type { DataModule } from '#lib/data/modules.ts';

    /**
     * What a module shows before it holds anything: its welcome.
     *
     * It says what the module holds, takes the file where the visitor is
     * looking, and names the exports that would fill it. The heading names the
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
     */
    interface Props {
        module: DataModule;
    }

    let { module }: Props = $props();

    let building = $state(false);

    /** The exports that fill this module, soonest first. */
    const feeds = $derived(sourcesFilling(module.id));

    /**
     * The one export to go and ask for, when there is only one.
     *
     * With a single source the zone can name it and the line under it can say
     * how long it takes. With several there is a choice to make, and the chips
     * make it better than a sentence listing three services.
     */
    const only = $derived(feeds.length === 1 ? feeds[0] : null);

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

<div class="welcome">
    <div class="column">
        <h2>
            Your <span class="subject">{module.heading.subject}</span>
            {module.heading.rest ?? ''}
        </h2>
        <p class="summary">{module.blurb}</p>

        <div class="zone">
            <DropZone surface="module" expected={only?.id} title={dropTitle} {pickTitle} {hint} />
        </div>

        <!-- The promise, where the file goes. -->
        <p class="safe">
            <span class="lock" aria-hidden="true"><Lock size={14} strokeWidth={2} /></span>
            Read in this tab. Nothing is uploaded, nothing is kept.
        </p>

        <div class="feeds">
            {#if only}
                <p>
                    No file yet? Ask
                    <a href={resolve('/sources/[source]', { source: only.id })}>{only.label}</a>
                    for it. It takes {only.delay.toLowerCase()}.
                </p>
            {:else}
                <p>No file yet? It comes from one of these:</p>
                <ul>
                    {#each feeds as source (source.id)}
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
        </div>

        {#if module.hasDemo}
            <p class="demo-row">
                <button class="demo" type="button" onclick={loadSample} disabled={building}>
                    <span class="play" aria-hidden="true">
                        <CirclePlay size={18} strokeWidth={1.75} />
                    </span>
                    {building ? 'Building the sample…' : 'Load demo data'}
                </button>
                <span class="aside">An invented history, cleared in one click.</span>
            </p>
        {/if}
    </div>
</div>

<style>
    /* The column sits in the middle of whatever height the page leaves it, and
       is short enough to fit a 720px-tall window without a scrollbar. */
    .welcome {
        display: flex;
        flex: 1;
        align-items: center;
        justify-content: center;
        min-height: 0;
        padding: 2rem 1.5rem;
    }

    .column {
        display: flex;
        flex-direction: column;
        width: 100%;
        max-width: 34rem;
    }

    h2 {
        margin: 0;
        font-family: var(--font-display);
        font-size: var(--text-title);
        font-weight: 650;
        line-height: 1.15;
        letter-spacing: -0.02em;
        color: hsl(var(--heading));
        text-wrap: balance;
    }

    .subject {
        color: var(--module-accent);
    }

    .summary {
        margin: 0.5rem 0 0;
        font-size: var(--text-lede);
        line-height: 1.55;
        color: hsl(var(--muted-foreground));
    }

    .zone {
        margin-top: 1.75rem;
    }

    .safe {
        display: flex;
        align-items: center;
        gap: 0.45rem;
        margin: 0.75rem 0 0;
        font-size: var(--text-small);
        color: hsl(var(--muted-foreground));
    }

    .lock {
        display: flex;
        color: hsl(var(--owl));
    }

    .feeds {
        margin-top: 1.5rem;
        font-size: var(--text-body);
        line-height: 1.6;
        color: hsl(var(--muted-foreground));
    }

    .feeds p {
        margin: 0;
    }

    .feeds p a {
        color: hsl(var(--foreground));
        font-weight: 600;
        text-decoration: underline;
        text-underline-offset: 3px;
    }

    .feeds p a:hover {
        text-decoration-thickness: 2px;
    }

    .feeds ul {
        display: flex;
        flex-wrap: wrap;
        gap: 0.4rem;
        margin: 0.5rem 0 0;
        padding: 0;
        list-style: none;
    }

    .feeds li a {
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

    .feeds li a:hover {
        border-color: hsl(var(--foreground) / 0.45);
    }

    .wait {
        color: hsl(var(--muted-foreground));
        font-size: var(--text-label);
    }

    .demo-row {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 0.5rem 0.75rem;
        margin: 1.5rem 0 0;
    }

    .demo {
        display: inline-flex;
        align-items: center;
        gap: 0.55rem;
        padding: 0.5rem 1rem 0.5rem 0.65rem;
        border: 1px solid hsl(var(--border));
        border-radius: var(--radius-pill);
        background: hsl(var(--card));
        font-size: var(--text-body);
        font-weight: 550;
        color: hsl(var(--foreground));
        cursor: pointer;
        transition: border-color 0.15s;
    }

    .demo:hover:not(:disabled) {
        border-color: hsl(var(--foreground) / 0.45);
    }

    .demo:disabled {
        opacity: 0.6;
        cursor: default;
    }

    .play {
        display: flex;
        color: var(--module-accent);
    }

    .aside {
        font-size: var(--text-small);
        color: hsl(var(--muted-foreground));
    }
</style>
