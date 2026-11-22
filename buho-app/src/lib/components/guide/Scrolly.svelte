<script lang="ts">
    import type { Snippet } from 'svelte';
    import { onMount } from 'svelte';

    /**
     * A scroll-driven walkthrough: one graphic pinned in place while short steps
     * of narration scroll past it. Whichever step is closest to the middle of the
     * viewport is the active one, so the graphic changes as the reader advances.
     *
     * The step list is fixed for the component's lifetime — observers are wired
     * once on mount.
     */
    interface Props {
        /** One snippet per step of narration, in reading order. */
        steps: Snippet[];
        /** The pinned graphic. Read `activeStep` from the parent to drive it. */
        graphic: Snippet;
        /** Index of the step currently being read. */
        activeStep?: number;
        label?: string;
    }

    let {
        steps,
        graphic,
        activeStep = $bindable(0),
        label = 'Guided walkthrough',
    }: Props = $props();

    /* A thin band across the middle of the viewport: a step is "being read" while
       it crosses the reader's eye line, not merely while it is on screen. */
    const TRIGGER_BAND = '-45% 0px -45% 0px';

    let stepNodes: HTMLElement[] = [];

    /* Without an IntersectionObserver there is no scroll position to react to, so
       every step is shown at once and the graphic settles on its final state. */
    let scrollDriven = $state(true);

    function distanceToCentre(index: number): number {
        const node = stepNodes[index];
        if (!node) return Number.POSITIVE_INFINITY;
        const rect = node.getBoundingClientRect();
        return Math.abs(rect.top + rect.height / 2 - window.innerHeight / 2);
    }

    onMount(() => {
        if (typeof IntersectionObserver === 'undefined') {
            scrollDriven = false;
            activeStep = Math.max(0, steps.length - 1);
            return;
        }

        const inBand = new Set<number>();
        const observer = new IntersectionObserver(
            (entries) => {
                for (const entry of entries) {
                    const index = stepNodes.indexOf(entry.target as HTMLElement);
                    if (index < 0) continue;
                    if (entry.isIntersecting) inBand.add(index);
                    else inBand.delete(index);
                }
                // Between two steps, the last one read stays active rather than
                // flickering back to the top of the act.
                if (inBand.size === 0) return;
                // Closest to the eye line wins, so scrolling up and scrolling down
                // pick the same step at the same offset.
                activeStep = [...inBand].reduce((best, index) =>
                    distanceToCentre(index) < distanceToCentre(best) ? index : best
                );
            },
            { rootMargin: TRIGGER_BAND }
        );

        for (const node of stepNodes) {
            if (node) observer.observe(node);
        }
        return () => observer.disconnect();
    });
</script>

<div class="scrolly" role="group" aria-label={label}>
    <ol class="steps">
        {#each steps as step, index (index)}
            <li
                bind:this={stepNodes[index]}
                class="step"
                class:is-active={!scrollDriven || index === activeStep}
                data-testid="scrolly-step-{index}"
                aria-current={index === activeStep ? 'step' : undefined}
            >
                <div class="step-body">
                    <span class="step-index" aria-hidden="true">
                        {index + 1}<span class="step-total">/{steps.length}</span>
                    </span>
                    {@render step()}
                </div>
            </li>
        {/each}
    </ol>

    <div class="graphic-column">
        <div class="graphic">
            {@render graphic()}
        </div>
    </div>
</div>

<style>
    .scrolly {
        display: grid;
        grid-template-columns: minmax(0, 22rem) minmax(0, 1fr);
        gap: 3rem;
        /* Both columns stretch to the full height of the act: the graphic column
           has to be as tall as the steps for its sticky child to have anywhere
           to travel. */
        align-items: stretch;
    }

    .steps {
        list-style: none;
        margin: 0;
        padding: 0 0 30svh;
    }

    /* Heights in `svh`, not `vh` or `dvh`: `vh` overshoots the screen on a phone
       (it measures the viewport with the URL bar retracted), and `dvh` reflows
       every step as that bar hides and reappears — mid-scroll, which is the one
       moment these heights are being read. */
    .step {
        display: flex;
        align-items: center;
        min-height: 80svh;
    }

    /* The opening step should hand over to the second one quickly rather than
       leaving the reader alone with a single dot. */
    .step:first-child {
        min-height: 55svh;
    }

    .step-body {
        opacity: 0.32;
        transition: opacity 400ms ease;
    }

    .step.is-active .step-body {
        opacity: 1;
    }

    .step-index {
        display: block;
        margin-bottom: 0.6rem;
        font-family: var(--font-mono);
        font-size: var(--text-small);
        letter-spacing: 0.08em;
        color: var(--module-accent);
    }

    .step-total {
        color: hsl(var(--muted-foreground));
    }

    .graphic-column {
        min-width: 0;
    }

    .graphic {
        position: sticky;
        top: 1.5rem;
    }

    @media (max-width: 900px) {
        .scrolly {
            grid-template-columns: minmax(0, 1fr);
            gap: 1.5rem;
        }

        .graphic-column {
            order: -1;
            position: sticky;
            top: 0;
            z-index: 1;
            /* Opaque, so the narration scrolls underneath it rather than through. */
            background: hsl(var(--background));
            padding: 0.75rem 0;
        }

        .graphic {
            position: static;
        }

        .step {
            min-height: 70svh;
        }
    }

    @media (prefers-reduced-motion: reduce) {
        .step-body {
            transition: none;
        }
    }
</style>
