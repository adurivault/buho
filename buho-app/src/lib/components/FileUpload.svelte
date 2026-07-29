<script lang="ts">
    import { dataStore } from "$lib/stores/dataStore.svelte";
    import { trackEvent } from "$lib/analytics";
    import SpotifyImportDialog from "$lib/components/SpotifyImportDialog.svelte";

    let fileInput: HTMLInputElement;
    let dialogOpen = $state(false);

    function handleExplorePersonalData() {
        trackEvent("import-open", {
            source: dataStore.source ?? "unknown",
            replace: !dataStore.isDemo,
        });
        dialogOpen = true;
    }

    async function handleFileChange(event: Event) {
        const target = event.target as HTMLInputElement;
        const files = target.files;
        if (files && files.length > 0) {
            await dataStore.handleFilesUpload(files);
        }
        target.value = ""; // Reset input
    }

    function handleSwitchToDemo() {
        dataStore.loadDemoData();
    }
</script>

<div class="relative">
    <input
        type="file"
        accept=".json,.zip"
        multiple
        class="hidden"
        bind:this={fileInput}
        onchange={handleFileChange}
    />

    <SpotifyImportDialog
        bind:open={dialogOpen}
        onClose={() => (dialogOpen = false)}
        onPickFile={() => fileInput?.click()}
    />

    <div
        class="flex items-center gap-2 rounded-full border border-border bg-secondary/40 py-1 pr-1 pl-3 text-sm"
    >
        {#if dataStore.loading}
            <span
                class="size-2 shrink-0 animate-pulse rounded-full bg-primary"
            ></span>
            <span class="text-muted-foreground"
                >{dataStore.loading.message}</span
            >
        {:else if dataStore.isDemo}
            <span
                class="size-2 shrink-0 rounded-full bg-muted-foreground"
                title="You are exploring demo data"
            ></span>
            <span class="font-medium whitespace-nowrap">Demo data</span>
            <button
                class="rounded-full px-2.5 py-0.5 font-semibold whitespace-nowrap text-primary-foreground bg-primary hover:opacity-90 transition-opacity"
                onclick={handleExplorePersonalData}
                disabled={!!dataStore.loading}
            >
                Explore my personal data
            </button>
        {:else}
            <span
                class="size-2 shrink-0 rounded-full bg-[#2dd4a8]"
                title="Viewing your personal Spotify history"
            ></span>
            <span class="font-medium whitespace-nowrap text-[#2dd4a8]"
                >Your data</span
            >
            <button
                class="rounded-full px-2.5 py-0.5 whitespace-nowrap text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                onclick={handleSwitchToDemo}
                disabled={!!dataStore.loading}
            >
                Switch to demo data
            </button>
        {/if}
    </div>
</div>
