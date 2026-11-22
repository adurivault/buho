<script lang="ts">
    import type { Snippet } from 'svelte';
    import { FUNNEL_STEPS, stepIndex, type FunnelStep } from '#lib/onboarding/funnel.ts';

    /**
     * The frame around the three onboarding steps: the rail, the title, and a
     * way back.
     *
     * The rail is a map, not a set of controls. Steps you have been through are
     * clickable so a wrong turn costs one click; steps ahead are not, because
     * there is nothing useful on step two until you have said which export you
     * are after. Showing them anyway is the point — a first-time visitor gets to
     * see that this is three steps long before committing to the first one.
     */
    interface Props {
        step: FunnelStep;
        onStep: (kind: FunnelStep['kind']) => void;
        title: string;
        subtitle?: string;
        children: Snippet;
    }

    let { step, onStep, title, subtitle, children }: Props = $props();

    const current = $derived(stepIndex(step));
</script>

<ol class="rail" aria-label="Getting started">
    {#each FUNNEL_STEPS as entry, index (entry.kind)}
        {@const state = index === current ? 'current' : index < current ? 'done' : 'ahead'}
        <li class={state} aria-current={index === current ? 'step' : undefined}>
            {#if index < current}
                <button onclick={() => onStep(entry.kind)}>
                    <span class="marker">{index + 1}</span>
                    <span class="label">{entry.label}</span>
                </button>
            {:else}
                <span class="static">
                    <span class="marker">{index + 1}</span>
                    <span class="label">{entry.label}</span>
                </span>
            {/if}
        </li>
    {/each}
</ol>

<h1>{title}</h1>
{#if subtitle}
    <p class="subtitle">{subtitle}</p>
{/if}

<div class="body">
    {@render children()}
</div>

<style>
    .rail {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 0.35rem 1.25rem;
        margin: 0 0 2rem;
        padding: 0;
        list-style: none;
    }

    .rail li button,
    .rail .static {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        font-size: var(--text-small);
        color: hsl(var(--muted-foreground));
        transition: color 0.15s;
    }

    .rail li button {
        cursor: pointer;
    }

    .rail li button:hover {
        color: hsl(var(--foreground));
    }

    .marker {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 1.4rem;
        height: 1.4rem;
        border: 1px solid hsl(var(--border));
        border-radius: var(--radius-pill);
        font-family: var(--font-mono);
        font-size: var(--text-label);
    }

    .rail .current .marker {
        border-color: transparent;
        background: hsl(var(--primary));
        color: hsl(var(--background));
    }

    .rail .current .label {
        color: hsl(var(--foreground));
        font-weight: 600;
    }

    .rail .done .marker {
        border-color: hsl(var(--foreground) / 0.4);
    }

    .rail .ahead {
        opacity: 0.55;
    }

    h1 {
        margin: 0;
        font-size: clamp(1.6rem, 4vw, 2.25rem);
        line-height: 1.15;
    }

    .subtitle {
        max-width: 46rem;
        margin: 0.75rem 0 0;
        color: hsl(var(--muted-foreground));
    }

    .body {
        margin-top: 2rem;
    }
</style>
