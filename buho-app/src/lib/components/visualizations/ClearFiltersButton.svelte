<script lang="ts">
    /** Drops every filter an Explorer holds; the page shows it only while one is set. */
    interface Props {
        onclick: () => void;
    }

    let { onclick }: Props = $props();
</script>

<button class="clear-filters" type="button" {onclick}>Clear all filters</button>

<style>
    .clear-filters {
        flex: none;
        white-space: nowrap;
        border: 1px solid hsl(var(--border));
        border-radius: var(--radius-pill);
        padding: 0.45rem 0.85rem;
        font-size: var(--text-body);
        transition:
            border-color 0.18s ease,
            color 0.18s ease,
            background-color 0.18s ease;
        cursor: pointer;
        color: hsl(var(--muted-foreground));
        background: transparent;
    }

    .clear-filters:hover {
        border-color: var(--module-accent);
        color: var(--module-accent);
        background: var(--module-soft);
    }
</style>
