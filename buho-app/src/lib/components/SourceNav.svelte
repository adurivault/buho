<script lang="ts">
    import { page } from '$app/state';

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
            aria-current={isActive(tab.href) ? 'page' : undefined}
        >
            {tab.label}
        </a>
    {/each}
</nav>

<style>
    /* Segmented pill toggle, shared by every source's header. The active-tab
       colour is the module's own (`--module-accent`, from the page's scope). */
    .mode-switcher {
        display: inline-flex;
        align-items: center;
        gap: 2px;
        padding: 3px;
        border: 1px solid hsl(var(--border));
        border-radius: var(--radius-pill);
        background: hsl(var(--secondary) / 0.4);
    }

    .tab {
        padding: 0.25rem 1.1rem;
        border-radius: var(--radius-pill);
        font-size: var(--text-body);
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
        color: var(--module-accent);
        background: var(--module-soft);
        font-weight: 600;
    }

    /* Three tabs and an import control have to share a phone's width. The tabs
       give up their generous side padding rather than a letter of their names,
       and the switcher scrolls rather than pushing the control off the row. */
    @media (max-width: 767px) {
        .mode-switcher {
            max-width: 100%;
            overflow-x: auto;
            scrollbar-width: none;
        }

        .mode-switcher::-webkit-scrollbar {
            display: none;
        }

        .tab {
            padding: 0.25rem 0.6rem;
            font-size: var(--text-small);
            white-space: nowrap;
        }
    }
</style>
