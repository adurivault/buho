<script lang="ts">
    import type { Snippet } from "svelte";

    interface Props {
        open: boolean;
        onClose: () => void;
        title: string;
        /** Source hue, exposed to the content as `--dialog-accent`. */
        accent: string;
        /** When provided, a ← button is rendered next to the title. */
        onBack?: () => void;
        /**
         * Tailwind max-width class. Dialogs that only ask a question stay narrow;
         * one that walks you through an export needs the room.
         */
        maxWidth?: string;
        children: Snippet;
    }

    let {
        open = $bindable(),
        onClose,
        title,
        accent,
        onBack,
        maxWidth = "max-w-lg",
        children,
    }: Props = $props();

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

    function close() {
        open = false;
        onClose();
    }

    function handleKeydown(event: KeyboardEvent) {
        if (event.key === "Escape") close();
    }
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
            class="relative max-h-[85vh] w-full {maxWidth} overflow-y-auto rounded-2xl border border-border bg-background p-7 shadow-2xl sm:p-8"
            style:--dialog-accent={accent}
            role="dialog"
            aria-modal="true"
            aria-label={title}
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

            <div class="flex items-center gap-2 pr-8">
                {#if onBack}
                    <button
                        class="text-muted-foreground transition-colors hover:text-foreground"
                        aria-label="Back"
                        onclick={onBack}
                    >
                        ←
                    </button>
                {/if}
                <h2 class="text-lg font-semibold">{title}</h2>
            </div>

            {@render children()}
        </div>
    </div>
{/if}
