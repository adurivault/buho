<script lang="ts">
    import Icon from '#lib/components/Icon.svelte';
    import { DATA_MODULES } from '#lib/data/modules.ts';

    /**
     * The calendar before anything is loaded: what it is, in one sentence, and
     * the two ways to fill it — your own exports, or the samples.
     */
    interface Props {
        onImport: () => void;
        onDemo: () => void;
        building: boolean;
    }

    let { onImport, onDemo, building }: Props = $props();

    const withDemo = DATA_MODULES.filter((module) => module.hasDemo);
</script>

<div class="empty">
    <span class="icon"><Icon name="calendar" size={28} /></span>
    <h1>Every module, day by day</h1>
    <p>
        The calendar lays everything you import on the same days: what you listened to, where you
        went, who you wrote to, what you looked up, how much you walked, your heart rate. Pick a
        year, then a day.
    </p>
    <div class="actions">
        <button class="btn primary" type="button" onclick={onImport}>Import my data</button>
        {#if withDemo.length > 0}
            <button class="btn" type="button" onclick={onDemo} disabled={building}>
                {building ? 'Building the sample…' : 'Load demo data'}
            </button>
        {/if}
    </div>
    {#if withDemo.length > 0}
        <p class="note">
            The demo fills {withDemo.map((module) => module.label.toLowerCase()).join(' and ')} with an
            invented history.
        </p>
    {/if}
</div>

<style>
    .empty {
        max-width: 34rem;
        margin: 12vh auto 0;
        padding: 0 1.5rem;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.75rem;
        text-align: center;
    }

    .icon {
        color: hsl(var(--muted-foreground));
    }

    h1 {
        margin: 0;
        font-family: var(--font-display);
        font-size: var(--text-heading);
        font-weight: 600;
        letter-spacing: -0.01em;
        color: hsl(var(--heading));
    }

    p {
        margin: 0;
        font-size: var(--text-body);
        line-height: 1.55;
        color: hsl(var(--muted-foreground));
    }

    .note {
        font-size: var(--text-small);
    }

    .actions {
        display: flex;
        flex-wrap: wrap;
        justify-content: center;
        gap: 0.5rem;
        margin-top: 0.5rem;
    }

    .btn {
        border: 1px solid hsl(var(--border));
        border-radius: var(--radius-pill);
        padding: 0.4rem 1rem;
        font: inherit;
        font-size: var(--text-body);
        cursor: pointer;
        color: hsl(var(--foreground));
        background: transparent;
    }

    .btn:hover:not(:disabled) {
        background: hsl(var(--accent));
    }

    .btn:disabled {
        cursor: default;
        opacity: 0.6;
    }

    .btn.primary {
        border-color: transparent;
        font-weight: 600;
        color: hsl(var(--primary-foreground));
        background: hsl(var(--primary));
    }

    .btn.primary:hover {
        opacity: 0.9;
        background: hsl(var(--primary));
    }
</style>
