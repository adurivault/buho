<script lang="ts">
  import { page } from "$app/state";
  import { resolve } from "$app/paths";
  import OwlLogo from "./OwlLogo.svelte";
  import { themeStore, toggleTheme } from "$lib/stores/themeStore.svelte";
</script>

<aside class="sidebar">
  <a
    href={resolve("/")}
    class="logo"
    title="Buho — Home"
    class:active={page.url.pathname === resolve("/")}
  >
    <OwlLogo size={24} />
    <span class="sr-only">Home</span>
  </a>

  <nav>
    <ul>
      <li>
        <a
          href={resolve("/spotify/guide")}
          class="nav-link spotify"
          title="Spotify"
          class:active={page.url.pathname.startsWith(resolve("/spotify"))}
        >
          <svg
            class="nav-icon"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <circle cx="12" cy="12" r="10" /><path d="M8 15c2-1 6-1 8 0" /><path
              d="M7 11.5c3-1.5 7-1.5 10 0"
            /><path d="M6 8c4-2 8-2 12 0" />
          </svg>
          <span class="sr-only">Spotify</span>
        </a>
      </li>
      <li>
        <span
          class="nav-link disabled"
          title="Google Maps — coming soon"
          aria-disabled="true"
        >
          <svg
            class="nav-icon"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path
              d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"
            /><circle cx="12" cy="9" r="2.5" />
          </svg>
          <span class="sr-only">Google Maps (coming soon)</span>
        </span>
      </li>
      <li>
        <span
          class="nav-link disabled"
          title="WhatsApp — coming soon"
          aria-disabled="true"
        >
          <svg
            class="nav-icon"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path
              d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"
            />
          </svg>
          <span class="sr-only">WhatsApp (coming soon)</span>
        </span>
      </li>
    </ul>
  </nav>

  <button
    type="button"
    class="theme-toggle"
    onclick={toggleTheme}
    title={themeStore.theme === "dark"
      ? "Switch to light mode"
      : "Switch to dark mode"}
    aria-label="Toggle color theme"
  >
    {#if themeStore.theme === "dark"}
      <!-- Sun: click to go light -->
      <svg
        class="nav-icon"
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <circle cx="12" cy="12" r="4" />
        <path
          d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"
        />
      </svg>
    {:else}
      <!-- Moon: click to go dark -->
      <svg
        class="nav-icon"
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
      </svg>
    {/if}
  </button>
</aside>

<style>
  .sidebar {
    width: 56px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
    padding: 0.75rem 0.5rem;
    border-right: 1px solid hsl(var(--border));
    background-color: hsl(var(--secondary) / 0.25);
    min-height: 100vh;
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border-width: 0;
  }

  .logo {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 40px;
    border-radius: 10px;
    font-size: 1.375rem;
    text-decoration: none;
    transition: background-color 0.15s;
  }

  .logo:hover,
  .logo.active {
    background-color: hsl(var(--accent));
  }

  nav ul {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
  }

  .nav-icon {
    flex-shrink: 0;
  }

  .nav-link {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 40px;
    border-radius: 10px;
    color: hsl(var(--muted-foreground));
    text-decoration: none;
    transition:
      color 0.15s,
      background-color 0.15s;
  }

  a.nav-link:hover {
    color: hsl(var(--foreground));
    background-color: hsl(var(--accent));
  }

  .nav-link.spotify.active {
    color: var(--accent-spotify, #1db954);
    background-color: color-mix(
      in srgb,
      var(--accent-spotify, #1db954) 12%,
      transparent
    );
  }

  .nav-link.disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }

  .theme-toggle {
    margin-top: auto;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 40px;
    border-radius: 10px;
    border: none;
    background: transparent;
    color: hsl(var(--muted-foreground));
    cursor: pointer;
    transition:
      color 0.15s,
      background-color 0.15s;
  }

  .theme-toggle:hover {
    color: hsl(var(--foreground));
    background-color: hsl(var(--accent));
  }

  /* Mobile: fixed bottom bar, only real destinations */
  @media (max-width: 767px) {
    .sidebar {
      width: 100%;
      height: 56px;
      min-height: auto;
      flex-direction: row;
      justify-content: space-around;
      padding: 0.25rem;
      bottom: 0;
      position: fixed;
      z-index: 100;
      border-right: none;
      border-top: 1px solid hsl(var(--border));
      background-color: hsl(var(--background));
    }
    .sidebar nav {
      display: contents;
    }
    .sidebar nav ul {
      display: contents;
    }
    .nav-link.disabled {
      display: none;
    }
    .theme-toggle {
      margin-top: 0;
    }
  }
</style>
