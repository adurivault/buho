<script lang="ts">
    import FileText from '@lucide/svelte/icons/file-text';
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
     * One zone serves every page that asks for a file: onboarding, a source's
     * how-to, an empty module. Inside a module it takes the module's colours
     * through the `--module-*` scope, and stays neutral elsewhere.
     *
     * The glyph is a file, not an arrow out of a tray: that arrow reads as
     * "send it somewhere", which is the one thing Buho never does with it.
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
        /** The same line on a phone, where there is nothing to drag a file from. */
        pickTitle?: string;
        /** What can be dropped, under the leading line. */
        hint?: string;
        /**
         * One line of a page rather than its main action: a smaller glyph, and
         * the pickers beside the text instead of under it.
         */
        compact?: boolean;
    }

    let {
        surface,
        expected,
        title = 'Drop your export here',
        pickTitle = 'Pick your export',
        hint = 'The .zip as it arrived, the unzipped folder, or loose files. Buho works out which export it is, so you never have to say — and reads it locally, in your browser, without uploading any of it.',
        compact = false,
    }: Props = $props();

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

    /**
     * The whole zone opens the file picker, so the pickers inside can be a line
     * of text rather than two more buttons. A click on one of them is that
     * picker's own business.
     */
    function onZoneClick(event: MouseEvent) {
        if ((event.target as Element).closest('button')) return;
        pickFiles();
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
<!-- The click is a mouse shortcut: the buttons inside are the keyboard's way in. -->
<!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
<div
    class="zone"
    class:dragging
    class:compact
    onclick={onZoneClick}
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
    <span class="glyph" aria-hidden="true"><FileText size={24} strokeWidth={1.75} /></span>
    <div class="text">
        <p class="lead drop-lead">{title}</p>
        <p class="lead pick-lead">{pickTitle}</p>
        <p class="hint">{hint}</p>
        <p class="pickers">
            <button class="pick" type="button" onclick={pickFiles}>Choose files</button>
            <span class="folder">
                or
                <button
                    class="pick"
                    type="button"
                    aria-label="Choose a folder"
                    onclick={pickFolder}
                >
                    a folder
                </button>
            </span>
        </p>
    </div>
</div>

<style>
    .offscreen {
        display: none;
    }

    /* The edge is the module's fill, the mark colour that holds 3:1 for a
       control's outline on either theme; outside a module it falls back to the
       strong neutral edge. */
    .zone {
        display: flex;
        align-items: flex-start;
        gap: 1.1rem;
        padding: 1.35rem 1.4rem 1.25rem;
        border: 2px dashed var(--module-fill);
        border-radius: var(--radius-xl);
        background: color-mix(in srgb, var(--module-soft) 55%, transparent);
        cursor: pointer;
        transition:
            border-color 0.15s,
            background-color 0.15s;
    }

    .zone:hover {
        border-color: var(--module-peak);
    }

    .dragging {
        border-color: var(--module-peak);
        background: var(--module-soft);
    }

    .glyph {
        flex: none;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 3.25rem;
        height: 3.25rem;
        border: 1px solid hsl(var(--border));
        border-radius: var(--radius-lg);
        background: hsl(var(--card));
        color: var(--module-accent);
    }

    .text {
        min-width: 0;
    }

    .lead {
        margin: 0;
        font-size: var(--text-lede);
        font-weight: 600;
        color: hsl(var(--heading));
    }

    .pick-lead {
        display: none;
    }

    .hint {
        margin: 0.2rem 0 0;
        max-width: 30rem;
        font-size: var(--text-small);
        line-height: 1.5;
        color: hsl(var(--muted-foreground));
    }

    .pickers {
        margin: 0.7rem 0 0;
        font-size: var(--text-body);
        color: hsl(var(--muted-foreground));
    }

    /* Links in all but name: the zone around them is the target. The
       underline takes the module's colour, the text stays ink. */
    .pick {
        font-weight: 600;
        color: hsl(var(--foreground));
        text-decoration: underline;
        text-decoration-color: var(--module-fill);
        text-decoration-thickness: 2px;
        text-underline-offset: 4px;
        cursor: pointer;
        transition: text-decoration-color 0.15s;
    }

    .pick:hover {
        text-decoration-color: var(--module-peak);
    }

    .compact {
        align-items: center;
        gap: 0.9rem;
        padding: 0.8rem 1.1rem;
        border-radius: var(--radius-lg);
    }

    .compact .glyph {
        width: 2.5rem;
        height: 2.5rem;
        border-radius: var(--radius-md);
    }

    .compact .text {
        display: grid;
        flex: 1;
        grid-template-columns: minmax(0, 1fr) auto;
        align-items: center;
        column-gap: 1rem;
    }

    .compact .lead {
        grid-column: 1;
        grid-row: 1;
        font-size: var(--text-body);
    }

    .compact .hint {
        grid-column: 1;
        grid-row: 2;
        margin: 0;
    }

    .compact .pickers {
        grid-column: 2;
        grid-row: 1 / span 2;
        margin: 0;
    }

    /* A phone has no drag gesture to offer, so the dashed target stops being a
       target and becomes a plain heading over the picker, which is the whole
       of it there. */
    @media (max-width: 767px) {
        .zone {
            padding: 0;
            border: none;
            background: none;
        }

        .glyph,
        .drop-lead {
            display: none;
        }

        .pick-lead {
            display: block;
        }

        /* `webkitdirectory` picks nothing on iOS Safari, and an export that
           arrives on a phone arrives as one file anyway. */
        .folder {
            display: none;
        }

        /* With no zone around it, the one picker left is the control. */
        .pickers > .pick {
            display: inline-block;
            padding: 0.55rem 1.2rem;
            border-radius: var(--radius-pill);
            background: hsl(var(--primary));
            color: hsl(var(--background));
            text-decoration: none;
        }
    }
</style>
