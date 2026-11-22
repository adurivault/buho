<script lang="ts">
    import HowItWorks from '#lib/components/onboarding/HowItWorks.svelte';

    /**
     * The door.
     *
     * It has been wrong in three directions now. It opened on the picker — every
     * service and every waiting time, a worse copy of /sources standing where an
     * explanation should have been. It over-corrected into prose. Then it settled
     * on one neutral **Start**, which was honest and led straight into a decision
     * nobody arriving here is equipped to make.
     *
     * So the door makes the decision instead. One button does the thing —
     * WhatsApp, the only export that exists in two minutes — and one button says
     * there is more than that. Naming a service up front is the point: "Start"
     * promised nothing, and the visitor had to spend the next screen working out
     * which of the services was cheap to try.
     *
     * The list of every service Buho reads used to sit under the button. It is
     * gone on purpose: it is a menu, and this is not the moment for one. The
     * second button and the footer link both lead to it.
     */
    interface Props {
        /** Straight to the WhatsApp how-to, skipping the picker entirely. */
        onQuickStart: () => void;
        /** The picker, for anyone who came for something else. */
        onBrowse: () => void;
        onSkip: () => void;
    }

    let { onQuickStart, onBrowse, onSkip }: Props = $props();
</script>

<div class="intro">
    <h1>Spotify Wrapped on steroids.</h1>
    <!-- One line each: the break is placed rather than left to the wrap. -->
    <p class="tagline">
        <span class="line">For Spotify, but also Google, WhatsApp, Strava, Garmin…</span>
        <span class="line">Dive deeper into your personal data exports.</span>
    </p>

    <!-- The three sentences that used to sit here are now the diagram's own,
         one per station: naming what a service keeps only described the first
         step, and the other two were left to a caption each. -->
    <div class="diagram">
        <HowItWorks />
    </div>

    <div class="doors">
        <button class="start" onclick={() => onQuickStart()}> Quick start with WhatsApp </button>
        <button class="browse" onclick={() => onBrowse()}> Explore other services </button>
    </div>

    <!-- Why one service is singled out, in one line. Without it the pair of
         buttons looks like a preference; with it, it is a shortcut. -->
    <p class="aside">
        The WhatsApp export takes about two minutes, from the phone app. The others answer a request
        in their own time.
    </p>

    <p class="skip">
        <button onclick={() => onSkip()}>I already have an export →</button>
    </p>
</div>

<style>
    .intro {
        display: flex;
        flex-direction: column;
        align-items: center;
        /* Wide enough for the diagram's three columns of prose to breathe;
           the headline sets its own, narrower measure. */
        max-width: 52rem;
        margin: 0 auto;
        text-align: center;
    }

    h1 {
        margin: 0;
        font-size: clamp(1.9rem, 5vw, 2.75rem);
        line-height: 1.1;
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

    .diagram {
        display: flex;
        justify-content: center;
        width: 100%;
        margin-top: 2.75rem;
    }

    .doors {
        display: flex;
        flex-wrap: wrap;
        justify-content: center;
        gap: 0.75rem;
        margin-top: 3rem;
    }

    .start,
    .browse {
        padding: 0.7rem 1.75rem;
        border-radius: var(--radius-pill);
        font-size: var(--text-lede);
        font-weight: 600;
        cursor: pointer;
        transition:
            opacity 0.15s,
            border-color 0.15s;
    }

    .start {
        background: hsl(var(--primary));
        color: hsl(var(--background));
    }

    .start:hover {
        opacity: 0.9;
    }

    .browse {
        border: 1px solid hsl(var(--border));
        color: hsl(var(--foreground));
    }

    .browse:hover {
        border-color: hsl(var(--foreground) / 0.45);
    }

    .aside {
        max-width: 34rem;
        margin: 1.25rem 0 0;
        font-size: var(--text-small);
        line-height: 1.6;
        color: hsl(var(--muted-foreground));
    }

    .skip {
        margin: 1.25rem 0 0;
    }

    .skip button {
        font-size: var(--text-small);
        color: hsl(var(--muted-foreground));
        text-decoration: underline;
        text-underline-offset: 4px;
        cursor: pointer;
        transition: color 0.15s;
    }

    .skip button:hover {
        color: hsl(var(--foreground));
    }
</style>
