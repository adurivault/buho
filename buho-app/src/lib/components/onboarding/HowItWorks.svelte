<script lang="ts">
    import OwlLogo from '#lib/components/OwlLogo.svelte';
    import { mulberry32 } from '#lib/demo/random.ts';

    /**
     * The whole product, as one moving diagram: a file comes down out of a
     * service, Buho reads it, and it comes back on screen as something you
     * would look at.
     *
     * It is drawn in the owl's register — flat shapes, one stroke weight,
     * `currentColor` — and not in the app's. A faithful miniature of a real
     * chart was the first attempt and it was the wrong instinct twice over: at
     * this size a dense scatter is grey mush, and anything that looks like real
     * output invites the question of whose data it is. A mark promises; a
     * screenshot claims. Only the first one is honest before you have imported
     * anything.
     *
     * Four rules the geometry follows, all learnt the hard way:
     *
     *   - **Downloads go downwards.** The file used to cross the diagram
     *     horizontally and park on the owl's head, where it read as a smudge on
     *     the logo. It now drops out of the cloud and is handed over. There is
     *     no drawn arrow between them: one was tried at several weights and
     *     every version was clutter — the fall itself is the arrow.
     *   - **The three stations sit on the thirds of the viewBox**, because the
     *     prose underneath is a three-column grid of the same width. Any other
     *     width and each station floats over the wrong column.
     *   - **The scan is amber, so that it can come from the eyes.** Rays in
     *     `currentColor` were invisible for their first half: the owl is a
     *     solid light fill and so were they. Starting them at its chin instead
     *     was legible and meaningless — nothing said where the light came
     *     from. Colour solves what geometry could not.
     *   - **Two movements, not four.** One beat delivers (fall, then slide),
     *     one beat reads (scan, then the screen fills). The third only changes
     *     the emphasis.
     */

    interface Props {
        /**
         * Which station is lit, 0–2. Left out, it cycles on its own.
         *
         * The prop is here so the funnel can take the diagram over and advance
         * it one station per step, if the looping version turns out not to hold
         * attention. That is a change of one line at the call site.
         */
        beat?: number;
    }

    let { beat: driven }: Props = $props();

    const STEPS = [
        {
            caption: 'Request your data',
            body: "Spotify, WhatsApp, Google and the others have to give you a copy of what they store about you. It's a form or a button in their settings.",
        },
        {
            caption: 'Open it in Buho',
            body: 'Drop the file here. Buho reads it in your browser: nothing is uploaded, and there is no account.',
        },
        {
            caption: 'Explore',
            body: 'Charts you can filter, search and zoom into, day by day or across ten years.',
        },
    ];

    const HOLD_MS = 2400;

    let cycling = $state(0);
    /** Set once we know the reader would rather nothing moved. */
    let still = $state(false);

    const beat = $derived(driven ?? (still ? STEPS.length - 1 : cycling));

    /**
     * The screen fills while the file is being scanned, not a step later.
     *
     * Waiting for step three made the reading and the result look like two
     * unrelated events; the charts appearing under the scan bar is the whole
     * claim. Step three then only brightens what is already there.
     *
     * It clears again at the top of each loop. Keeping the charts up made the
     * screen the one thing that never reset, so the loop stopped reading as a
     * loop — and an empty screen is no longer a hole in the diagram now that
     * the monitor around it is always drawn.
     */
    const drawn = $derived(beat >= 1);

    $effect(() => {
        if (driven !== undefined) return;

        const query =
            typeof window.matchMedia === 'function'
                ? window.matchMedia('(prefers-reduced-motion: reduce)')
                : null;
        if (query?.matches) {
            // Land on the payoff rather than the empty first station.
            still = true;
            return;
        }

        const timer = setInterval(() => {
            cycling = (cycling + 1) % STEPS.length;
        }, HOLD_MS);
        return () => clearInterval(timer);
    });

    /**
     * The constellation: vertical streaks, not a curve.
     *
     * An earlier version laid its dots along a sine wave, which read as a line
     * chart drawn in dots — the one shape a scatter plot must not have. What
     * the real constellation looks like is columns: one day across, the hours
     * down, and a listening session stacks into a vertical run at a single
     * date. So the mark is runs, plus loose plays so it is not a bar chart.
     *
     * Fixed seed, computed once — a mark that reshuffles between renders is
     * not a mark.
     */
    const DOTS = (() => {
        const random = mulberry32(23);
        const dots: Array<{ cx: number; cy: number }> = [];

        const runs = 7;
        for (let run = 0; run < runs; run += 1) {
            const at = 10 + (run / (runs - 1)) * 36 + (random() - 0.5) * 4;
            const height = 3 + Math.floor(random() * 5);
            // Where the run may start, so that its last dot still lands above
            // the axis. Picking a top independently of the height is what put
            // the tallest runs through the floor.
            const span = (height - 1) * 3.6;
            const top = 10 + random() * (44 - span);
            for (let step = 0; step < height; step += 1) {
                dots.push({
                    cx: at + (random() - 0.5) * 2.2,
                    cy: top + step * 3.6 + (random() - 0.5) * 1.4,
                });
            }
        }

        for (let loose = 0; loose < 11; loose += 1) {
            dots.push({ cx: 9 + random() * 40, cy: 9 + random() * 36 });
        }

        return dots;
    })();

    /**
     * France, and Corsica.
     *
     * Drawn by hand twice before this, and wrong both times — the second
     * attempt read as a rock with a spike on it. Hand-drawing a country is a
     * bad use of anyone's time when the outline is already in the repo, so this
     * comes out of `static/geo/geo_zones.topojson`: 140 departments merged into
     * one outline, projected the way France is normally drawn, and reduced to
     * 61 points. Regenerate with `node scripts/france-path.mjs`.
     */
    const FRANCE =
        'M40.9 27.2 L40.6 28.8 L43.7 27.3 L44.8 29.8 L43.9 30.9 L45.5 32.6 L43.4 34.3 L45.2 36.5 L44.6 38.3 L47.9 39.7 L43.9 44.9 L40.7 45.7 L37.4 43.0 L36.7 44.3 L33.4 43.1 L29.9 45.5 L30.1 49.2 L28.1 49.7 L20.2 46.8 L20.0 47.7 L15.1 47.0 L10.4 43.5 L13.9 36.7 L12.9 36.7 L13.9 27.6 L11.3 26.5 L9.3 20.9 L2.4 18.7 L1.2 17.2 L2.8 17.1 L1.8 16.0 L3.1 15.2 L1.2 15.6 L1.3 14.7 L7.1 13.2 L8.8 15.4 L13.3 15.0 L11.9 8.8 L14.3 9.2 L14.7 11.3 L18.7 11.4 L19.9 10.8 L19.5 9.3 L24.8 6.9 L24.5 3.1 L27.8 1.9 L28.7 3.9 L33.7 6.4 L33.4 8.0 L35.8 6.9 L36.0 8.9 L38.2 10.5 L48.2 12.9 L46.3 20.6 L44.1 21.2 Z ' +
        'M55.5 51.3 L55.0 54.1 L53.4 53.4 L51.9 49.0 L54.8 46.8 L55.1 45.0 Z';

    /** Brittany, Paris, and down to the Mediterranean, in the same projection. */
    const ROUTE = 'M10 18 C 16 15, 22 12, 28 14 C 34 16, 33 25, 38 31 C 42 36, 40 40, 40 44';
    const STOPS = [
        { cx: 10, cy: 18 },
        { cx: 28, cy: 14 },
        { cx: 40, cy: 44 },
    ];
