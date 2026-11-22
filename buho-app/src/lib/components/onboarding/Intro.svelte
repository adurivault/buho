<script lang="ts">
    import { resolve } from '$app/paths';
    import Icon from '#lib/components/Icon.svelte';
    import DropZone from '#lib/components/DropZone.svelte';
    import ModulePreview from '#lib/components/ModulePreview.svelte';
    import { DATA_MODULES } from '#lib/data/modules.ts';
    import { sourcesFilling } from '#lib/data/sources/catalog.ts';

    /**
     * The door: the first screen of the home page.
     *
     * It has been wrong in three directions now. It opened on the picker — every
     * service and every waiting time, a worse copy of /sources standing where an
     * explanation should have been. It over-corrected into prose. Then it settled
     * on one neutral **Start**, which was honest and led straight into a decision
     * nobody arriving here is equipped to make.
     *
     * So the door makes the decision instead. One card does the thing —
     * WhatsApp, the only export that exists in two minutes — and one says there
     * is more than that. Naming a service up front is the point: "Start"
     * promised nothing, and the visitor had to spend the next screen working out
     * which of the services was cheap to try. Whoever already has a file drops
     * it on the line under them, without a detour through the funnel.
     *
     * Beside them, the six modules as the demo draws them, each naming the
     * exports that fill it and opening its own page. They answer "what does it
     * make of my file" by showing it; they are not a menu of services to choose
     * from, which is the picker's job. How Buho works, the diagram, is the next
     * screen down.
     */
    interface Props {
        /** Straight to the WhatsApp how-to, skipping the picker entirely. */
        onQuickStart: () => void;
        /** The picker, for anyone who came for something else. */
        onBrowse: () => void;
    }

    let { onQuickStart, onBrowse }: Props = $props();

    const tiles = DATA_MODULES.map((module) => ({
        module,
        feeds: sourcesFilling(module.id)
            .map((source) => source.label)
            .join(' · '),
    }));
</script>

