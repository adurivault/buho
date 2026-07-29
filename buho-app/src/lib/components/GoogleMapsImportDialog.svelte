<script lang="ts">
    import ImportDialog from "$lib/components/ImportDialog.svelte";
    import { trackEvent } from "$lib/analytics";

    interface Props {
        open: boolean;
        onClose: () => void;
        onPickFile: () => void;
    }

    let { open = $bindable(), onClose, onPickFile }: Props = $props();

    type Step = "choose" | "instructions";
    let step = $state<Step>("choose");

    type Platform = "android" | "ios";
    let platform = $state<Platform>("android");

    // Literal strings, rendered with {@html} for the inline emphasis.
    const STEPS: Record<Platform, string[]> = {
        android: [
            "Open your phone's <strong>Settings</strong> app — the system settings, not the Google Maps app.",
            "Go to <strong>Location</strong> → <strong>Location services</strong> → <strong>Timeline</strong>, and pick your Google account if it asks.",
            "Tap <strong>Export Timeline data</strong> and choose where to save it.",
            "You get a <code class='text-xs'>Timeline.json</code> file. Send it to your computer (Drive, email, cable), then come back here.",
        ],
        ios: [
            "Open the <strong>Google Maps</strong> app and tap your <strong>profile letter</strong> in the top right.",
            "Tap <strong>Your Timeline</strong>.",
            "Tap the <strong>⋮</strong> icon in the top right, then <strong>Location &amp; privacy settings</strong>.",
            "Tap <strong>Export Timeline data</strong>.",
            "Share the file to yourself — AirDrop, email, whatever — and open it here from your computer. It's named <code class='text-xs'>Timeline.json</code> or <code class='text-xs'>location-history.json</code>.",
        ],
    };

    function close() {
        open = false;
        onClose();
    }

    function pickFile() {
        trackEvent("import-file-picked", { source: "google-maps" });
        close();
        onPickFile();
    }

    function showInstructions() {
        trackEvent("import-step", { source: "google-maps", step: "instructions" });
        step = "instructions";
    }

    // Reset to the first step whenever the dialog is (re)opened.
    $effect(() => {
        if (open) step = "choose";
    });
</script>

<ImportDialog
    bind:open
    {onClose}
    accent="var(--accent-maps)"
    title={step === "choose"
        ? "Import my Timeline"
        : "Export your Timeline from your phone"}
    onBack={step === "instructions" ? () => (step = "choose") : undefined}
>
    {#if step === "choose"}
        <p class="mt-1 text-sm text-muted-foreground">
            Buho maps the places you've been, from your own Google Timeline
            export.
        </p>

        <div class="mt-5 flex flex-col gap-3">
            <button
                class="group flex flex-col items-start rounded-xl border border-border bg-secondary/40 p-4 text-left transition-colors hover:border-[var(--dialog-accent)] hover:bg-secondary/70"
                onclick={pickFile}
            >
                <span class="font-medium">I already have my Timeline file</span>
                <span class="mt-0.5 text-sm text-muted-foreground">
                    Pick your <code class="text-xs">Timeline.json</code> (also
                    named
                    <code class="text-xs">location-history.json</code>, or a
                    <code class="text-xs">.zip</code> holding it). You're just pointing
                    to a file on your device — Buho reads it and draws your maps,
                    but the data never leaves your computer. No upload, no tracking,
                    100% local and private.
                </span>
            </button>

            <button
                class="group flex flex-col items-start rounded-xl border border-border bg-secondary/40 p-4 text-left transition-colors hover:border-[var(--dialog-accent)] hover:bg-secondary/70"
                onclick={showInstructions}
            >
                <span class="font-medium">I need to export it from my phone</span
                >
                <span class="mt-0.5 text-sm text-muted-foreground">
                    Timeline isn't in Google Takeout anymore — the export lives
                    on your phone. Here's how, step by step.
                </span>
            </button>
        </div>
    {:else}
        <p class="mt-1 text-sm text-muted-foreground">
            Google no longer ships Timeline with Takeout: your location history
            now stays on your phone, so the export has to be done from there. It
            takes a minute, no waiting.
        </p>

        <div
            class="mt-4 inline-flex rounded-full border border-border bg-secondary/40 p-0.5 text-sm"
            role="tablist"
            aria-label="Phone platform"
        >
            {#each [{ id: "android", label: "Android" }, { id: "ios", label: "iPhone" }] as const as tab}
                <button
                    role="tab"
                    aria-selected={platform === tab.id}
                    class="rounded-full px-3 py-1 transition-colors"
                    class:selected={platform === tab.id}
                    onclick={() => {
                        trackEvent("import-step", {
                            source: "google-maps",
                            step: "instructions",
                            platform: tab.id,
                        });
                        platform = tab.id;
                    }}
                >
                    {tab.label}
                </button>
            {/each}
        </div>

        <ol
            class="mt-4 flex list-none flex-col gap-3 text-sm [counter-reset:step]"
        >
            {#each STEPS[platform] as instruction}
                <li class="flex gap-3 [counter-increment:step]">
                    <span
                        class="flex size-6 shrink-0 items-center justify-center rounded-full bg-[var(--dialog-accent)] text-xs font-semibold text-white before:content-[counter(step)]"
                    ></span>
                    <span>{@html instruction}</span>
                </li>
            {/each}
        </ol>

        <p class="mt-4 text-sm text-muted-foreground">
            Your phone shows these labels in its own language. Whatever way you
            move the file over, it stays yours: Buho reads it here in your
            browser and never uploads it.
        </p>

        <div class="mt-5 flex flex-col gap-2">
            <button
                class="rounded-full bg-[var(--dialog-accent)] px-4 py-2 text-center text-sm font-semibold text-white transition-opacity hover:opacity-90"
                onclick={pickFile}
            >
                I already exported my file
            </button>
        </div>
    {/if}
</ImportDialog>

<style>
    .selected {
        background: hsl(var(--background));
        color: hsl(var(--foreground));
        font-weight: 600;
    }
</style>
