<script lang="ts">
    interface Props {
        open: boolean;
        onClose: () => void;
        onPickFile: () => void;
    }

    let { open = $bindable(), onClose, onPickFile }: Props = $props();

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

    type Step = "choose" | "instructions";
    let step = $state<Step>("choose");

    const SPOTIFY_PRIVACY_URL = "https://www.spotify.com/account/privacy/";

    function close() {
        open = false;
        onClose();
    }

    function pickFile() {
        close();
        onPickFile();
    }

    function handleKeydown(event: KeyboardEvent) {
        if (event.key === "Escape") close();
    }

    // Reset to the first step whenever the dialog is (re)opened.
    $effect(() => {
        if (open) step = "choose";
    });
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open}
    <div
        use:portal
        class="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
        role="presentation"
        onclick={close}
    >
        <div
            class="relative w-full max-w-lg rounded-2xl border border-border bg-background p-7 shadow-2xl sm:p-8"
            role="dialog"
            aria-modal="true"
            aria-label="Explore my personal data"
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

            {#if step === "choose"}
                <h2 class="pr-8 text-lg font-semibold">
                    Explore my personal data
                </h2>
                <p class="mt-1 text-sm text-muted-foreground">
                    Buho is more fun with your own data files.
                </p>

                <div class="mt-5 flex flex-col gap-3">
                    <button
                        class="group flex flex-col items-start rounded-xl border border-border bg-secondary/40 p-4 text-left transition-colors hover:border-[var(--accent-spotify)] hover:bg-secondary/70"
                        onclick={pickFile}
                    >
                        <span class="font-medium">I already have my file</span>
                        <span class="mt-0.5 text-sm text-muted-foreground">
                            Pick your Spotify export (a <code class="text-xs"
                                >.zip</code
                            >
                            or <code class="text-xs">.json</code> file). You're just
                            pointing to a file on your device — Buho reads it and
                            shows your insights, but the data never leaves your computer.
                            No upload, no tracking, 100% local and private.
                        </span>
                    </button>

                    <button
                        class="group flex flex-col items-start rounded-xl border border-border bg-secondary/40 p-4 text-left transition-colors hover:border-[var(--accent-spotify)] hover:bg-secondary/70"
                        onclick={() => (step = "instructions")}
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
                <div class="flex items-center gap-2 pr-8">
                    <button
                        class="text-muted-foreground transition-colors hover:text-foreground"
                        aria-label="Back"
                        onclick={() => (step = "choose")}
                    >
                        ←
                    </button>
                    <h2 class="text-lg font-semibold">
                        Download your Spotify data
                    </h2>
                </div>

                <p class="mt-1 text-sm text-muted-foreground">
                    It's a quick request to set up. Spotify then prepares your
                    file and emails you a link — usually within 24 hours but can
                    take up to 30 days.
                </p>

                <ol
                    class="mt-4 flex list-none flex-col gap-3 text-sm [counter-reset:step]"
                >
                    <li class="flex gap-3 [counter-increment:step]">
                        <span
                            class="flex size-6 shrink-0 items-center justify-center rounded-full bg-[var(--accent-spotify)] text-xs font-semibold text-black before:content-[counter(step)]"
                        ></span>
                        <span>
                            Open your
                            <a
                                href={SPOTIFY_PRIVACY_URL}
                                target="_blank"
                                rel="noopener noreferrer"
                                class="font-medium text-[var(--accent-spotify)] underline underline-offset-2"
                                >Spotify privacy settings</a
                            >
                            and log in.
                        </span>
                    </li>
                    <li class="flex gap-3 [counter-increment:step]">
                        <span
                            class="flex size-6 shrink-0 items-center justify-center rounded-full bg-[var(--accent-spotify)] text-xs font-semibold text-black before:content-[counter(step)]"
                        ></span>
                        <span>
                            Scroll to <strong>Download your data</strong> and
                            tick
                            <strong>Extended streaming history</strong>. That's
                            the one Buho needs — it holds your whole listening
                            history.
                        </span>
                    </li>
                    <li class="flex gap-3 [counter-increment:step]">
                        <span
                            class="flex size-6 shrink-0 items-center justify-center rounded-full bg-[var(--accent-spotify)] text-xs font-semibold text-black before:content-[counter(step)]"
                        ></span>
                        <span>
                            Click <strong>Request data</strong> and confirm via the
                            email Spotify sends you.
                        </span>
                    </li>
                    <li class="flex gap-3 [counter-increment:step]">
                        <span
                            class="flex size-6 shrink-0 items-center justify-center rounded-full bg-[var(--accent-spotify)] text-xs font-semibold text-black before:content-[counter(step)]"
                        ></span>
                        <span>
                            Once it's ready, Spotify emails you a download link.
                            Save the <code class="text-xs">.zip</code> file and come
                            back here — we'll take it from there.
                        </span>
                    </li>
                </ol>

                <div class="mt-5 flex flex-col gap-2">
                    <a
                        href={SPOTIFY_PRIVACY_URL}
                        target="_blank"
                        rel="noopener noreferrer"
                        class="rounded-full bg-[var(--accent-spotify)] px-4 py-2 text-center text-sm font-semibold text-black transition-opacity hover:opacity-90"
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
        </div>
    </div>
{/if}
