<script lang="ts">
    import { browser } from '$app/env';
    import { goto } from '$app/navigation';
    import { resolve } from '$app/paths';
    import { page } from '$app/state';
    import OwlLogo from '#lib/components/OwlLogo.svelte';
    import Seo from '#lib/components/Seo.svelte';
    import ImportStatus from '#lib/components/ImportStatus.svelte';
    import DropStep from '#lib/components/onboarding/DropStep.svelte';
    import ExportStep from '#lib/components/onboarding/ExportStep.svelte';
    import FunnelShell from '#lib/components/onboarding/FunnelShell.svelte';
    import HowItWorks from '#lib/components/onboarding/HowItWorks.svelte';
    import ImportedHub from '#lib/components/onboarding/ImportedHub.svelte';
    import Intro from '#lib/components/onboarding/Intro.svelte';
    import SourceChoice from '#lib/components/onboarding/SourceChoice.svelte';
    import HandheldIntro from '#lib/components/handheld/HandheldIntro.svelte';
    import { dataStore } from '#lib/stores/dataStore.svelte.ts';
    import { deviceStore, exploreAnyway } from '#lib/stores/deviceStore.svelte.ts';
    import { FEEDBACK_EMAIL, FEEDBACK_HREF } from '#lib/feedback.ts';
    import { SOURCE_HREF } from '#lib/repo.ts';
    import { CATALOG_SOURCES, type CatalogSource } from '#lib/data/sources/catalog.ts';
    import {
        queryForStep,
        quickStartSource,
        stepFromUrl,
        type FunnelStep,
    } from '#lib/onboarding/funnel.ts';
    import { trackEvent } from '#lib/analytics.ts';
    import { SITE_URL } from '#lib/seo.ts';

    /**
     * The way in: three steps from never having heard of an export to looking at
     * your own data.
     *
     * The page it replaced was a grid of cards with no upload on it at all, each
     * one linking to an explorer that, with nothing imported, could only tell you
     * to go and find a control in a header you had not noticed. The instructions
     * for getting an export existed and were good, but sat behind a page, a pill,
     * a dialog and a closed accordion. This puts the same words on the path
     * somebody is already walking.
     *
     * Which step is showing lives in the URL, so `/?source=whatsapp` can be sent
     * to someone as their starting point and Back walks the funnel backwards.
     * Nothing else is remembered, here or anywhere: a visitor with no data is a
     * visitor at step one, and that is the only "have we met" this app has.
     */
    /**
     * The prerendered document is always the door.
     *
     * A static file cannot vary by query string — SvelteKit throws on
     * `searchParams` during prerender for exactly that reason — so the server
     * renders step one and hydration corrects a `?source=` link on arrival.
     * Which is the right document to have on disk anyway: the intro is what a
     * crawler, and anyone typing the bare address, is asking for.
     */
    const step = $derived<FunnelStep>(browser ? stepFromUrl(page.url) : { kind: 'intro' });

    /**
     * The inventory, not `dataStore.loaded`: the demo listening data sets
     * `loaded.listening` without anyone having imported anything, and somebody who
     * has only seen the sample still needs the funnel.
     */
    const hasOwnData = $derived(dataStore.inventory.length > 0);

    /**
     * The desktop door: a first screen of its own, with how Buho works on the
     * screen under it. The other steps are one short screen each.
     */
    const door = $derived(!hasOwnData && step.kind === 'intro' && !deviceStore.showcase);

    /**
     * What Buho is, in the vocabulary a machine reads.
     *
     * Constant, so it sits outside the funnel's state: the answer to "what is
     * this application" does not change with which step is on screen. `price: 0`
     * with no `priceCurrency` is how schema.org spells free, and it is worth
     * spelling — along with the browser-only claim — because those are the two
     * facts anyone comparing tools in this space is actually filtering on.
     */
    const landingLd = {
        '@context': 'https://schema.org',
        '@type': 'SoftwareApplication',
        name: 'Buho',
        url: SITE_URL,
        applicationCategory: 'UtilitiesApplication',
        operatingSystem: 'Any modern web browser',
        description:
            'Buho reads personal-data exports (Spotify, Last.fm, Deezer, Google Timeline, Google Activity, Garmin, Strava, WhatsApp, Messenger, Instagram) and charts them entirely in the browser. No account, no upload, no storage.',
        offers: { '@type': 'Offer', price: 0, priceCurrency: 'EUR' },
        featureList: CATALOG_SOURCES.map((source) => `Reads ${source.label} exports`),
    };

    function go(next: FunnelStep) {
        // Resolved: the base path comes from `resolve('/')`, only the query is appended.
        // eslint-disable-next-line svelte/no-navigation-without-resolve
        void goto(`${resolve('/')}${queryForStep(next)}`, { reset: false });
    }

    function pick(source: CatalogSource) {
        go({ kind: 'export', source });
    }

    /** Keeps the source in the URL, so the rail can lead back to its how-to. */
    function toDrop(source?: CatalogSource) {
        go({ kind: 'drop', source });
    }

    /** On a phone, the desktop door, for whoever asks for it. */
    function desktopDoor() {
        trackEvent('explore-anyway', { surface: 'intro' });
        exploreAnyway();
    }

    function toPick() {
        go({ kind: 'pick' });
    }

    function onRail(kind: FunnelStep['kind']) {
        if (kind === 'pick') toPick();
        // Step two is only a destination when we know which export it is about;
        // arriving at step three by the shortcut, there is nothing to go back to
        // but the choice itself.
        else if (kind === 'export' && step.kind === 'drop' && step.source) pick(step.source);
        else if (kind === 'export') toPick();
    }

    /**
     * One event per step actually entered.
     *
     * Deliberately a plain variable rather than `$state`: it is a memo of what
     * has already been reported, and making it reactive would put a write to a
     * dependency inside the effect that reads it. Re-renders staying silent
     * matters — `analytics.ts` caps events per page load, and the funnel is one
     * page that never reloads.
     */
    let announced: string | null = null;
    $effect(() => {
        const source = step.kind === 'export' || step.kind === 'drop' ? step.source : undefined;
        const key = `${step.kind}:${source?.id ?? ''}`;
        if (announced === key) return;
        announced = key;
        trackEvent('funnel-step', { step: step.kind, service: source?.id ?? 'none' });
    });
