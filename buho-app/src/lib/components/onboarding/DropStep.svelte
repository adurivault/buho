<script lang="ts">
    import { dataStore } from '#lib/stores/dataStore.svelte.ts';
    import { collectDrop } from '#lib/data/import/entries.ts';
    import { trackEvent } from '#lib/analytics.ts';
    import { deviceStore } from '#lib/stores/deviceStore.svelte.ts';
    import SendLinkButton from '#lib/components/handheld/SendLinkButton.svelte';

    /**
     * Step three: hand the file over.
     *
     * A second drop zone next to the window-wide one is not a duplicate: the
     * whole-window zone is a shortcut for people who know it is there, and this
     * is the target for somebody who has been told to expect one. Both end in
     * the same call, and this one stops the event so a drop is never read twice.
     *
     * Nothing here asks which service the file came from, and that is not an
     * omission — the importer sniffs each file's contents and routes it. Saying
     * so on the page is worth the two lines: it is the difference between "did I
     * pick the right thing?" and dropping the folder.
     */
    interface Props {
        /**
         * The export the funnel led here for, when it led here for one. Only
         * the analytics reads it: it is the one place in the app where the user
         * has *said* what they are about to drop, so it is the one place that
         * can tell a how-to that misleads from an export Buho can't read.
         */
        expected?: string;
    }

    let { expected }: Props = $props();

    let dragging = $state(false);
    let fileInput: HTMLInputElement;
    let folderInput: HTMLInputElement;

    async function onDrop(event: DragEvent) {
        event.preventDefault();
        // The window handler would otherwise import the same files a second time.
        event.stopPropagation();
        dragging = false;
        if (!event.dataTransfer) return;

        // Captured synchronously — the item list is emptied on the first await.
        const drop = collectDrop(event.dataTransfer);
        trackEvent('import-file-picked', { pick: 'drop', surface: 'onboarding' });
        await dataStore.handleImport(() => drop.read(), {
            pick: 'drop',
            surface: 'onboarding',
            expected,
        });
    }

    /** Which picker was opened — both inputs land in `onPicked`. */
    let picked: 'file' | 'folder' = 'file';

    async function onPicked(event: Event) {
        const target = event.target as HTMLInputElement;
        const files = target.files;
        target.value = '';
        if (files && files.length > 0) {
            await dataStore.handleFilesUpload(files, {
                pick: picked,
                surface: 'onboarding',
                expected,
            });
        }
    }

    function pickFiles() {
        picked = 'file';
        trackEvent('import-file-picked', { pick: 'file', surface: 'onboarding' });
        fileInput?.click();
    }

    function pickFolder() {
        picked = 'folder';
        trackEvent('import-file-picked', { pick: 'folder', surface: 'onboarding' });
        folderInput?.click();
    }
</script>

<input
    type="file"
    accept=".json,.txt,.zip,.xlsx,.fit"
    multiple
    class="offscreen"
    bind:this={fileInput}
    onchange={onPicked}
/>
<!-- `webkitdirectory` turns the native dialog into a directory-only chooser, so
     folder picking cannot share the control above. -->
<input type="file" webkitdirectory class="offscreen" bind:this={folderInput} onchange={onPicked} />

<div class="wrap">
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
        class="zone"
        class:dragging
        ondragover={(event) => {
            event.preventDefault();
            event.stopPropagation();
            dragging = true;
        }}
        ondragleave={() => (dragging = false)}
        ondrop={onDrop}
    >
        <p class="lead drop-lead">Drop your export here</p>
        <!-- Same zone, named for the gesture that is actually available: there
             is nothing to drag a file from on a phone. -->
        <p class="lead pick-lead">Pick your export</p>
        <p class="hint">
            A <code>.zip</code>, an unzipped folder, or loose
            <code>.json</code>
            /
            <code>.txt</code>
            /
            <code>.xlsx</code> files. You don't have to say what they are.
        </p>
        <div class="buttons">
            <button class="primary" onclick={pickFiles}>Choose files</button>
            <button class="quiet" onclick={pickFolder}>Choose a folder</button>
        </div>
    </div>

    <!-- Steps one and two are done on the phone, because that is where a
         WhatsApp export is made — and so is this one, now that the buttons
         above survive a narrow screen. What wants a wider one is the reading,
         not the import, and that is a recommendation rather than a wall. -->
    <p class="handoff">
        This works on a phone. The file is right there, and Buho reads it here. The charts are drawn
        for a wider screen, though: opening this page on a computer is what gets you the full
        picture.
    </p>
    {#if deviceStore.showcase}
        <div class="handoff-send">
            <SendLinkButton surface="drop-step" />
        </div>
    {/if}

    <ul class="reassurance">
        <li>Every file is read locally, inside your browser. None of it is uploaded.</li>
        <li>
            Buho works out which service each file came from by looking inside it, so a whole export
            folder can go in at once.
        </li>
        <li>
            Nothing is written to disk and nothing is remembered: closing the page clears it, and
            reopening starts over.
        </li>
    </ul>
</div>

<style>
    .wrap {
        max-width: 44rem;
    }

    .offscreen {
        display: none;
    }

    .zone {
        padding: 2.5rem 1.5rem;
        border: 2px dashed hsl(var(--border));
        border-radius: var(--radius-xl);
        text-align: center;
        transition:
            border-color 0.15s,
            background-color 0.15s;
    }

    .pick-lead {
        display: none;
    }

    /* A phone has no drag gesture to offer, so the dashed target stops being a
       target and becomes a plain heading over the buttons — which are the whole
       of the step there. */
    @media (max-width: 767px) {
        .zone {
            padding: 0;
            border: none;
            text-align: left;
        }

        .drop-lead {
            display: none;
        }

        .pick-lead {
            display: block;
        }

        .hint {
            margin-left: 0;
            margin-right: 0;
        }

        .buttons {
            justify-content: flex-start;
        }

        /* `webkitdirectory` picks nothing on iOS Safari, and an export that
           arrives on a phone arrives as one file anyway. */
        .quiet {
            display: none;
        }
    }

    .dragging {
        border-color: hsl(var(--primary));
        background: hsl(var(--primary) / 0.06);
    }

    .lead {
        margin: 0;
        font-size: var(--text-lede);
        font-weight: 600;
    }

    .hint {
        margin: 0.4rem auto 0;
        max-width: 28rem;
        font-size: var(--text-small);
        color: hsl(var(--muted-foreground));
    }

    code {
        font-family: var(--font-mono);
        font-size: var(--text-small);
    }

    .buttons {
        display: flex;
        justify-content: center;
        gap: 0.5rem;
        margin-top: 1.25rem;
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
        border-color: hsl(var(--foreground));
    }

    .handoff {
        margin: 1.25rem 0 0;
        padding: 0.85rem 1rem;
        border: 1px solid hsl(var(--border));
        border-radius: var(--radius-md);
        background: hsl(var(--secondary) / 0.4);
        font-size: var(--text-body);
    }

    .handoff-send {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        margin-top: 0.75rem;
    }

    @media (min-width: 768px) {
        .handoff {
            display: none;
        }
    }

    .reassurance {
        margin: 1.75rem 0 0;
        padding: 0;
        list-style: none;
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        font-size: var(--text-small);
        color: hsl(var(--muted-foreground));
    }

    .reassurance li {
        padding-left: 1rem;
        border-left: 2px solid hsl(var(--border));
    }
</style>