</script>

<div class="how">
    <!-- Decorative: the three steps below carry the same content as text. -->
    <svg viewBox="0 0 340 88" class="diagram" aria-hidden="true">
        <g class="station" class:lit={beat === 0}>
            <!-- The service. A cloud rather than a database cylinder: the
                 cylinder is what an engineer draws, and everyone else reads a
                 cloud as "somewhere out there, not here" — which is exactly the
                 distinction the next two stations are about. -->
            <path
                class="ink"
                d="M43.5 37 A7 7 0 0 1 50 25.5 A10 10 0 0 1 68.5 28 A5.5 5.5 0 0 1 72.5 37 A26 26 0 0 1 43.5 37 Z"
            />
        </g>

        <g class="station" class:lit={beat === 1}>
            <!-- The real mark, not a copy of it: a second owl drawn by hand here
                 would drift from the logo the first time either one is touched. -->
            <OwlLogo x={148} y={4} size={44} />
        </g>

        {#if beat === 1}
            <!-- Reading the file. The rays start on the pupils; the soft cone
                 only exists below the body, where there is dark to spill onto —
                 over the owl it would read as a stain rather than as light. -->
            <g class="scan">
                <polygon class="cone" points="163,48 177,48 181,58 159,58" />
                <path class="ray" d="M164.5 25 L159 58 M175.5 25 L181 58" />
                <path class="bar" d="M162 0 h16" />
            </g>
        {/if}

        <g class="station marks" class:lit={beat === 2} class:drawn>
            <!-- A screen, so the two marks read as output rather than as
                 decoration floating next to an owl. Two bezels: the outer one
                 heavy enough to be furniture, the inner one just enough to say
                 where the glass starts. -->
            <rect class="bezel" x="237" y="2" width="92" height="50" rx="5" />
            <rect class="glass" x="241" y="6" width="84" height="40" rx="2" />
            <path class="bezel" d="M283 52 v6 M271 58 h24" />

            <svg x="244" y="8" width="36" height="36" viewBox="0 0 56 56">
                <path class="axis" d="M6 5 V50 H51" />
                {#each DOTS as dot, index (index)}
                    <circle cx={dot.cx} cy={dot.cy} r="1.3" class="dot" style:--i={index} />
                {/each}
            </svg>

            <svg x="286" y="8" width="36" height="36" viewBox="0 0 56 56">
                <path class="land" d={FRANCE} />
                <path class="route" d={ROUTE} pathLength="100" />
                {#each STOPS as stop, index (index)}
                    <circle cx={stop.cx} cy={stop.cy} r="2.6" class="stop" style:--i={index} />
                {/each}
            </svg>
        </g>

        <!--
            The file itself, and the only thing that travels. One animation, not
            two: it falls, waits, and is handed over. Splitting it across beats
            meant remounting the element mid-journey, which showed up as a blink
            before the slide.
        -->
        {#if beat < 2}
            <g class="parcel">
                <path
                    class="sheet"
                    d="M2 0 h11 l7 7 v17 a2 2 0 0 1 -2 2 h-16 a2 2 0 0 1 -2 -2 V2 a2 2 0 0 1 2 -2 Z"
                />
                <path class="fold" d="M13 0 v5 a2 2 0 0 0 2 2 h5" />
                <!-- Says the format outright, the way a file-type icon does.
                     Abstract squiggles standing in for JSON were unreadable at
                     this size and said nothing at any size. The badge overhangs
                     the sheet's left edge, so it needs an opaque fill to sit on
                     top of the border rather than behind it. -->
                <rect class="badge" x="-1.5" y="13" width="19" height="9" rx="4.5" />
                <text class="label" x="8" y="19.5">JSON</text>
            </g>
        {/if}
    </svg>

    <ol class="steps">
        {#each STEPS as step, index (step.caption)}
            <li class:now={beat === index}>
                <span class="caption">{step.caption}</span>
                <span class="body">{step.body}</span>
            </li>
        {/each}
    </ol>
</div>

<style>
    .how {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 2rem;
        width: 100%;
    }

    /* The diagram and the prose share a width so that each station sits over
       the column that explains it. Changing one without the other is the whole
       of what "it is misaligned" meant. */
    .diagram,
    .steps {
        width: 100%;
        max-width: 46rem;
    }

    .diagram {
        height: auto;
        color: hsl(var(--foreground));
    }

    /* Stations wait their turn quietly rather than disappearing: the reader can
       see the whole mechanism at any instant, and only the emphasis moves. */
    .station {
        opacity: 0.3;
        transition: opacity 0.5s ease;
    }

    /* Three levels, not two: the screen has to come up while it is being filled
       — charts appearing at 30% during the scan is the same as not appearing —
       but it must still have somewhere to go when its own step arrives.
       Equal specificity to `.lit`, so the order of these two rules is what
       makes step three brighter than step two. */
    .station.drawn {
        opacity: 0.72;
    }

    .station.lit {
        opacity: 1;
    }

    /*
     * Not `.outline`.
     *
     * That is a real Tailwind utility, and Tailwind generates whatever class
     * names it finds in the source — so every element carrying it also got a
     * global `outline-width: 1px`, which browsers paint around an SVG element's
     * bounding box. The cylinder came out wearing a rectangle. Any class here
     * that collides with a bare Tailwind utility will do the same thing.
     */
    .ink {
        fill: none;
        stroke: currentColor;
        stroke-width: 1.8;
        stroke-linecap: round;
        stroke-linejoin: round;
    }

    .bezel {
        fill: none;
        stroke: currentColor;
        stroke-width: 2.6;
        stroke-linecap: round;
        stroke-linejoin: round;
    }

    .glass {
        fill: none;
        stroke: currentColor;
        stroke-width: 1.1;
        opacity: 0.4;
    }

    /*
     * Its own colour, and not one of the source accents: those mean "this is
     * Spotify" / "this is Maps" wherever they appear, and a scanning beam that
     * happens to be Google amber would be quietly claiming something.
     *
     * No delay on the reveal — the file has been waiting under the owl since
     * the previous step, so there is nothing to wait for.
     */
    .scan {
        --scan: #f7b32b;
        animation: reveal 0.25s ease both;
    }

    .cone {
        fill: var(--scan);
        opacity: 0.16;
    }

    .ray {
        fill: none;
        stroke: var(--scan);
        stroke-width: 1.5;
        stroke-linecap: round;
        opacity: 0.85;
    }

    .bar {
        fill: none;
        stroke: var(--scan);
        stroke-width: 2.2;
        stroke-linecap: round;
        animation: sweep 0.8s ease-in-out infinite;
    }

    @keyframes reveal {
        from {
            opacity: 0;
        }
        to {
            opacity: 1;
        }
    }

    @keyframes sweep {
        0%,
        100% {
            transform: translateY(60px);
            opacity: 0.45;
        }
        50% {
            transform: translateY(80px);
            opacity: 1;
        }
    }

    .dot,
    .stop {
        fill: currentColor;
    }

    .route {
        fill: none;
        stroke: currentColor;
        stroke-width: 2;
        stroke-linecap: round;
        stroke-linejoin: round;
    }

    /* The screen is there from the start; what is on it is not. Everything
       below waits out the first sweep of the bar (0.8s) so it appears as the
       scan's result, then staggers, which makes it read as a thing being built
       rather than switched on. */
    /* The frame of reference arrives before what is plotted on it — the axes
       and the coastline first, then the data. */
    .marks .axis {
        fill: none;
        stroke: currentColor;
        stroke-width: 1.4;
        stroke-linecap: round;
        stroke-linejoin: round;
        opacity: 0;
        transition: opacity 0.4s ease;
    }

    .marks.drawn .axis {
        opacity: 0.3;
        transition-delay: 0.7s;
    }

    .marks .land {
        fill: currentColor;
        stroke: currentColor;
        stroke-width: 0.9;
        stroke-linejoin: round;
        fill-opacity: 0.16;
        opacity: 0;
        transition: opacity 0.4s ease;
    }

    .marks.drawn .land {
        opacity: 0.5;
        transition-delay: 0.75s;
    }

    .marks .dot,
    .marks .stop {
        opacity: 0;
        transition: opacity 0.3s ease;
    }

    .marks.drawn .dot,
    .marks.drawn .stop {
        opacity: 1;
        transition-delay: calc(850ms + var(--i) * 14ms);
    }

    /* pathLength normalises the curve to 100 units, so the dash maths needs no
       measuring — which would mean getTotalLength(), which jsdom does not have. */
    .marks .route {
        stroke-dasharray: 100;
        stroke-dashoffset: 100;
        /* Drawn slowly on the way in, retracted quickly on the way out: the
           route appearing is the payoff, the loop resetting is housekeeping. */
        transition: stroke-dashoffset 0.35s ease-in;
    }

    .marks.drawn .route {
        stroke-dashoffset: 0;
        transition: stroke-dashoffset 1.1s ease-out 0.95s;
    }

    .parcel {
        transform: translate(160px, 58px);
        animation: deliver 1.5s both;
    }

    .sheet {
        fill: hsl(var(--background));
        stroke: currentColor;
        stroke-width: 1.8;
        stroke-linejoin: round;
    }

    .fold {
        fill: none;
        stroke: currentColor;
        stroke-width: 1.4;
        stroke-linecap: round;
        stroke-linejoin: round;
    }

    .badge {
        fill: hsl(var(--background));
        stroke: currentColor;
        stroke-width: 1.3;
    }

    .label {
        fill: currentColor;
        /* system-ui rather than a repo token: this paints inside an SVG on the
           first frame, and a webfont that has not arrived yet would reflow the
           one word the whole glyph exists to say. */
        font-family: system-ui, sans-serif;
        font-size: 5.6px;
        font-weight: 700;
        letter-spacing: -0.15px;
        text-anchor: middle;
    }

    /* Fall, hold, hand over. Each segment carries its own easing — a single
       timing function across the whole thing turns the hold into a drift. */
    @keyframes deliver {
        0% {
            transform: translate(47px, 34px);
            opacity: 0;
            animation-timing-function: cubic-bezier(0.4, 0, 0.6, 1);
        }
        18% {
            transform: translate(47px, 58px);
            opacity: 1;
            animation-timing-function: linear;
        }
        40% {
            transform: translate(47px, 58px);
            animation-timing-function: cubic-bezier(0.5, 0, 0.25, 1);
        }
        100% {
            transform: translate(160px, 58px);
            opacity: 1;
        }
    }

    .steps {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 1.75rem;
        margin: 0;
        padding: 0;
        list-style: none;
        text-align: left;
    }

    .steps li {
        display: flex;
        flex-direction: column;
        gap: 0.3rem;
        opacity: 0.5;
        transition: opacity 0.4s ease;
    }

    .steps li.now {
        opacity: 1;
    }

    .caption {
        font-weight: 600;
        font-size: var(--text-body);
        color: hsl(var(--foreground));
    }

    .body {
        font-size: var(--text-small);
        line-height: 1.6;
        color: hsl(var(--muted-foreground));
    }

    @media (max-width: 640px) {
        .steps {
            grid-template-columns: 1fr;
            gap: 1.25rem;
            max-width: 30rem;
        }
    }

    @media (prefers-reduced-motion: reduce) {
        .station,
        .scan,
        .parcel,
        .bar,
        .marks .axis,
        .marks .land,
        .marks .dot,
        .marks .stop,
        .marks .route,
        .steps li {
            transition: none;
            animation: none;
        }
    }
</style>
