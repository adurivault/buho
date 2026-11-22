<script lang="ts">
    /**
     * The share control: one button on a chart, a short menu of file formats
     * behind it, and a progress line while the export runs.
     *
     * Every format is produced in this tab (see `lib/export/`), so the menu is
     * built from what *this browser* can actually encode rather than from a
     * fixed list — a browser without canvas recording is offered the still and
     * the GIF, not a video button that fails when pressed.
     */
    import { Check, ClipboardCopy, Download, Loader2, Share2, X } from '@lucide/svelte';
    import {
        APP_PITCH,
        APP_URL,
        SHARE_CHANNELS,
        canCopyImage,
        canShareFile,
        capture,
        CaptureAborted,
        clipRate,
        clipSeconds,
        downloadBlob,
        formatBytes,
        formatIsAvailable,
        planVideoFormat,
        copyImageToClipboard,
        shareBlob,
        type CaptureResult,
        type ShareFormat,
        type ShareSource,
    } from '#lib/export/index.ts';
    import { bucket, trackEvent } from '#lib/analytics.ts';

    type Props = {
        source: ShareSource;
        /** Analytics id for the chart. A literal, never derived from data. */
        vizId: string;
        /**
         * Lay the control over the chart's top-right corner instead of leaving
         * it in the flow.
         *
         * Off by default, and that is the lesson of having had it on: floating
         * assumes the corner is free, and on a chart with controls of its own
         * it is not — the button landed on top of the constellation's "Reset
         * view". Charts that have a control row take this one into it; the
         * corner is for the ones that have nowhere else to put it.
         */
        floating?: boolean;
    };

    let { source, vizId, floating = false }: Props = $props();

    let root = $state<HTMLDivElement | undefined>(undefined);
    let trigger = $state<HTMLButtonElement | undefined>(undefined);
    let open = $state(false);
    let busy = $state<ShareFormat | null>(null);
    let progress = $state(0);
    let error = $state<string | null>(null);
    let result = $state<CaptureResult | null>(null);
    let copied = $state(false);
    let controller: AbortController | null = null;

    const canCopy = $derived(canCopyImage());

    const hasAnimation = $derived(Boolean(source.animation));

    /**
     * Which container a clip would come out in, asked of the encoder itself.
     *
     * Only settled once the menu is open, because answering means measuring the
     * plate and putting the question to the platform encoder — too much to do
     * on every chart the page renders. Until then the row says "Video" and
     * nothing more, which is true.
     */
    let videoExt = $state<'mp4' | 'webm' | null>(null);

    $effect(() => {
        if (!open || !hasAnimation) return;
        let live = true;
        planVideoFormat(source).then((ext) => {
            if (live) videoExt = ext;
        });
        return () => {
            live = false;
        };
    });

    /**
     * WebM plays in a browser and almost nowhere else — QuickTime will not open
     * it, and X, Instagram, WhatsApp and iMessage all reject it. When that is
     * what this browser can produce, the menu says so before the click rather
     * than leaving someone to discover it with a file in hand.
     */
    const videoNote = $derived.by(() => {
        const seconds = Math.round(clipSeconds('video', source));
        const fps = clipRate('video', source);
        if (videoExt === 'webm') return `WebM · ${seconds}s · browsers only`;
        if (videoExt === 'mp4') return `MP4 · ${seconds}s · ${fps}fps`;
        return `${seconds}s · ${fps}fps`;
    });

    type Choice = { format: ShareFormat; label: string; note: string };

    const choices = $derived.by((): Choice[] => {
        const list: Choice[] = [
            {
                format: 'png',
                label: 'Image',
                note: hasAnimation ? 'PNG · this frame' : 'PNG · high resolution',
            },
        ];
        if (formatIsAvailable('video', source)) {
            list.push({ format: 'video', label: 'Video', note: videoNote });
        }
        if (formatIsAvailable('gif', source)) {
            list.push({
                format: 'gif',
                label: 'GIF',
                note: `Loops · ${Math.round(clipSeconds('gif', source))}s · ${Math.round(clipRate('gif', source))}fps`,
            });
        }
        return list;
    });

    const shareable = $derived(result ? canShareFile(result.blob, result.filename) : false);

    function reset() {
        controller?.abort();
        controller = null;
        busy = null;
        progress = 0;
        error = null;
        result = null;
        copied = false;
    }

    function toggle() {
        if (open) {
            reset();
            open = false;
        } else {
            open = true;
        }
    }

    async function run(format: ShareFormat) {
        if (busy) return;
        controller = new AbortController();
        busy = format;
        progress = 0;
        error = null;
        result = null;
        trackEvent('viz-share', { viz: vizId, format, outcome: 'start' });

        try {
            const captured = await capture(source, format, {
                signal: controller.signal,
                onProgress: (fraction) => (progress = fraction),
            });
            result = captured;
            // Saved without a second click: the menu was the confirmation.
            downloadBlob(captured.blob, captured.filename);
            trackEvent('viz-share', {
                viz: vizId,
                format,
                outcome: 'done',
                // Bucketed, like every other count we send: an exact byte size
                // is a fingerprint of one person's data, not a measurement.
                size: bucket(captured.blob.size),
            });
        } catch (e) {
            if (e instanceof CaptureAborted) {
                trackEvent('viz-share', { viz: vizId, format, outcome: 'cancel' });
            } else {
                error = e instanceof Error ? e.message : 'The export failed on this browser.';
                trackEvent('viz-share', { viz: vizId, format, outcome: 'error' });
            }
        } finally {
            busy = null;
            controller = null;
        }
    }

    /**
     * Closing on a click anywhere else.
     *
     * Bound to the window rather than to a backdrop element: a backdrop over a
     * chart would swallow the first click of a pan or a scrub, and this control
     * sits on top of charts that are dragged.
     */
    function onWindowPointerDown(event: PointerEvent) {
        if (!open || busy) return;
        if (root && event.target instanceof Node && root.contains(event.target)) return;
        reset();
        open = false;
    }

    function onWindowKeydown(event: KeyboardEvent) {
        if (event.key !== 'Escape' || !open) return;
        reset();
        open = false;
        trigger?.focus();
    }

    /**
     * Copy the still, without awaiting anything first.
     *
     * The capture is started and its promise handed straight to the clipboard:
     * Safari only honours a write registered inside the click, and rendering
     * outlives the click by seconds. So this function must stay synchronous up
     * to the `copyImageToClipboard` call — an `await` before it would spend the
     * gesture. See `promote.ts`.
     */
    function copyImage() {
        if (busy) return;
        controller = new AbortController();
        busy = 'png';
        progress = 0;
        error = null;
        result = null;
        copied = false;
        trackEvent('viz-share', { viz: vizId, format: 'png', outcome: 'copy' });

        const pending = capture(source, 'png', {
            signal: controller.signal,
            onProgress: (fraction) => (progress = fraction),
        }).then((captured) => captured.blob);

        copyImageToClipboard(pending)
            .then(() => {
                copied = true;
            })
            .catch((e) => {
                if (!(e instanceof CaptureAborted)) {
                    error = 'This browser would not take the image.';
                }
            })
            .finally(() => {
                busy = null;
                controller = null;
            });
    }

    async function openSheet() {
        if (!result) return;
        try {
            await shareBlob(
                result.blob,
                result.filename,
                source.title ?? 'Buho',
                APP_PITCH,
                APP_URL
            );
        } catch {
            error = 'The share sheet is not available here.';
        }
    }

    function tellSomeone(channel: (typeof SHARE_CHANNELS)[number]) {
        trackEvent('app-share', { viz: vizId, channel: channel.id });
        window.open(channel.href(APP_PITCH, APP_URL), '_blank', 'noopener,noreferrer');
    }
