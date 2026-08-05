<script lang="ts">
    import ImportDialog from "$lib/components/ImportDialog.svelte";
    import { collectDrop } from "$lib/data/import/entries";
    import type { ImportEntry } from "$lib/data/sources/types";
    import { dataStore } from "$lib/stores/dataStore.svelte";
    import NetworkIcon from "$lib/components/NetworkIcon.svelte";
    import { NETWORK_LABELS, type Network } from "$lib/types/messages";
    import { trackEvent } from "$lib/analytics";

    interface Props {
        open: boolean;
        onClose: () => void;
        onPickFile: (replace: boolean) => void;
        onPickFolder: (replace: boolean) => void;
        /** Receives a deferred reader, so unpacking errors surface upstream. */
        onDropEntries: (
            read: () => Promise<ImportEntry[]>,
            replace: boolean,
        ) => Promise<void>;
    }

    let {
        open = $bindable(),
        onClose,
        onPickFile,
        onPickFolder,
        onDropEntries,
    }: Props = $props();

    let dragging = $state(false);
    /** Only meaningful once something is already imported. */
    let replace = $state(false);
    /** The how-to panel is closed until asked for; it never hides the drop zone. */
    let helpOpen = $state(false);
    let helpFor = $state<Network>("messenger");

    const hasData = $derived(dataStore.messagesSummary.length > 0);
    const report = $derived(dataStore.lastMessagesImport);

    interface Guide {
        network: Network;
        intro: string;
        /** Deep link straight into the export form, skipping the menu hunt. */
        link?: { href: string; label: string };
        /**
         * A second, separate download some services split their data across.
         * Messenger is the case that matters: since Meta turned on end-to-end
         * encryption, the standard export stops at the switchover date and the
         * rest lives behind its own form.
         */
        extra?: { title: string; body: string; href: string; label: string };
        /** The few settings that decide whether the export is usable at all. */
        settings?: Array<{ label: string; value: string; note: string }>;
        steps: string[];
        /** The mistake people actually make, called out after the steps. */
        warning?: string;
    }

    /**
     * Export instructions per service. Strings are literals rendered with
     * {@html} for the inline emphasis — never anything derived from user data.
     *
     * The steps start *after* the deep link lands, which is why they don't
     * describe the Accounts Center menus: the link is already there.
     */
    const GUIDES: Guide[] = [
        {
            network: "messenger",
            intro: "Messenger conversations come from Meta's Accounts Center. This link opens the export form directly.",
            link: {
                href: "https://accountscenter.facebook.com/info_and_permissions/dyi",
                label: "Open Facebook's export page",
            },
            settings: [
                {
                    label: "Format",
                    value: "JSON",
                    note: "Not HTML — Buho can't read HTML exports.",
                },
                {
                    label: "Date range",
                    value: "All time",
                    note: "Defaults to the last few months, which throws away most of your history.",
                },
                {
                    label: "Media quality",
                    value: "Low",
                    note: "Photos are never read, so this only makes the download faster.",
                },
            ],
            steps: [
                "Choose <strong>Download or transfer information</strong>, then pick your Facebook account.",
                "Select <strong>Some of your information</strong> and tick <strong>Messages</strong>. Anything else you tick is simply ignored — no harm in taking it.",
                "Set the three settings above, then request the download.",
                "Meta emails you when it's ready, usually within a few hours.",
            ],
            extra: {
                title: "Then get your encrypted conversations",
                body: "Meta turned on end-to-end encryption for most one-to-one chats. The export above stops at the day each conversation was switched over — everything said since lives behind a second form, and needs your Messenger PIN. Group chats aren't affected. Drop both exports here; Buho merges them.",
                href: "https://www.messenger.com/secure_storage/dyi",
                label: "Open the secure-storage export",
            },
            warning:
                "Large exports are split into several zip files — <strong>download all of them</strong> and drop them here together, or you'll be missing conversations.",
        },
        {
            network: "instagram",
            intro: "Same form as Messenger, on the Instagram side of the Accounts Center. The archives look identical; Buho tells them apart on its own.",
            link: {
                href: "https://accountscenter.instagram.com/info_and_permissions/dyi/?theme=dark",
                label: "Open Instagram's export page",
            },
            settings: [
                {
                    label: "Format",
                    value: "JSON",
                    note: "Not HTML — Buho can't read HTML exports.",
                },
                {
                    label: "Date range",
                    value: "All time",
                    note: "Defaults to the last few months, which throws away most of your history.",
                },
                {
                    label: "Media quality",
                    value: "Low",
                    note: "Photos are never read, so this only makes the download faster.",
                },
            ],
            steps: [
                "Choose <strong>Download or transfer information</strong>, then pick your Instagram account.",
                "Select <strong>Some of your information</strong> and tick <strong>Messages</strong>. Anything else you tick is simply ignored — no harm in taking it.",
                "Set the three settings above, then request the download.",
                "Meta emails you when it's ready, usually within a few hours.",
            ],
            warning:
                "Large exports are split into several zip files — <strong>download all of them</strong> and drop them here together, or you'll be missing conversations.",
        },
        {
            network: "whatsapp",
            intro: "WhatsApp has no bulk export and no web form: conversations are exported one at a time, from the phone app.",
            settings: [
                {
                    label: "Attachments",
                    value: "Without media",
                    note: "The photos aren't read anyway, and 'with media' can be hundreds of megabytes.",
                },
            ],
            steps: [
                "Open a conversation, tap the contact or group name at the top.",
                "Scroll down to <strong>Export chat</strong>, then choose <strong>Without media</strong>.",
                "Send the <code class='text-xs'>.txt</code> to yourself — mail, AirDrop, whatever reaches your computer.",
                "Repeat for the conversations you care about.",
            ],
            warning:
                "You can drop <strong>all the exported chats at once</strong> — no need to add them one by one.",
        },
    ];

    function close() {
        open = false;
        onClose();
    }

    function pickFile() {
        trackEvent("import-file-picked", {
            source: "messages",
            pick: "file",
            replace,
        });
        close();
        onPickFile(replace);
    }

    function pickFolder() {
        trackEvent("import-file-picked", {
            source: "messages",
            pick: "folder",
            replace,
        });
        close();
        onPickFolder(replace);
    }

    function toggleHelp() {
        helpOpen = !helpOpen;
        if (helpOpen) {
            trackEvent("import-step", { source: "messages", step: "help" });
        }
    }

    function showGuide(network: Network) {
        helpFor = network;
        trackEvent("import-step", {
            source: "messages",
            step: "help",
            network,
        });
    }

    async function handleDrop(event: DragEvent) {
        event.preventDefault();
        dragging = false;
        if (!event.dataTransfer) return;

        // Captured synchronously — the item list is gone after the first await.
        // Reading it is left to the store, so a failure to unpack an archive is
        // reported like any other import error instead of vanishing.
        const drop = collectDrop(event.dataTransfer);
        trackEvent("import-file-picked", {
            source: "messages",
            pick: "drop",
            replace,
        });
        const wasReplace = replace;
        close();
        await onDropEntries(() => drop.read(), wasReplace);
    }

    // Reset whenever the dialog is (re)opened.
    $effect(() => {
        if (open) {
            replace = false;
            dragging = false;
            helpOpen = false;
        }
    });
