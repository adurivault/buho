<script lang="ts">
    import { dataStore } from '#lib/stores/dataStore.svelte.ts';
    import { openModal, closeModal } from '#lib/stores/uiStore.svelte.ts';
    import { collectDrop } from '#lib/data/import/entries.ts';
    import { warmUpDuckDB } from '#lib/data/db/index.ts';
    import { CATALOG_SOURCES } from '#lib/data/sources/catalog.ts';
    import type { ModuleId } from '#lib/data/modules.ts';
    import { resolve } from '$app/paths';
    import Icon from '#lib/components/Icon.svelte';
    import NetworkIcon from '#lib/components/NetworkIcon.svelte';
    import SourceHowTo from '#lib/components/SourceHowTo.svelte';
    import SourceInventory from '#lib/components/SourceInventory.svelte';
    import { trackEvent } from '#lib/analytics.ts';

    /**
     * The one import dialog.
     *
     * There used to be five, one per module, each with its own drop zone and its
     * own how-to. They were the same dialog: routing has always been per file,
     * so which page you opened it from never changed what it could read. What is
     * left here is the part that genuinely differs — how to *get* each export —
     * plus the pickers, for people who'd rather not drag.
     *
     * Files are normally dropped anywhere in the window ({@link DropOverlay}).
     * While this is open the overlay stands down and the zone below takes the
     * drop instead, so the dialog is never a dead rectangle sitting over the
     * page someone just aimed a file at.
     */
    interface Props {
        open: boolean;
        onClose: () => void;
        /** The module whose page opened this, so its guide is the one preselected. */
        focus?: ModuleId;
    }

    let { open = $bindable(), onClose, focus }: Props = $props();

    let fileInput: HTMLInputElement;
    let folderInput: HTMLInputElement;

    let dragging = $state(false);
    /** The how-to is closed until asked for; it never hides the pickers. */
    let helpOpen = $state(false);
    let helpFor = $state<string>(CATALOG_SOURCES[0].id);

    const guide = $derived(
        CATALOG_SOURCES.find((source) => source.id === helpFor) ?? CATALOG_SOURCES[0]
    );

    /** The export you'd most likely be after, given where you opened this from. */
    function firstSourceFor(module: ModuleId | undefined): string {
        if (!module) return CATALOG_SOURCES[0].id;
        return (
            CATALOG_SOURCES.find((source) => source.fills.includes(module))?.id ??
            CATALOG_SOURCES[0].id
        );
    }

    function close() {
        open = false;
        onClose();
    }

    function handleKeydown(event: KeyboardEvent) {
        if (event.key === 'Escape') close();
    }

    /**
     * Which picker is open, so the import that follows can say how the files
     * were handed over. Both inputs share this handler, and the choice is only
     * known at the moment the button was pressed.
     */
    let picked: 'file' | 'folder' = 'file';

    async function handleFileChange(event: Event) {
        const target = event.target as HTMLInputElement;
        const files = target.files;
        target.value = '';
        if (files && files.length > 0) {
            await dataStore.handleFilesUpload(files, {
                pick: picked,
                surface: 'dialog',
            });
        }
    }

    async function handleDrop(event: DragEvent) {
        event.preventDefault();
        // Stops the window handler seeing it too: it would import the same
        // files a second time.
        event.stopPropagation();
        dragging = false;
        if (!event.dataTransfer) return;

        // Captured synchronously — the item list is gone after the first await.
        // Reading is left to the store, so a failure to unpack an archive is
        // reported like any other import error.
        const drop = collectDrop(event.dataTransfer);
        trackEvent('import-start', { pick: 'drop', surface: 'dialog' });
        close();
        await dataStore.handleImport(() => drop.read(), {
            pick: 'drop',
            surface: 'dialog',
        });
    }

    function pickFile() {
        picked = 'file';
        trackEvent('import-start', { pick: 'file', surface: 'dialog' });
        close();
        fileInput?.click();
    }

    function pickFolder() {
        picked = 'folder';
        trackEvent('import-start', { pick: 'folder', surface: 'dialog' });
        close();
        folderInput?.click();
    }

    function toggleHelp() {
        helpOpen = !helpOpen;
    }

    function showGuide(id: string) {
        helpFor = id;
    }

    /**
     * Moves the node to <body> so `position: fixed` is relative to the
     * viewport. The header ancestor uses backdrop-filter, which otherwise
     * becomes the containing block for fixed descendants (dialog renders
     * clipped against the 52px header instead of centred on screen).
     */
    function portal(node: HTMLElement) {
        document.body.appendChild(node);
        return {
            destroy() {
                node.remove();
            },
        };
    }

    // Reset whenever the dialog is (re)opened.
    $effect(() => {
        if (open) {
            dragging = false;
            helpOpen = false;
            helpFor = firstSourceFor(focus);
        }
    });

    // Holds the window-wide overlay back for as long as this is up.
    $effect(() => {
        if (!open) return;
        openModal();
        return closeModal;
    });
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- Kept outside the {#if}: the pickers close the dialog before opening the
     native chooser, so the input has to outlive it to report back. -->
<input
    type="file"
    accept=".json,.txt,.zip,.xlsx,.fit"
    multiple
    class="hidden"
    bind:this={fileInput}
    onchange={handleFileChange}
/>
<!-- Folder picking needs its own input: `webkitdirectory` turns the native
     dialog into a directory-only chooser, so it can't be the same control as the
     file one. Entries in no format Buho reads are skipped while reading. -->
<input
    type="file"
    webkitdirectory
    class="hidden"
    bind:this={folderInput}
    onchange={handleFileChange}
/>

{#if open}
    <div
        use:portal
        class="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
        role="presentation"
        onclick={close}
    >
        <div
            class="relative max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-border bg-background p-7 shadow-2xl sm:p-8"
            data-module={focus}
            role="dialog"
            aria-modal="true"
            aria-label="Import my data"
            tabindex="-1"
            onclick={(e) => e.stopPropagation()}
            onkeydown={() => {}}
        >
            <button
                class="absolute top-4 right-4 text-muted-foreground transition-colors hover:text-foreground"
                aria-label="Close"
                onclick={close}
            >
                ✕
            </button>

            <h2 class="pr-8 text-lg font-semibold">Import my data</h2>

            <p class="mt-1 text-sm text-muted-foreground">
                Drop any export — music, messages, positions, Google activity, a watch archive — <strong
                    class="font-medium text-foreground"
                >
                    anywhere on the page
                </strong>. Buho works out which service each file came from, so you never have to
                say, and it lands in the right place whichever page you're on. Everything stays in
                your browser.
            </p>

            {#if dataStore.isDemo}
                <p
                    class="mt-4 rounded-lg border border-border bg-secondary/30 p-3 text-sm text-muted-foreground"
                >
                    You're on the demo listening data right now. It's cleared the moment your own
                    music import lands — the two are never mixed.
                </p>
            {/if}

            <SourceInventory />

            <!-- Starts the engine on the hover or the tab, like DropZone. -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div
                class="mt-4 rounded-lg border-2 border-dashed border-border p-6 text-center transition-colors"
                class:dragging
                onpointerenter={warmUpDuckDB}
                onfocusin={warmUpDuckDB}
                ondragover={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    dragging = true;
                }}
                ondragleave={() => (dragging = false)}
                ondrop={handleDrop}
            >
                <p class="text-sm font-medium">Drop your export here</p>
                <p class="mt-1 text-xs text-muted-foreground">
                    A <code class="text-xs">.zip</code>, an unzipped folder, or loose
                    <code class="text-xs">.json</code>
                    /
                    <code class="text-xs">.txt</code>
                    /
                    <code class="text-xs">.xlsx</code>
                    files — or pick them yourself
                </p>
                <div class="mt-4 flex justify-center gap-2">
                    <button
                        class="rounded-full bg-[var(--module-accent)] px-4 py-1.5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
                        onclick={pickFile}
                    >
                        Choose files
                    </button>
                    <button
                        class="rounded-full border border-border px-4 py-1.5 text-sm font-medium transition-colors hover:border-[var(--module-accent)]"
                        onclick={pickFolder}
                    >
                        Choose a folder
                    </button>
                </div>
            </div>

            <!-- The how-to expands in place rather than replacing the screen:
                 picking a service never costs you sight of where the files go. -->
            <div class="mt-5 border-t border-border pt-4">
                <button
                    class="flex w-full items-center justify-between text-sm font-medium transition-colors hover:text-foreground"
                    class:text-muted-foreground={!helpOpen}
                    aria-expanded={helpOpen}
                    onclick={toggleHelp}
                >
                    <span>I don't have my export yet — how do I get one?</span>
                    <span aria-hidden="true">{helpOpen ? '▾' : '▸'}</span>
                </button>

                {#if helpOpen}
                    <div
                        class="mt-3 flex flex-wrap justify-center gap-1 rounded-lg border border-border bg-secondary/40 p-1"
                        role="tablist"
                        aria-label="Export to get"
                    >
                        {#each CATALOG_SOURCES as source (source.id)}
                            <button
                                role="tab"
                                aria-selected={helpFor === source.id}
                                class="flex items-center gap-1.5 rounded-full px-3 py-1 text-sm transition-colors"
                                class:selected={helpFor === source.id}
                                onclick={() => showGuide(source.id)}
                            >
                                {#if source.network}
                                    <NetworkIcon network={source.network} size={16} />
                                {:else}
                                    <Icon name={source.icon} size={16} />
                                {/if}
                                {source.label}
                            </button>
                        {/each}
                    </div>

                    <!-- Only the chosen guide is rendered. With eight of them,
                         stacking all in one cell to pin the height would make the
                         panel as tall as the longest one at all times; the dialog
                         is capped at 85vh and scrolls instead. -->
                    <div class="mt-4">
                        <SourceHowTo source={guide} />
                    </div>

                    <p class="mt-3 text-xs text-muted-foreground">
                        These services show their labels in your own language and move the pages
                        around from time to time. However the files reach you, they stay yours: Buho
                        reads them here in your browser and never uploads them.
                    </p>

                    <!-- The same steps, plus what the archive actually holds and
                         which of it is read — too long to unfold inside a dialog
                         whose job is to take the drop. -->
                    <a
                        class="mt-2 inline-block text-xs font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                        href={resolve('/sources/[source]', { source: guide.id })}
                    >
                        Everything about the {guide.label} export →
                    </a>
                {/if}
            </div>
        </div>
    </div>
{/if}

<style>
    .hidden {
        display: none;
    }

    .dragging {
        border-color: var(--module-accent);
        background: color-mix(in srgb, var(--module-accent) 8%, transparent);
    }

    .selected {
        background: hsl(var(--background));
        color: hsl(var(--foreground));
        font-weight: 600;
    }
</style>
