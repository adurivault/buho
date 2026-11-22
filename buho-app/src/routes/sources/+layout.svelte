<script lang="ts">
    import ImportStatus from '#lib/components/ImportStatus.svelte';

    /**
     * The import feedback, on the pages that ask for an import.
     *
     * Every module route already mounts this; /sources did not, so the drop
     * zone on a source page had nowhere to report — no progress while a
     * gigabyte was being unpacked, and no word on what the drop turned out to
     * hold. The sidebar icon lighting up is far too easy to miss.
     */
    let { children } = $props();
</script>

<div class="sources-shell">
    <ImportStatus />

    <div class="sources-content">
        {@render children()}
    </div>
</div>

<style>
    .sources-shell {
        display: flex;
        flex-direction: column;
        height: 100%;
    }

    .sources-content {
        flex: 1;
        min-height: 0;
        overflow-y: auto;
    }
</style>
