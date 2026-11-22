<script lang="ts">
    import { page } from '$app/state';
    import { resolve } from '$app/paths';
    import OwlLogo from './OwlLogo.svelte';
    import Icon from './Icon.svelte';
    import { themeStore, toggleTheme } from '#lib/stores/themeStore.svelte.ts';
    import { dataStore } from '#lib/stores/dataStore.svelte.ts';
    import { DATA_MODULES, type ModuleId } from '#lib/data/modules.ts';
    import { sourcesFilling } from '#lib/data/sources/catalog.ts';
    import { SOURCE_HREF } from '#lib/repo.ts';

    /**
     * "Steps — from Garmin Connect", "Positions — from Google Timeline or Garmin
     * Connect".
     *
     * The rail is icons, so this tooltip and the screen-reader name are the only
     * words a module gets here. They used to come from a hand-written `navLabel`
     * that named the *service* for some modules and the dataset for others; the
     * dataset is now the name everywhere — matching the header and the /sources
     * column — and the services are read off the catalogue, which already knows
     * that one Garmin export fills three of these.
     */
    function feeders(id: ModuleId): string {
        const labels = sourcesFilling(id).map((source) => source.label);
        if (labels.length === 0) return '';
        const last = labels.pop() as string;
        return labels.length ? `${labels.join(', ')} or ${last}` : last;
    }
</script>

<aside class="sidebar">
    <a
        href={resolve('/')}
        class="logo"
        title="Buho — Home"
        class:active={page.url.pathname === resolve('/')}
    >
        <OwlLogo size={24} />
        <span class="sr-only">Home</span>
    </a>

    <!-- Above the modules and apart from them: the calendar holds no data of its
         own, it lays every module on the same days. -->
    <a
        href={resolve('calendar')}
        class="calendar"
        title="Calendar — every module, day by day"
        class:active={page.url.pathname.startsWith(resolve('calendar'))}
    >
        <Icon name="calendar" />
        <span class="sr-only">Calendar</span>
    </a>
    <span class="divider" aria-hidden="true"></span>

    <nav>
        <ul>
            {#each DATA_MODULES as module (module.id)}
                {@const loaded = dataStore.loaded[module.id]}
                {@const from = feeders(module.id)}
                <li>
                    <!-- Three states, in rising intensity: grey (nothing imported), the
               module's colour (it holds data), then the colour on its tinted
               pill (you're looking at it). -->
                    <a
                        href={resolve(module.href)}
                        class="nav-link"
                        data-module={module.id}
                        title={loaded
                            ? `${module.label} — from ${from} · data loaded`
                            : `${module.label} — from ${from}`}
                        class:loaded
                        class:active={page.route.id?.startsWith(module.section)}
                    >
                        <Icon name={module.icon} />
                        <span class="sr-only">{module.label}</span>
                    </a>
                </li>
            {/each}
        </ul>
    </nav>

    <a
        href={resolve('sources')}
        class="reference"
        title="Sources & modules — what Buho reads"
        class:active={page.url.pathname.startsWith(resolve('sources'))}
    >
        <!-- A grid: the page is a table of sources against modules. -->
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
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <path d="M3 9h18M9 9v12" />
        </svg>
        <span class="sr-only">Sources</span>
    </a>

    <a
        href={resolve('faq')}
        class="faq"
        title="Frequently asked questions"
        class:active={page.url.pathname.startsWith(resolve('faq'))}
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
            <circle cx="12" cy="12" r="10" />
            <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
            <path d="M12 17h.01" />
        </svg>
        <span class="sr-only">FAQ</span>
    </a>

    <a
        href={SOURCE_HREF}
        class="source"
        title="Source code on GitHub"
        target="_blank"
        rel="noopener noreferrer"
    >
        <svg class="nav-icon" width="20" height="20" viewBox="0 0 16 16" fill="currentColor">
            <path
                d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"
            />
        </svg>
        <span class="sr-only">Source code on GitHub</span>
    </a>

    <button
        type="button"
        class="theme-toggle"
        onclick={toggleTheme}
        title={themeStore.theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        aria-label="Toggle color theme"
    >
        {#if themeStore.theme === 'dark'}
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
        flex-shrink: 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.5rem;
        padding: 0.75rem 0.5rem;
        border-right: 1px solid hsl(var(--border));
        background-color: hsl(var(--secondary) / 0.25);
        width: var(--nav-rail-size);
        min-height: 100dvh;
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
        border-radius: var(--radius-md);
        font-size: var(--text-heading);
        color: hsl(var(--muted-foreground));
        text-decoration: none;
        transition:
            color 0.15s,
            background-color 0.15s;
    }

    .logo:hover,
    .logo.active {
        color: hsl(var(--foreground));
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
        border-radius: var(--radius-md);
        color: hsl(var(--muted-foreground));
        text-decoration: none;
        transition:
            color 0.15s,
            background-color 0.15s;
    }

    /* Each entry is its module's scope (`data-module`), so the states
     below are written once instead of five times over. */

    /* Any entry but the one you're on picks up the neutral pill on hover; the
     active one already has its own tint. */
    .nav-link:not(.active):hover {
        background-color: hsl(var(--accent));
    }

    .nav-link:not(.loaded):not(.active):hover {
        color: hsl(var(--foreground));
    }

    /* Holds data, but isn't the page you're on: the module's colour, with no
     fill — the tint is what sets the active entry apart. Mixing the colour
     halfway back to grey used to do that job, and took it under 3:1. */
    .nav-link.loaded:not(.active) {
        color: var(--module-accent);
    }

    .nav-link.loaded:not(.active):hover {
        background-color: var(--module-soft);
    }

    .nav-link.active {
        color: var(--module-accent);
        background-color: var(--module-soft);
        box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--module-accent) 35%, transparent);
    }

    .divider {
        width: 24px;
        height: 1px;
        margin: 2px 0;
        background: hsl(var(--border));
    }

    .calendar,
    .reference,
    .faq,
    .source,
    .theme-toggle {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 40px;
        height: 40px;
        border-radius: var(--radius-md);
        border: none;
        background: transparent;
        color: hsl(var(--muted-foreground));
        text-decoration: none;
        cursor: pointer;
        transition:
            color 0.15s,
            background-color 0.15s;
    }

    /* Pushed to the bottom with the theme toggle: it's a reference page, not a
     sixth data source. */
    .reference {
        margin-top: auto;
    }

    .calendar:hover,
    .calendar.active,
    .reference:hover,
    .reference.active,
    .faq:hover,
    .faq.active,
    .source:hover,
    .theme-toggle:hover {
        color: hsl(var(--foreground));
        background-color: hsl(var(--accent));
    }

    /* Mobile: fixed bottom bar */
    @media (max-width: 767px) {
        .sidebar {
            width: 100%;
            height: calc(var(--nav-rail-size) + env(safe-area-inset-bottom, 0px));
            min-height: auto;
            flex-direction: row;
            justify-content: space-around;
            /* The extra bottom padding keeps the icons clear of the home indicator. */
            padding: 0.25rem 0.25rem calc(0.25rem + env(safe-area-inset-bottom, 0px));
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
        .divider {
            display: none;
        }
        .reference,
        .faq,
        .source,
        .theme-toggle {
            margin-top: 0;
        }
        /* Ten 40px buttons do not fit across a 390px phone. These three give
           way: the theme already follows the phone's own setting, and the FAQ
           and the source code are at the foot of the landing page. */
        .faq,
        .source,
        .theme-toggle {
            display: none;
        }
    }
</style>
