<script lang="ts">
    import { dataStore } from '#lib/stores/dataStore.svelte.ts';
    import { uiStore } from '#lib/stores/uiStore.svelte.ts';
    import { collectDrop } from '#lib/data/import/entries.ts';
    import { warmUpDuckDB } from '#lib/data/db/index.ts';
    import { DATA_MODULES } from '#lib/data/modules.ts';
    import Icon from '#lib/components/Icon.svelte';
    import { trackEvent } from '#lib/analytics.ts';

    /**
     * The app's drop zone, which is the whole window.
     *
     * Mounted once in the root layout, so the gesture is the same on every page
     * and nothing has to be opened first. What you drop is never declared — the
     * router sniffs each file and sends it where it belongs — so the page you
     * happen to be on has no bearing on where the data lands.
     *
     * Drops always **add**. Replacing is a deliberate choice, so it lives in the
     * import dialog — which is also why this stands down entirely while a modal
     * is open: the dialog takes its own drops, and honours its checkbox doing
     * it. Painting a second full-screen panel over the one you just opened would
     * be the app talking over itself.
     */

    /**
     * `dragleave` fires every time the pointer crosses into a child element, so
     * a single boolean flickers off halfway across the page. Counting enters
     * against leaves is what makes "still somewhere over the window" answerable.
     */
    let depth = $state(0);

    /** Stood down while a modal owns the screen, or while an import is running. */
    const standingBy = $derived(uiStore.modalOpen || !!dataStore.loading);
    const showing = $derived(depth > 0 && !standingBy);

    /**
     * Only a drag carrying files concerns us. Dragging selected text, a link, or
     * a brush handle inside a chart must leave the page alone.
     */
    function carriesFiles(event: DragEvent): boolean {
        return Array.from(event.dataTransfer?.types ?? []).includes('Files');
    }

    function onDragEnter(event: DragEvent) {
        if (!carriesFiles(event)) return;
        event.preventDefault();
        depth += 1;
        // A file over the window lands a second or so later: a head start for
        // the engine, which the import would otherwise wait on.
        warmUpDuckDB();
    }

    function onDragOver(event: DragEvent) {
        if (!carriesFiles(event)) return;
        // Without this the browser takes the drop itself and navigates to the
        // file: opening it is the default action, and the page never sees it.
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    }

    function onDragLeave(event: DragEvent) {
        if (!carriesFiles(event)) return;
        depth = Math.max(0, depth - 1);
    }

    /** A drag that ends outside the window never fires `dragleave` on the last child. */
    function reset() {
        depth = 0;
    }

    /**
     * Zones that take their own drops — the import dialog, the onboarding step —
     * stop the event before it reaches the window, so the handler below is never
     * the one that ends those drags and the enters counted on the way in stay
     * unanswered. Caught on the way down instead: whoever ends up reading the
     * files, the drag is over. Without this the leftover count paints the
     * overlay the moment the import finishes and the stand-down lifts, with no
     * drag left to dismiss it.
     */
    $effect(() => {
        window.addEventListener('drop', reset, true);
        window.addEventListener('dragend', reset, true);
        return () => {
            window.removeEventListener('drop', reset, true);
            window.removeEventListener('dragend', reset, true);
        };
    });

    async function onDrop(event: DragEvent) {
        if (!carriesFiles(event)) return;
        // Claimed even when standing by, so a stray drop can't make the browser
        // navigate away to the file — but the dialog, whose own zone stops the
        // event before it reaches here, gets first refusal.
        event.preventDefault();
        depth = 0;
        if (!event.dataTransfer || standingBy) return;

        // Captured synchronously: `DataTransfer.items` is emptied as soon as this
        // handler yields, so the roots are grabbed before the first await and the
        // reading is left to the store, where a failure to unpack an archive is
        // reported like any other import error.
        const drop = collectDrop(event.dataTransfer);
        trackEvent('import-start', { pick: 'drop', surface: 'window' });
        await dataStore.handleImport(() => drop.read(), {
            pick: 'drop',
            surface: 'window',
        });
    }
</script>

<svelte:window
    ondragenter={onDragEnter}
    ondragover={onDragOver}
    ondragleave={onDragLeave}
    ondrop={onDrop}
    ondragend={reset}
/>

{#if showing}
    <!-- Decorative: it acknowledges a mouse gesture already under way, and the
         outcome is announced by the import status bar. -->
    <div class="overlay" aria-hidden="true">
        <div class="frame">
            <p class="title">Drop it anywhere</p>
            <p class="hint">Buho works out which export it is. Nothing leaves your browser.</p>
            <ul class="modules">
                {#each DATA_MODULES as module (module.id)}
                    <li data-module={module.id}>
                        <Icon name={module.icon} size={18} />
                        <span>{module.label}</span>
                    </li>
                {/each}
            </ul>
        </div>
    </div>
{/if}

<style>
    .overlay {
        position: fixed;
        inset: 0;
        /* Above everything, which costs nothing: it never renders while a modal
           is up, so there is nothing left for it to cover. */
        z-index: 200;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 2rem;
        background: hsl(var(--background) / 0.72);
        backdrop-filter: blur(3px);
        /* The drag events have to reach the elements underneath, or crossing
           into the overlay itself would read as leaving the page. */
        pointer-events: none;
        animation: fade-in 0.12s ease-out;
    }

    .frame {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.5rem;
        max-width: 32rem;
        padding: 2.5rem 3rem;
        text-align: center;
        border: 2px dashed hsl(var(--primary) / 0.7);
        border-radius: 1.25rem;
        background: hsl(var(--background) / 0.9);
    }

    .title {
        font-size: var(--text-subheading);
        font-weight: 600;
    }

    .hint {
        font-size: var(--text-body);
        color: hsl(var(--muted-foreground));
    }

    .modules {
        list-style: none;
        margin: 0.75rem 0 0;
        padding: 0;
        display: flex;
        flex-wrap: wrap;
        justify-content: center;
        gap: 0.375rem;
    }

    .modules li {
        display: flex;
        align-items: center;
        gap: 0.35rem;
        padding: 0.25rem 0.6rem;
        border-radius: var(--radius-pill);
        font-size: var(--text-small);
        color: var(--module-accent);
        background: color-mix(in srgb, var(--module-accent) 12%, transparent);
    }

    @keyframes fade-in {
        from {
            opacity: 0;
        }
        to {
            opacity: 1;
        }
    }
</style>
