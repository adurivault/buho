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

    const SPOTIFY_PRIVACY_URL = "https://www.spotify.com/account/privacy/";

    function close() {
        open = false;
        onClose();
    }

    function pickFile() {
        trackEvent("import-file-picked", { source: "spotify" });
        close();
        onPickFile();
    }

    function showInstructions() {
        trackEvent("import-step", { source: "spotify", step: "instructions" });
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
    accent="var(--accent-spotify)"
    title={step === "choose"
        ? "Explore my personal data"
        : "Download your Spotify data"}
    onBack={step === "instructions" ? () => (step = "choose") : undefined}
>
    {#if step === "choose"}
        <p class="mt-1 text-sm text-muted-foreground">
            Buho is more fun with your own data files.
        </p>

        <div class="mt-5 flex flex-col gap-3">
            <button
                class="group flex flex-col items-start rounded-xl border border-border bg-secondary/40 p-4 text-left transition-colors hover:border-[var(--dialog-accent)] hover:bg-secondary/70"
                onclick={pickFile}
            >
                <span class="font-medium">I already have my file</span>
                <span class="mt-0.5 text-sm text-muted-foreground">
                    Pick your Spotify export (a <code class="text-xs">.zip</code
                    >
                    or <code class="text-xs">.json</code> file). You're just pointing
                    to a file on your device — Buho reads it and shows your insights,
                    but the data never leaves your computer. No upload, no tracking,
                    100% local and private.
                </span>
            </button>

            <button
                class="group flex flex-col items-start rounded-xl border border-border bg-secondary/40 p-4 text-left transition-colors hover:border-[var(--dialog-accent)] hover:bg-secondary/70"
                onclick={showInstructions}
            >
                <span class="font-medium"
                    >I need to download it from Spotify</span
                >
                <span class="mt-0.5 text-sm text-muted-foreground">
                    No worries — here's how to grab it, step by step.
                </span>
            </button>
        </div>
    {:else}
        <p class="mt-1 text-sm text-muted-foreground">
            It's a quick request to set up. Spotify then prepares your file and
            emails you a link — usually within 24 hours but can take up to 30
            days.
        </p>

        <ol class="mt-4 flex list-none flex-col gap-3 text-sm [counter-reset:step]">
            <li class="flex gap-3 [counter-increment:step]">
                <span
                    class="flex size-6 shrink-0 items-center justify-center rounded-full bg-[var(--dialog-accent)] text-xs font-semibold text-black before:content-[counter(step)]"
                ></span>
                <span>
                    Open your
                    <a
                        href={SPOTIFY_PRIVACY_URL}
                        target="_blank"
                        rel="noopener noreferrer"
                        class="font-medium text-[var(--dialog-accent)] underline underline-offset-2"
                        >Spotify privacy settings</a
                    >
                    and log in.
                </span>
            </li>
            <li class="flex gap-3 [counter-increment:step]">
                <span
                    class="flex size-6 shrink-0 items-center justify-center rounded-full bg-[var(--dialog-accent)] text-xs font-semibold text-black before:content-[counter(step)]"
                ></span>
                <span>
                    Scroll to <strong>Download your data</strong> and tick
                    <strong>Extended streaming history</strong>. That's the one
                    Buho needs — it holds your whole listening history.
                </span>
            </li>
            <li class="flex gap-3 [counter-increment:step]">
                <span
                    class="flex size-6 shrink-0 items-center justify-center rounded-full bg-[var(--dialog-accent)] text-xs font-semibold text-black before:content-[counter(step)]"
                ></span>
                <span>
                    Click <strong>Request data</strong> and confirm via the email
                    Spotify sends you.
                </span>
            </li>
            <li class="flex gap-3 [counter-increment:step]">
                <span
                    class="flex size-6 shrink-0 items-center justify-center rounded-full bg-[var(--dialog-accent)] text-xs font-semibold text-black before:content-[counter(step)]"
                ></span>
                <span>
                    Once it's ready, Spotify emails you a download link. Save the
                    <code class="text-xs">.zip</code> file and come back here — we'll
                    take it from there.
                </span>
            </li>
        </ol>

        <div class="mt-5 flex flex-col gap-2">
            <a
                href={SPOTIFY_PRIVACY_URL}
                target="_blank"
                rel="noopener noreferrer"
                class="rounded-full bg-[var(--dialog-accent)] px-4 py-2 text-center text-sm font-semibold text-black transition-opacity hover:opacity-90"
            >
                Open Spotify privacy settings
            </a>
            <button
                class="rounded-full px-4 py-2 text-center text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                onclick={pickFile}
            >
                I already downloaded my file
            </button>
        </div>
    {/if}
</ImportDialog>
