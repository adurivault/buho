<script lang="ts">
    import { dataStore, type ImportSurface } from '#lib/stores/dataStore.svelte.ts';
    import { collectDrop } from '#lib/data/import/entries.ts';
    import { warmUpDuckDB } from '#lib/data/db/index.ts';
    import { trackEvent } from '#lib/analytics.ts';

    /**
     * A drop target that says it is one.
     *
     * The window takes a drop on any route ({@link DropOverlay}), which is a
     * shortcut for people who know it is there and invisible to everybody else.
     * A page whose last instruction is "drop it here" needs a here — a dashed
     * rectangle, where the sentence points.
     *
     * The drop is stopped here rather than left to bubble: the window handler
     * would otherwise read the same files a second time.
     */
    interface Props {
        /** Where this zone lives, for the import analytics. */
        surface: ImportSurface;
        /**
         * The export this page is about, when the page is about one. Only the
         * analytics reads it — nothing about the import changes, since every
         * file is routed by what is inside it.
         */
        expected?: string;
        /** Leading line inside the zone. */
        title?: string;
    }

    let { surface, expected, title = 'Drop your export here' }: Props = $props();

    let dragging = $state(false);
    let fileInput: HTMLInputElement;
    let folderInput: HTMLInputElement;
    /** Which picker was opened — both inputs land in `onPicked`. */
    let picked: 'file' | 'folder' = 'file';

    async function onDrop(event: DragEvent) {
        event.preventDefault();
        event.stopPropagation();
        dragging = false;
        if (!event.dataTransfer) return;

        // Captured synchronously — the item list is emptied on the first await.
        const drop = collectDrop(event.dataTransfer);
        trackEvent('import-file-picked', { pick: 'drop', surface });
        await dataStore.handleImport(() => drop.read(), {
            pick: 'drop',
            surface,
            expected,
        });
    }

    async function onPicked(event: Event) {
        const target = event.target as HTMLInputElement;
        const files = target.files;
        target.value = '';
        if (files && files.length > 0) {
            await dataStore.handleFilesUpload(files, { pick: picked, surface, expected });
        }
    }

    function pickFiles() {
        picked = 'file';
        trackEvent('import-file-picked', { pick: 'file', surface });
        fileInput?.click();
    }

    function pickFolder() {
        picked = 'folder';
        trackEvent('import-file-picked', { pick: 'folder', surface });
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

<!-- Reaching for the zone is the sign a file is coming: the engine starts on
     the hover or the tab, so it downloads while the file dialog is open. -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
    class="zone"
    class:dragging
    onpointerenter={warmUpDuckDB}
    onfocusin={warmUpDuckDB}
    ondragover={(event) => {
        event.preventDefault();
        event.stopPropagation();
        dragging = true;
    }}
    ondragleave={() => (dragging = false)}
    ondrop={onDrop}
>
    <p class="lead">{title}</p>
    <p class="hint">
        The <code>.zip</code> as it arrived, the unzipped folder, or loose files. Buho works out which
        export it is, so you never have to say — and reads it here, in this tab, without uploading any
        of it.
    </p>
    <div class="buttons">
        <button class="primary" type="button" onclick={pickFiles}>Choose files</button>
        <button class="quiet" type="button" onclick={pickFolder}>Choose a folder</button>
    </div>
</div>

<style>
    .offscreen {
        display: none;
    }

    .zone {
        padding: 1.75rem 1.25rem;
        border: 2px dashed hsl(var(--border));
        border-radius: var(--radius-xl);
        text-align: center;
        transition:
            border-color 0.15s,
            background-color 0.15s;
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
        max-width: 30rem;
        font-size: var(--text-small);
        line-height: 1.5;
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
        margin-top: 1.1rem;
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
</style>