</script>

<!--
    Hidden from every capture, including its own: the composer skips anything
    carrying this attribute, so the button never ends up in the picture it took.
-->
<svelte:window onpointerdown={onWindowPointerDown} onkeydown={onWindowKeydown} />

<div bind:this={root} class="share" class:floating class:open data-export-hide>
    <button
        bind:this={trigger}
        type="button"
        class="trigger"
        aria-expanded={open}
        aria-haspopup="menu"
        onclick={toggle}
        title="Save this chart as a file"
    >
        <Share2 size={14} aria-hidden="true" />
        <span>Share</span>
    </button>

    {#if open}
        <div class="panel" role="menu">
            {#if busy}
                <div class="running">
                    <Loader2 class="spin" size={15} aria-hidden="true" />
                    <span class="running-label">
                        {busy === 'png' ? 'Rendering…' : 'Recording…'}
                    </span>
                    <button type="button" class="ghost" onclick={reset} title="Cancel">
                        <X size={14} aria-hidden="true" />
                    </button>
                    <div
                        class="bar"
                        role="progressbar"
                        aria-valuemin="0"
                        aria-valuemax="100"
                        aria-valuenow={Math.round(progress * 100)}
                        style={`--done:${Math.round(progress * 100)}%`}
                    ></div>
                </div>
            {:else if copied}
                <div class="done">
                    <p class="copied"><Check size={14} aria-hidden="true" /> Copied</p>
                    <p class="meta">Paste it into a message, a doc, anywhere.</p>
                    <div class="actions">
                        <button type="button" class="row" onclick={reset}>
                            <span>Save a file instead</span>
                        </button>
                    </div>
                    {@render tellRow()}
                </div>
            {:else if result}
                <div class="done">
                    <p class="filename">{result.filename}</p>
                    <p class="meta">Saved · {formatBytes(result.blob.size)}</p>
                    <div class="actions">
                        {#if shareable}
                            <button type="button" class="row primary" onclick={openSheet}>
                                <Share2 size={14} aria-hidden="true" />
                                <span>Share…</span>
                            </button>
                        {/if}
                        <button
                            type="button"
                            class="row"
                            onclick={() => downloadBlob(result!.blob, result!.filename)}
                        >
                            <Download size={14} aria-hidden="true" />
                            <span>Download again</span>
                        </button>
                        <button type="button" class="row" onclick={reset}>
                            <span>Another format</span>
                        </button>
                    </div>
                    {@render tellRow()}
                </div>
            {:else}
                {#each choices as choice (choice.format)}
                    <button
                        type="button"
                        class="row"
                        role="menuitem"
                        onclick={() => run(choice.format)}
                    >
                        <span class="label">{choice.label}</span>
                        <span class="note">{choice.note}</span>
                    </button>
                {/each}
                {#if canCopy}
                    <button type="button" class="row" role="menuitem" onclick={copyImage}>
                        <ClipboardCopy size={14} aria-hidden="true" />
                        <span class="label">Copy image</span>
                        <span class="note">To paste</span>
                    </button>
                {/if}
                <p class="privacy">Rendered here, on your machine.</p>
            {/if}

            {#if error}
                <p class="error">{error}</p>
            {/if}
        </div>
    {/if}
</div>

<!--
    Passing on the app rather than the chart.

    Placed after an export, never instead of one: these channels carry text and
    a link and cannot carry the file, so they are what someone reaches for once
    they already have the picture in hand. The link goes to the front page —
    nothing is persisted, so there is no address for anybody's own listening.
-->
{#snippet tellRow()}
    <div class="tell">
        <p class="tell-label">Tell someone about Buho</p>
        <div class="tell-links">
            {#each SHARE_CHANNELS as channel (channel.id)}
                <button type="button" class="tell-link" onclick={() => tellSomeone(channel)}>
                    {channel.label}
                </button>
            {/each}
        </div>
    </div>
{/snippet}

<style>
    .share {
        position: relative;
        display: inline-flex;
    }

    /* Over the chart's top-right corner, out of the way until wanted. */
    .share.floating {
        position: absolute;
        top: 0.5rem;
        right: 0.5rem;
        z-index: 20;
    }

    /*
       Full strength, always.

       This started life faded until hovered, on the reasoning that a dozen
       guide sections each wearing a button reads as chrome. That was the wrong
       trade: a control nobody notices is a feature nobody uses, and a chart
       leaving this tab with the address painted on it is how anyone else hears
       about Buho at all.
    */
    .trigger {
        display: inline-flex;
        align-items: center;
        gap: 0.35rem;
        border: 1px solid hsl(var(--border));
        background: hsl(var(--card) / 0.92);
        color: hsl(var(--foreground));
        border-radius: var(--radius-pill);
        padding: 0.3rem 0.7rem;
        font-size: var(--text-small);
        line-height: 1.2;
        cursor: pointer;
        backdrop-filter: blur(4px);
        transition:
            color 0.15s,
            border-color 0.15s,
            opacity 0.15s;
    }

    .trigger:hover,
    .trigger[aria-expanded='true'] {
        border-color: hsl(var(--foreground) / 0.5);
        background: hsl(var(--secondary));
    }

    .panel {
        position: absolute;
        top: calc(100% + 0.4rem);
        right: 0;
        z-index: 40;
        /* Wide enough to hold the four channels on one row and to break a file
           name at a hyphen rather than mid-extension. */
        width: 17.5rem;
        padding: 0.35rem;
        border-radius: var(--radius-md);
        border: 1px solid hsl(var(--border));
        background: hsl(var(--popover, var(--card)));
        box-shadow: 0 10px 30px rgb(0 0 0 / 0.35);
    }

    .row {
        display: flex;
        align-items: baseline;
        gap: 0.5rem;
        width: 100%;
        padding: 0.45rem 0.55rem;
        border: none;
        border-radius: var(--radius-sm);
        background: transparent;
        color: hsl(var(--foreground));
        font-size: var(--text-body);
        text-align: left;
        cursor: pointer;
    }

    .row:hover {
        background: hsl(var(--secondary) / 0.6);
    }

    .row.primary {
        color: hsl(var(--primary));
        font-weight: 600;
    }

    .label {
        font-weight: 500;
    }

    .note,
    .meta {
        margin-left: auto;
        font-size: var(--text-label);
        color: hsl(var(--muted-foreground));
    }

    .privacy {
        margin: 0.35rem 0.55rem 0.25rem;
        font-size: var(--text-label);
        line-height: 1.35;
        color: hsl(var(--muted-foreground) / 0.85);
    }

    .running {
        display: grid;
        grid-template-columns: auto 1fr auto;
        align-items: center;
        gap: 0.5rem;
        padding: 0.5rem 0.55rem;
    }

    .running-label {
        font-size: var(--text-small);
        color: hsl(var(--foreground));
    }

    .bar {
        grid-column: 1 / -1;
        height: 3px;
        border-radius: var(--radius-pill);
        background: linear-gradient(
            to right,
            hsl(var(--foreground) / 0.75) var(--done, 0%),
            hsl(var(--border)) var(--done, 0%)
        );
    }

    .ghost {
        border: none;
        background: transparent;
        color: hsl(var(--muted-foreground));
        cursor: pointer;
        padding: 0.1rem;
        line-height: 0;
    }

    .ghost:hover {
        color: hsl(var(--foreground));
    }

    .done {
        padding: 0.5rem 0.55rem 0.35rem;
    }

    .filename {
        margin: 0;
        font-size: var(--text-small);
        /* `break-all` would split ".mp4" across two lines; this breaks at the
           hyphens the name is already made of and only splits a word as a last
           resort. */
        overflow-wrap: anywhere;
        color: hsl(var(--foreground));
    }

    .done .meta {
        margin: 0.15rem 0 0.45rem;
    }

    .actions {
        display: grid;
        gap: 0.1rem;
    }

    .tell {
        margin-top: 0.4rem;
        padding: 0.5rem 0.55rem 0.15rem;
        border-top: 1px solid hsl(var(--border));
    }

    .tell-label {
        margin: 0 0 0.4rem;
        font-size: var(--text-label);
        letter-spacing: 0.02em;
        text-transform: uppercase;
        color: hsl(var(--muted-foreground) / 0.9);
    }

    .tell-links {
        display: flex;
        flex-wrap: wrap;
        gap: 0.3rem;
    }

    .tell-link {
        border: 1px solid hsl(var(--border));
        border-radius: var(--radius-pill);
        background: transparent;
        color: hsl(var(--muted-foreground));
        padding: 0.2rem 0.6rem;
        font-size: var(--text-small);
        cursor: pointer;
        transition:
            color 0.15s,
            border-color 0.15s;
    }

    .tell-link:hover {
        color: hsl(var(--foreground));
        border-color: hsl(var(--foreground) / 0.45);
    }

    .copied {
        display: flex;
        align-items: center;
        gap: 0.35rem;
        margin: 0;
        font-size: var(--text-body);
        font-weight: 600;
        color: hsl(var(--foreground));
    }

    .done .copied + .meta {
        margin: 0.15rem 0 0.45rem;
    }

    .error {
        margin: 0.35rem 0.55rem 0.25rem;
        font-size: var(--text-small);
        line-height: 1.35;
        color: hsl(var(--destructive, 0 70% 60%));
    }

    :global(.share .spin) {
        animation: share-spin 1s linear infinite;
    }

    @keyframes share-spin {
        to {
            transform: rotate(360deg);
        }
    }
</style>
