<script lang="ts">
    import { resolve } from '$app/paths';
    import Icon from '#lib/components/Icon.svelte';
    import NetworkIcon from '#lib/components/NetworkIcon.svelte';
    import ImportDialog from '#lib/components/ImportDialog.svelte';
    import { trackEvent } from '#lib/analytics.ts';
    import { sourcesFilling } from '#lib/data/sources/catalog.ts';
    import type { DataModule } from '#lib/data/modules.ts';

    /**
     * What a module shows before it holds anything.
     *
     * There were five different answers to this, and one of them was no answer
     * at all: /listening/explore had no empty branch, so with nothing imported the
     * page sat on "Rendering universe…" forever — a spinner over a database that
     * was never going to fill, which reads as a hang rather than as an
     * invitation. The other four each said one flat sentence, pointed vaguely at
     * "the upload control in the header", and none of them mentioned the sample
     * that already existed.
     *
     * So: one component, and it is a page rather than a label. The sample, where
     * there is one, is the big obvious control — it is the only thing on this
     * screen that pays off immediately, and somebody evaluating Buho should not
     * have to spend two days waiting on an export to find out whether it is
     * worth the trouble.
     *
     * It stays a near-empty screen on purpose. An empty module is *supposed* to
     * read as waiting for something; what it owed the visitor was one sentence
     * saying what. Spelling the whole export procedure out here instead was
     * tried and was worse — arriving at a page of instructions, before you know
     * what the module even is, is more to read than anyone has a reason to.
     */
    interface Props {
        module: DataModule;
    }

    let { module }: Props = $props();

    let dialogOpen = $state(false);
    let building = $state(false);

    const name = $derived(module.label.toLowerCase());
    /**
     * The exports that fill this module, soonest first.
     *
     * "Import my positions" is only actionable if you already know a Timeline
     * export is the thing that produces them — which is exactly what somebody
     * looking at an empty module does not know. Naming them, each linked to its
     * own how-to, turns a dead end into the next step.
     */
    const feeds = $derived(sourcesFilling(module.id));

    /**
     * The one export to go and ask for, when there is only one.
     *
     * With a single source the module can say what it is waiting for in a
     * sentence, and name it. With several there is a choice to make, and the
     * chips below make it better than a sentence listing three services.
     */
    const only = $derived(feeds.length === 1 ? feeds[0] : null);

    function openDialog() {
        trackEvent('import-open', { module: module.id });
        dialogOpen = true;
    }

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

<ImportDialog bind:open={dialogOpen} onClose={() => (dialogOpen = false)} focus={module.id} />

<div class="empty">
    <span class="glyph"><Icon name={module.icon} size={30} /></span>

    <h2>No {name} loaded</h2>
    <p class="blurb">{module.blurb}</p>

    <div class="feeds">
        <!--
            What this module is waiting for, in a sentence.

            The chips underneath have always named the exports, but a row of
            pills under the word "Filled by" is a legend, not an instruction:
            it says where these numbers would come from, and leaves the visitor
            to work out that the next move is to go and ask for one, that the
            file comes back hours later, and that they are meant to return with
            it. Where a single export fills the module there is no choice to
            explain, so the sentence names it and the wait, and the chip row
            would only say the same thing twice.
        -->
        {#if only}
            <p class="feeds-lede">
                Request your data from
                <a href={resolve('/sources/[source]', { source: only.id })}>
                    {only.label}
                </a>
                — it takes {only.delay.toLowerCase()} — then come back with the file to see it here.
            </p>
        {:else}
            <p class="feeds-lede">
                Request your data from one of these, then come back with the file to see it here.
            </p>

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

    <div class="actions">
        {#if module.hasDemo}
            <button class="big" onclick={loadSample} disabled={building}>
                {building ? 'Building the sample…' : 'Load demo data'}
            </button>
            <button class="ghost" onclick={openDialog}> Import my own export </button>
        {:else}
            <button class="big" onclick={openDialog}>
                Import my {name}
            </button>
        {/if}
    </div>
</div>

<style>
    .empty {
        display: flex;
        flex: 1;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        min-height: 0;
        padding: 2rem 1.5rem;
        text-align: center;
    }

    .glyph {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 4rem;
        height: 4rem;
        border: 1px solid hsl(var(--border));
        border-radius: var(--radius-pill);
        color: hsl(var(--muted-foreground));
    }

    h2 {
        margin: 1.25rem 0 0;
        font-size: var(--text-heading);
        font-weight: 600;
    }

    .blurb {
        max-width: 32rem;
        margin: 0.5rem 0 0;
        font-size: var(--text-body);
        line-height: 1.6;
        color: hsl(var(--muted-foreground));
    }

    .actions {
        display: flex;
        flex-wrap: wrap;
        justify-content: center;
        align-items: center;
        gap: 0.75rem;
        margin-top: 1.75rem;
    }

    /* Deliberately oversized. This is the one control on the screen that pays
       off in a second, and it used to be a 0.8rem word in a pill in a corner. */
    .big {
        padding: 0.8rem 2.25rem;
        border-radius: var(--radius-pill);
        background: hsl(var(--primary));
        color: hsl(var(--background));
        font-size: var(--text-lede);
        font-weight: 600;
        cursor: pointer;
        transition: opacity 0.15s;
    }

    .big:hover:not(:disabled) {
        opacity: 0.9;
    }

    .big:disabled {
        opacity: 0.6;
        cursor: default;
    }

    .ghost {
        padding: 0.8rem 1.5rem;
        border: 1px solid hsl(var(--border));
        border-radius: var(--radius-pill);
        font-size: var(--text-lede);
        cursor: pointer;
        transition: border-color 0.15s;
    }

    .ghost:hover {
        border-color: hsl(var(--foreground) / 0.45);
    }

    /* Above the buttons, not under them: the chips say which export the two
       controls below are asking for, and a legend read after the control it
       explains is a legend nobody reads. */
    .feeds {
        margin-top: 1.5rem;
        max-width: 34rem;
        width: 100%;
    }

    /* A sentence, not the uppercase micro-label this used to be. "Filled by"
       set in 0.72rem small caps is a column header — it labels the chips
       without telling anyone to do anything, which is what the screen was
       missing. */
    .feeds-lede {
        max-width: 30rem;
        margin: 0 auto 0.85rem;
        font-size: var(--text-body);
        line-height: 1.6;
        color: hsl(var(--muted-foreground));
    }

    .feeds-lede a {
        color: hsl(var(--foreground));
        font-weight: 600;
        text-decoration: underline;
        text-underline-offset: 3px;
    }

    .feeds-lede a:hover {
        text-decoration-thickness: 2px;
    }

    .feeds ul {
        display: flex;
        flex-wrap: wrap;
        justify-content: center;
        gap: 0.4rem;
        margin: 0;
        padding: 0;
        list-style: none;
    }

    .feeds a {
        display: inline-flex;
        align-items: center;
        gap: 0.4rem;
        padding: 0.3rem 0.7rem;
        border: 1px solid hsl(var(--border));
        border-radius: var(--radius-pill);
        font-size: var(--text-small);
        color: hsl(var(--foreground));
        text-decoration: none;
        transition: border-color 0.15s;
    }

    .feeds a:hover {
        border-color: hsl(var(--foreground) / 0.45);
    }

    .wait {
        color: hsl(var(--muted-foreground));
        font-size: var(--text-label);
    }
</style>
