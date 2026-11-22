<script lang="ts">
    import { resolve } from '$app/paths';
    import Icon from '#lib/components/Icon.svelte';
    import DropZone from '#lib/components/DropZone.svelte';
    import Shot from '#lib/components/Shot.svelte';
    import { DATA_MODULES } from '#lib/data/modules.ts';
    import { MODULE_SHOTS } from '#lib/shots.ts';

    /**
     * The door: the top of the home page.
     *
     * It has been wrong in several directions. It opened on the picker — every
     * service and every waiting time, a worse copy of /sources standing where
     * an explanation should have been. It over-corrected into prose. It
     * settled on one neutral **Start**, which led straight into a decision
     * nobody arriving here is equipped to make. Then on two cards, WhatsApp and
     * "another service", the second of which only led back to that decision.
     *
     * So the drop zone is the action, the same one every page that asks for a
     * file shows, and for anyone with no file yet a single line makes the
     * decision for them: WhatsApp, the only export that exists in two minutes.
     * Every other service is one footer link away.
     *
     * Beside them, the six modules, each as a whole explorer page drawn from
     * the demo, opening its own page. They answer "what does it make of my
     * file" by showing it. Two to a row and three rows, sized by the window's
     * height so all six fit the first screen.
     */
    interface Props {
        /** Straight to the WhatsApp how-to, skipping the picker entirely. */
        onQuickStart: () => void;
    }

    let { onQuickStart }: Props = $props();
</script>

<div class="intro">
    <div class="pitch">
        <h1>Spotify Wrapped on steroids.</h1>
        <!-- One line each: the break is placed rather than left to the wrap. -->
        <p class="tagline">
            <span class="line">For Spotify, but also Google, WhatsApp, Strava, Garmin…</span>
            <span class="line">Dive deeper into your personal data exports.</span>
        </p>

        <div class="drop">
            <DropZone
                surface="onboarding"
                hint="A .zip, a folder or loose files, from any service Buho reads."
            />
        </div>
        <p class="safe">Read in your browser, never uploaded.</p>
        <p class="quick">
            No export yet?
            <button type="button" data-module="messages" onclick={() => onQuickStart()}>
                Start with WhatsApp
            </button>, about two minutes from the phone app.
        </p>
    </div>

    <ul class="tiles">
        {#each DATA_MODULES as module (module.id)}
            <li>
                <a class="tile" data-module={module.id} href={resolve(module.href)}>
                    <span class="picture">
                        <Shot shot={MODULE_SHOTS[module.id].page} />
                    </span>
                    <span class="name">
                        <Icon name={module.icon} size={15} />
                        {module.label}
                    </span>
                </a>
            </li>
        {/each}
    </ul>
</div>

<style>
    /* The headline and the drop zone on the left, the modules on the right.
       Three rows of tiles fit the window's height: the window less the page's
       padding, its brand line and the two gaps between rows, shared by three
       tiles, each a caption under a picture of the page's own proportions. */
    .intro {
        --tile-height: calc((100dvh - 3 * var(--gap-y, 2rem) - 1.75rem - 2.5rem) / 3);
        --tile-width: calc((var(--tile-height) - var(--caption)) * 1224 / 800);
        --caption: 2.5rem;
        display: grid;
        grid-template-columns: minmax(20rem, 1fr) minmax(0, calc(2 * var(--tile-width) + 1.25rem));
        align-items: center;
        gap: clamp(2rem, 4vw, 3.5rem);
    }

    .pitch {
        max-width: 30rem;
    }

    h1 {
        margin: 0;
        font-size: clamp(1.9rem, 4vw, 2.75rem);
        line-height: 1.08;
        text-wrap: balance;
    }

    .tagline {
        margin: 1rem 0 0;
        font-size: var(--text-lede);
        line-height: 1.5;
        color: hsl(var(--muted-foreground));
    }

    .line {
        display: block;
        text-wrap: balance;
    }

    .drop {
        margin-top: clamp(1.25rem, 4vh, 2rem);
    }

    .safe,
    .quick {
        margin: 0.65rem 0 0;
        font-size: var(--text-small);
        color: hsl(var(--muted-foreground));
    }

    /* The fast path, underlined in the colour of the module it fills. */
    .quick button {
        font-weight: 600;
        color: hsl(var(--foreground));
        text-decoration: underline;
        text-decoration-color: var(--module-fill);
        text-decoration-thickness: 2px;
        text-underline-offset: 3px;
        cursor: pointer;
        transition: text-decoration-color 0.15s;
    }

    .quick button:hover {
        text-decoration-color: var(--module-peak);
    }

    .tiles {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 1.25rem;
        margin: 0;
        padding: 0;
        list-style: none;
    }

    .tile {
        display: flex;
        flex-direction: column;
        overflow: hidden;
        border: 1px solid hsl(var(--border));
        border-radius: var(--radius-lg);
        background: hsl(var(--card));
        color: inherit;
        text-decoration: none;
        transition: border-color 0.15s;
    }

    .tile:hover {
        border-color: var(--module-fill);
    }

    /* The page as captured, uncropped: an explorer is as wide as the window
       it was captured in, 1224 by 800. */
    .picture {
        display: block;
        aspect-ratio: 1224 / 800;
        border-bottom: 1px solid hsl(var(--border));
    }

    .name {
        display: flex;
        align-items: center;
        gap: 0.4rem;
        height: var(--caption);
        padding: 0 0.9rem;
        font-size: var(--text-body);
        font-weight: 600;
        color: hsl(var(--heading));
    }

    .name :global(svg) {
        color: var(--module-accent);
    }

    /* Too narrow for the two side by side: the modules under the drop zone. */
    @media (max-width: 959px) {
        .intro {
            grid-template-columns: minmax(0, 1fr);
        }
    }

    @media (max-width: 599px) {
        .tiles {
            grid-template-columns: minmax(0, 1fr);
        }
    }
</style>
