<script lang="ts">
    import { base } from "$app/paths";
</script>

<section class="handoff-section" aria-label="Explorer Handoff">
    <div class="handoff-content">
        <a
            href={`${base}/spotify/explore/`}
            class="cta-button"
            data-testid="explore-cta"
        >
            Want to explore on your own?
        </a>
    </div>
</section>

<style>
    .handoff-section {
        display: flex;
        justify-content: center;
        align-items: center;
        padding: var(--spacing-16, 4rem) 0;
        margin-top: var(--spacing-8, 2rem);
        border-top: 1px solid var(--border-color, rgba(0, 0, 0, 0.1));
    }

    :global(.dark) .handoff-section {
        border-top-color: var(--border-color-dark, rgba(255, 255, 255, 0.1));
    }

    .handoff-content {
        text-align: center;
    }

    .cta-button {
        display: inline-block;
        padding: 0.75rem 1.5rem;
        background-color: transparent;
        color: hsl(var(--foreground));
        font-family: var(--font-sans, sans-serif);
        font-size: var(--font-size-base, 1rem);
        font-weight: 500;
        text-decoration: none;
        border: 2px solid hsl(var(--foreground));
        border-radius: 9999px;
        transition: all 0.2s ease-in-out;
        cursor: pointer;
    }

    .cta-button:hover {
        background-color: hsl(var(--foreground));
        color: hsl(var(--background));
    }
</style>