</script>

<ImportDialog
    bind:open
    {onClose}
    accent="var(--accent-messages)"
    title="Import my messages"
    maxWidth="max-w-2xl"
>
    <p class="mt-1 text-sm text-muted-foreground">
        Drop a Messenger, Instagram or WhatsApp export — zip, folder or loose
        files. Buho works out which service each file came from, so you don't
        have to say. Everything stays in your browser.
    </p>

    {#if report}
        <div
            class="mt-4 rounded-xl border border-border bg-secondary/30 p-3 text-sm"
        >
            <p class="font-medium">Last import</p>
            <ul class="mt-1 space-y-0.5 text-muted-foreground">
                {#each report.networks as found}
                    <li>
                        {NETWORK_LABELS[found.network]}: {found.threads.toLocaleString()}
                        conversation{found.threads > 1 ? "s" : ""},
                        {found.messages.toLocaleString()} messages
                    </li>
                {/each}
                {#if report.unrecognisedFiles > 0}
                    <li>
                        {report.unrecognisedFiles.toLocaleString()} file{report
                            .unrecognisedFiles > 1
                            ? "s"
                            : ""} in no format Buho recognises — ignored.
                    </li>
                {/if}
            </ul>
        </div>
    {/if}

    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
        class="mt-4 rounded-xl border-2 border-dashed p-6 text-center transition-colors"
        class:dragging
        ondragover={(e) => {
            e.preventDefault();
            dragging = true;
        }}
        ondragleave={() => (dragging = false)}
        ondrop={handleDrop}
    >
        <p class="text-sm font-medium">Drop your export here</p>
        <p class="mt-1 text-xs text-muted-foreground">
            A <code class="text-xs">.zip</code>, an unzipped folder, or
            individual
            <code class="text-xs">.json</code> / <code class="text-xs">.txt</code>
            files
        </p>
        <div class="mt-4 flex justify-center gap-2">
            <button
                class="rounded-full bg-[var(--dialog-accent)] px-4 py-1.5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
                onclick={pickFile}
            >
                Choose files
            </button>
            <button
                class="rounded-full border border-border px-4 py-1.5 text-sm font-medium transition-colors hover:border-[var(--dialog-accent)]"
                onclick={pickFolder}
            >
                Choose a folder
            </button>
        </div>
    </div>

    {#if hasData}
        <label class="mt-4 flex items-start gap-2 text-sm">
            <input type="checkbox" bind:checked={replace} class="mt-0.5" />
            <span>
                Replace everything already imported
                <span class="block text-xs text-muted-foreground">
                    Off by default: imports add up, and re-importing the same
                    archive changes nothing.
                </span>
            </span>
        </label>
    {/if}

    <!-- The how-to expands in place rather than replacing the screen: picking a
         service never costs you sight of where the files go. -->
    <div class="mt-5 border-t border-border pt-4">
        <button
            class="flex w-full items-center justify-between text-sm font-medium transition-colors hover:text-foreground"
            class:text-muted-foreground={!helpOpen}
            aria-expanded={helpOpen}
            onclick={toggleHelp}
        >
            <span>I don't have my export yet — how do I get one?</span>
            <span aria-hidden="true">{helpOpen ? "▾" : "▸"}</span>
        </button>

        {#if helpOpen}
            <div class="mt-3 flex justify-center">
                <div
                    class="inline-flex rounded-full border border-border bg-secondary/40 p-0.5 text-sm"
                    role="tablist"
                    aria-label="Messaging service"
                >
                    {#each GUIDES as guide}
                        <button
                            role="tab"
                            aria-selected={helpFor === guide.network}
                            class="flex items-center gap-1.5 rounded-full px-3 py-1 transition-colors"
                            class:selected={helpFor === guide.network}
                            onclick={() => showGuide(guide.network)}
                        >
                            <NetworkIcon network={guide.network} />
                            {NETWORK_LABELS[guide.network]}
                        </button>
                    {/each}
                </div>
            </div>

            <!-- All three guides share one grid cell, so the panel is always as
                 tall as the longest of them. Switching service then changes the
                 text without resizing the dialog — which, being centred in the
                 viewport, would otherwise jump on both edges at every click. -->
            <div class="guide-stack mt-3">
                {#each GUIDES as guide}
                    {@const active = helpFor === guide.network}
                    <div
                        class="guide-panel"
                        style:visibility={active ? "visible" : "hidden"}
                        aria-hidden={!active}
                    >
                        <p class="text-sm text-muted-foreground">
                            {guide.intro}
                        </p>

                        {#if guide.link}
                            <a
                                class="mt-3 inline-flex items-center gap-2 rounded-full bg-[var(--dialog-accent)] px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90"
                                href={guide.link.href}
                                target="_blank"
                                rel="noreferrer"
                                tabindex={active ? 0 : -1}
                            >
                                {guide.link.label}
                                <span aria-hidden="true">↗</span>
                            </a>
                        {/if}

                        {#if guide.settings}
                            <div
                                class="mt-4 rounded-xl border border-[var(--dialog-accent)]/40 bg-[var(--dialog-accent)]/5 p-3"
                            >
                                <p class="text-xs font-semibold tracking-wide uppercase">
                                    Get these right
                                </p>
                                <dl class="mt-2 space-y-2">
                                    {#each guide.settings as setting}
                                        <div
                                            class="flex flex-wrap items-baseline gap-x-2"
                                        >
                                            <dt
                                                class="text-sm text-muted-foreground"
                                            >
                                                {setting.label}
                                            </dt>
                                            <dd
                                                class="rounded bg-[var(--dialog-accent)] px-2 py-0.5 text-sm font-semibold text-white"
                                            >
                                                {setting.value}
                                            </dd>
                                            <dd
                                                class="w-full text-xs text-muted-foreground"
                                            >
                                                {setting.note}
                                            </dd>
                                        </div>
                                    {/each}
                                </dl>
                            </div>
                        {/if}

                        <ol
                            class="mt-4 flex list-none flex-col gap-3 text-sm [counter-reset:step]"
                        >
                            {#each guide.steps as instruction}
                                <li class="flex gap-3 [counter-increment:step]">
                                    <span
                                        class="flex size-6 shrink-0 items-center justify-center rounded-full bg-[var(--dialog-accent)] text-xs font-semibold text-white before:content-[counter(step)]"
                                    ></span>
                                    <span>{@html instruction}</span>
                                </li>
                            {/each}
                        </ol>

                        {#if guide.extra}
                            <div
                                class="mt-4 rounded-xl border border-[var(--dialog-accent)]/40 p-3"
                            >
                                <p class="text-sm font-semibold">
                                    {guide.extra.title}
                                </p>
                                <p class="mt-1 text-sm text-muted-foreground">
                                    {guide.extra.body}
                                </p>
                                <a
                                    class="mt-3 inline-flex items-center gap-2 rounded-full border border-[var(--dialog-accent)] px-4 py-1.5 text-sm font-semibold transition-colors hover:bg-[var(--dialog-accent)] hover:text-white"
                                    href={guide.extra.href}
                                    target="_blank"
                                    rel="noreferrer"
                                    tabindex={active ? 0 : -1}
                                >
                                    {guide.extra.label}
                                    <span aria-hidden="true">↗</span>
                                </a>
                            </div>
                        {/if}

                        {#if guide.warning}
                            <p
                                class="mt-4 rounded-xl border border-border bg-secondary/40 p-3 text-sm"
                            >
                                {@html guide.warning}
                            </p>
                        {/if}
                    </div>
                {/each}
            </div>

            <p class="mt-3 text-xs text-muted-foreground">
                These apps show the labels in your own language and move them
                around from time to time. However the files reach you, they stay
                yours: Buho reads them here in your browser and never uploads
                them.
            </p>
        {/if}
    </div>
</ImportDialog>

<style>
    .dragging {
        border-color: var(--dialog-accent);
        background: color-mix(in srgb, var(--dialog-accent) 8%, transparent);
    }

    .selected {
        background: hsl(var(--background));
        color: hsl(var(--foreground));
        font-weight: 600;
    }

    /* Every guide sits in the same cell: the stack is as tall as the tallest
       one, whichever is showing. `visibility` (not `display`) is what keeps the
       hidden ones occupying their space — and out of the tab order. */
    .guide-stack {
        display: grid;
    }

    .guide-panel {
        grid-area: 1 / 1;
    }
</style>
