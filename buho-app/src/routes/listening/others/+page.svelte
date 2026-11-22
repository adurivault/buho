<script lang="ts">
    import LazySection from '#lib/components/LazySection.svelte';
    import { sectionView } from '#lib/actions/sectionView.ts';
    import { sections } from './sections';
</script>

<div class="others">
    <header>
        <h1>Others</h1>
        <p>
            Charts that didn't earn a place in the story, kept here for anyone who wants them. No
            narration: pick your own axes and see what falls out.
        </p>
    </header>

    <main data-testid="others-sections">
        {#each sections as section (section.id)}
            <div id={section.id} data-testid="section-{section.id}" use:sectionView={section.id}>
                <LazySection component={section.component} props={section.props} />
            </div>
        {/each}
    </main>
</div>

<style>
    .others {
        padding: 2rem 2rem 6rem;
    }

    header {
        max-width: 860px;
        margin-bottom: 2.5rem;
    }

    h1 {
        font-size: 1.6rem;
        margin: 0 0 0.5rem;
    }

    header p {
        font-size: var(--text-body);
        line-height: 1.6;
        color: hsl(var(--muted-foreground));
    }

    main {
        display: flex;
        flex-direction: column;
        gap: 3rem;
    }
</style>