<div class="intro">
    <div class="hero">
        <div class="pitch">
            <h1>Spotify Wrapped on steroids.</h1>
            <!-- One line each: the break is placed rather than left to the wrap. -->
            <p class="tagline">
                <span class="line">For Spotify, but also Google, WhatsApp, Strava, Garmin…</span>
                <span class="line">Dive deeper into your personal data exports.</span>
            </p>

            <div class="doors">
                <button class="door" data-module="messages" onclick={() => onQuickStart()}>
                    <span class="door-title">
                        <Icon name="message" size={16} />
                        Start with WhatsApp
                        <span class="arrow" aria-hidden="true">→</span>
                    </span>
                    <span class="door-hint">About two minutes, from the phone app.</span>
                </button>
                <button class="door" onclick={() => onBrowse()}>
                    <span class="door-title">
                        Another service
                        <span class="arrow" aria-hidden="true">→</span>
                    </span>
                    <span class="door-hint">Spotify, Google, Garmin, Strava…</span>
                </button>
            </div>

            <div class="drop">
                <DropZone
                    surface="onboarding"
                    compact
                    title="Already have an export?"
                    pickTitle="Already have an export?"
                    hint="Drop it here, or anywhere on the page."
                />
            </div>
            <p class="safe">Read in your browser, never uploaded.</p>
        </div>

        <div class="modules">
            <ul class="tiles">
                {#each tiles as { module, feeds } (module.id)}
                    <li>
                        <a class="tile" data-module={module.id} href={resolve(module.href)}>
                            <span class="picture">
                                <ModulePreview {module} variant="tile" />
                            </span>
                            <span class="caption">
                                <span class="name">
                                    <Icon name={module.icon} size={15} />
                                    {module.label}
                                </span>
                                <span class="feeds">{feeds}</span>
                            </span>
                        </a>
                    </li>
                {/each}
            </ul>
            <p class="demo-note">Charts drawn from demo data.</p>
        </div>
    </div>

    <a class="cue" href="#how-it-works">How it works ↓</a>
</div>

<style>
    /* Fills the first screen the page gives it: the hero in the middle of the
       height, the cue to the next screen at its foot. */
    .intro {
        display: flex;
        flex: 1;
        flex-direction: column;
    }

    .hero {
        display: grid;
        flex: 1;
        grid-template-columns: minmax(0, 27rem) minmax(0, 1fr);
        align-items: center;
        gap: clamp(2rem, 4vw, 3.5rem);
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

    .doors {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 0.65rem;
        margin-top: clamp(1.25rem, 4vh, 1.75rem);
    }

    .door {
        display: flex;
        flex-direction: column;
        gap: 0.2rem;
        padding: 0.8rem 0.95rem 0.85rem;
        border: 1px solid hsl(var(--border));
        border-radius: var(--radius-lg);
        background: hsl(var(--card));
        text-align: left;
        cursor: pointer;
        transition: border-color 0.15s;
    }

    .door:hover {
        border-color: hsl(var(--foreground) / 0.45);
    }

    /* The fast path wears the colour of the module it fills. */
    .door[data-module] {
        border-color: var(--module-fill);
        background: var(--module-soft);
    }

    .door[data-module]:hover {
        border-color: var(--module-peak);
    }

    .door-title {
        display: flex;
        align-items: center;
        gap: 0.45rem;
        font-size: var(--text-body);
        font-weight: 600;
        color: hsl(var(--heading));
    }

    .door-title :global(svg) {
        flex: none;
        color: var(--module-accent);
    }

    .arrow {
        margin-left: auto;
        font-weight: 400;
        color: hsl(var(--muted-foreground));
    }

    .door-hint {
        font-size: var(--text-small);
        line-height: 1.4;
        color: hsl(var(--muted-foreground));
    }

    .drop {
        margin-top: clamp(1rem, 3vh, 1.5rem);
    }

    .safe {
        margin: 0.65rem 0 0;
        font-size: var(--text-small);
        color: hsl(var(--muted-foreground));
    }

    .tiles {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 0.85rem;
        margin: 0;
        padding: 0;
        list-style: none;
    }

    .tile {
        display: flex;
        flex-direction: column;
        height: 100%;
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

    /* The picture gives way first when the window is short. */
    .picture {
        display: block;
        height: clamp(4.5rem, 14vh, 7.25rem);
        border-bottom: 1px solid hsl(var(--border));
    }

    .caption {
        display: flex;
        flex-direction: column;
        gap: 0.1rem;
        padding: 0.55rem 0.75rem 0.65rem;
    }

    .name {
        display: inline-flex;
        align-items: center;
        gap: 0.4rem;
        font-size: var(--text-body);
        font-weight: 600;
        color: hsl(var(--heading));
    }

    .name :global(svg) {
        color: var(--module-accent);
    }

    .feeds {
        font-size: var(--text-label);
        line-height: 1.4;
        color: hsl(var(--muted-foreground));
    }

    .demo-note {
        margin: 0.6rem 0 0;
        font-size: var(--text-label);
        color: hsl(var(--muted-foreground));
        text-align: right;
    }

    .cue {
        align-self: center;
        margin-top: var(--gap-y, 1.5rem);
        font-size: var(--text-small);
        font-weight: 550;
        color: hsl(var(--foreground));
        text-decoration: none;
    }

    .cue:hover {
        text-decoration: underline;
        text-underline-offset: 4px;
    }

    /* Too narrow for the two side by side: the door first, the modules under
       it. */
    @media (max-width: 959px) {
        .hero {
            grid-template-columns: minmax(0, 1fr);
        }

        .pitch {
            max-width: 34rem;
        }
    }

    @media (max-width: 599px) {
        .tiles {
            grid-template-columns: repeat(2, minmax(0, 1fr));
        }
    }
</style>
