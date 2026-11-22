<script lang="ts">
    import type { Snippet } from 'svelte';
    import { openModal, closeModal } from '#lib/stores/uiStore.svelte.ts';

    /**
     * The panel-over-a-dimmed-page shell every dialog shares.
     *
     * Written once because the parts that are easy to forget are the ones that
     * matter: escaping any ancestor with a filter on it (a `position: fixed`
     * child of a `backdrop-filter` element is contained by it, not by the
     * viewport), closing on Escape and on the backdrop, and telling the
     * window-wide drop overlay to stand down — a full-screen drop target
     * painting over an open dialog is the app talking over itself.
     */
    interface Props {
        open: boolean;
        onClose: () => void;
        /** The dialog's accessible name. */
        label: string;
        /** Panel width, as a Tailwind max-width class. */
        width?: string;
        children: Snippet;
    }

    let { open = $bindable(), onClose, label, width = 'max-w-md', children }: Props = $props();

    function close() {
        open = false;
        onClose();
    }

    function handleKeydown(event: KeyboardEvent) {
        if (event.key === 'Escape') close();
    }

    function portal(node: HTMLElement) {
        document.body.appendChild(node);
        return {
            destroy() {
                node.remove();
            },
        };
    }

    $effect(() => {
        if (!open) return;
        openModal();
        return closeModal;
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
            class="relative max-h-[85vh] w-full {width} overflow-y-auto rounded-xl border border-border bg-background p-7 shadow-2xl"
            role="dialog"
            aria-modal="true"
            aria-label={label}
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

            {@render children()}
        </div>
    </div>
{/if}
