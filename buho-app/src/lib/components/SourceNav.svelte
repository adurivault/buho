<script lang="ts">
    import { page } from "$app/state";
    import { trackEvent } from "$lib/analytics";

    interface Tab {
        label: string;
        href: string;
    }

    let { tabs, ariaLabel }: { tabs: Tab[]; ariaLabel: string } = $props();

    function isActive(href: string): boolean {
        return page.url.pathname.startsWith(href);
    }
</script>

<nav class="mode-switcher" aria-label={ariaLabel}>
    {#each tabs as tab (tab.href)}
        <a
            href={tab.href}
            class="tab"
            class:active={isActive(tab.href)}
            aria-current={isActive(tab.href) ? "page" : undefined}
            onclick={() =>
                trackEvent("source-nav", { to: tab.label.toLowerCase() })}
        >
            {tab.label}
        </a>
    {/each}
</nav>

<style>
    /* Segmented pill toggle, shared by every source's header. The active-tab
       colour is driven by --source-accent so each source keeps its own hue. */
    .mode-switcher {
        display: inline-flex;
        align-items: center;
        gap: 2px;
        padding: 3px;
        border: 1px solid hsl(var(--border));
        border-radius: 999px;
        background: hsl(var(--secondary) / 0.4);
    }

    .tab {
        padding: 0.25rem 1.1rem;
        border-radius: 999px;
        font-size: 0.875rem;
        color: hsl(var(--muted-foreground));
        text-decoration: none;
        transition:
            color 0.15s,
            background-color 0.15s;
    }

    .tab:hover {
        color: hsl(var(--foreground));
    }

    .tab.active {
        color: var(--source-accent, hsl(var(--foreground)));
        background: color-mix(
            in srgb,
            var(--source-accent, hsl(var(--foreground))) 14%,
            transparent
        );
        font-weight: 600;
    }
</style>