</script>

<Seo
    title="Buho — visualize your Spotify, Google, WhatsApp and Garmin exports"
    description="Drop an export from a service you already use and explore your listening, locations, messages, activity and steps. Everything is read and charted in your browser: nothing is uploaded, and nothing is stored."
    jsonLd={landingLd}
/>

<div class="page">
    <ImportStatus />

    <div class="column" class:wide={door}>
        <div class="screen" class:first={door}>
            <header class="brand">
                <OwlLogo size={26} />
                <span>Buho</span>
            </header>

            {#if hasOwnData}
                <ImportedHub onAddMore={() => toDrop()} />
            {:else if step.kind === 'intro' && deviceStore.showcase}
                <!-- On a phone the door shows what Buho draws, gets an export
                     started, and hands the visit over to a computer. -->
                <HandheldIntro onPick={pick} onBrowse={toPick} onExploreAnyway={desktopDoor} />
            {:else if step.kind === 'intro'}
                <!-- The door skips step one for the export that needs no deciding:
                     straight to the WhatsApp how-to, with the picker as the other
                     door for anyone who came for something else. -->
                <Intro onQuickStart={() => pick(quickStartSource())} onBrowse={toPick} />
            {:else if step.kind === 'pick'}
                <FunnelShell
                    {step}
                    onStep={onRail}
                    title="Pick where to start"
                    subtitle="Each of these hands you a file holding your own history. What separates them is how long it takes to arrive, and whether you have to ask for it."
                >
                    <SourceChoice onPick={pick} onSkip={() => toDrop()} />
                </FunnelShell>
            {:else if step.kind === 'export'}
                <FunnelShell
                    {step}
                    onStep={onRail}
                    title="Get your {step.source.label} export"
                    subtitle={step.source.request}
                >
                    <ExportStep
                        source={step.source}
                        onNext={() => toDrop(step.kind === 'export' ? step.source : undefined)}
                        onBack={toPick}
                    />
                </FunnelShell>
            {:else}
                <FunnelShell
                    {step}
                    onStep={onRail}
                    title={step.kind === 'drop' && step.source
                        ? `Drop your ${step.source.label} export in`
                        : 'Hand it over'}
                    subtitle="Whatever you have: one file, a folder, a zip you never
                        unpacked. Buho reads it here and works out the rest."
                >
                    <DropStep expected={step.kind === 'drop' ? step.source?.id : undefined} />
                </FunnelShell>
            {/if}
        </div>

        {#if door}
            <section id="how-it-works" class="how-it-works" aria-labelledby="how-it-works-title">
                <h2 id="how-it-works-title">How it works</h2>
                <HowItWorks />
            </section>
        {/if}

        <!-- Takes the height the step leaves, so the footer sits at the foot of
             a short page, and never less than the gap above it. -->
        <div class="spacer" aria-hidden="true"></div>

        <footer>
            <a href={resolve('sources')}>Every export Buho reads, and what it takes from each →</a>
            <a href={resolve('faq')}>Is my data uploaded? And other questions →</a>
            <a href={SOURCE_HREF}>Open source: read the code on GitHub →</a>
            <a href={FEEDBACK_HREF}>Something to say? {FEEDBACK_EMAIL}</a>
        </footer>
    </div>
</div>

<style>
    /* One screen when the content allows it: the column fills the height, the
       footer sits at its foot, and the vertical spacing follows the window, so
       a step that nearly fits does fit instead of scrolling by a few pixels. */
    .page {
        --gap-y: clamp(1.25rem, 4vh, 3rem);
        display: flex;
        flex-direction: column;
        min-height: 100%;
        background: hsl(var(--background));
        color: hsl(var(--foreground));
    }

    .column {
        display: flex;
        flex: 1;
        flex-direction: column;
        width: 100%;
        max-width: 60rem;
        margin: 0 auto;
        padding: var(--gap-y) 1.5rem clamp(1rem, 3vh, 2rem);
    }

    /* The door is wider than a funnel step: the modules sit beside it. */
    .wide {
        max-width: 72rem;
    }

    .screen {
        display: flex;
        flex-direction: column;
    }

    /* Exactly one window tall, the column's top padding included, so the cue
       at its foot is the last thing above the fold. */
    .first {
        min-height: calc(100dvh - var(--gap-y));
        padding-bottom: clamp(0.75rem, 2.5vh, 1.5rem);
    }

    .how-it-works {
        display: flex;
        flex-direction: column;
        align-items: center;
        padding-top: calc(var(--gap-y) * 2);
        scroll-margin-top: var(--gap-y);
    }

    .how-it-works h2 {
        margin: 0 0 var(--gap-y);
        font-size: var(--text-heading);
    }

    .spacer {
        flex: 1;
        min-height: var(--gap-y);
    }

    .brand {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        margin-bottom: var(--gap-y);
        font-family: var(--font-display);
        font-size: var(--text-subheading);
        font-weight: 600;
        color: hsl(var(--heading));
    }

    footer {
        display: flex;
        flex-wrap: wrap;
        justify-content: space-between;
        gap: 1rem;
        padding-top: 1.25rem;
        border-top: 1px solid hsl(var(--border));
        font-size: var(--text-small);
    }

    footer a {
        color: hsl(var(--muted-foreground));
        transition: color 0.15s;
    }

    footer a:hover {
        color: hsl(var(--foreground));
    }
</style>
