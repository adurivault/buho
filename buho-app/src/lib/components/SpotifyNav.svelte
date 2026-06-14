<script lang="ts">
  import { page } from "$app/state";
  import { resolve } from "$app/paths";

  const tabs = [
    { label: "Guide", href: resolve("/spotify/guide") },
    { label: "Explore", href: resolve("/spotify/explore") },
  ];

  function isActive(href: string): boolean {
    return page.url.pathname.startsWith(href);
  }
</script>

<nav class="mode-switcher" aria-label="Spotify views">
  {#each tabs as tab (tab.href)}
    <a
      href={tab.href}
      class="tab"
      class:active={isActive(tab.href)}
      aria-current={isActive(tab.href) ? "page" : undefined}
    >
      {tab.label}
    </a>
  {/each}
</nav>

<style>
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
    color: var(--accent-spotify, #1db954);
    background: color-mix(
      in srgb,
      var(--accent-spotify, #1db954) 14%,
      transparent
    );
    font-weight: 600;
  }
</style>
