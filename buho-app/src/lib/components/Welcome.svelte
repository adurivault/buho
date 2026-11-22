<script lang="ts">
    import type { Snippet } from 'svelte';
    import { resolve } from '$app/paths';
    import CirclePlay from '@lucide/svelte/icons/circle-play';
    import WelcomePreview from '#lib/components/WelcomePreview.svelte';
    import type { Preview } from '#lib/shots.ts';

    /**
     * A page's welcome, the screen it shows while it holds nothing: what it
     * holds, the questions it answers, where the file goes, and beside that the
     * page as the demo draws it. The module pages and the calendar share it.
     *
     * Two columns in the middle of whatever height the page leaves them, short
     * enough to fit a 720px-tall window without a scrollbar. On a short window
     * the preview is what gives way; on a narrow one it goes.
     */
    interface Props {
        /** The heading names the data: `subject` in the page's colour, then `rest`. */
        subject: string;
        rest?: string;
        summary: string;
        questions: string[];
        preview: Preview;
        /** What the preview's main chart is, for its alternative text. */
        previewName: string;
        /** The drop zone. */
        zone: Snippet;
        /** Where the file comes from. */
        feeds: Snippet;
        /** The sample's button, where there is one. */
        demo?: { onLoad: () => void; building: boolean };
    }

    let { subject, rest, summary, questions, preview, previewName, zone, feeds, demo }: Props =
        $props();
</script>

<div class="welcome">
    <div class="column">
        <h2>
            <span class="subject">{subject}</span>
            {rest ?? ''}
        </h2>
        <p class="summary">{summary}</p>

        <ul class="questions">
            {#each questions as question (question)}
                <li>{question}</li>
            {/each}
        </ul>

        <div class="zone">{@render zone()}</div>

        <!-- The promise, where the file goes, and the page that explains it. -->
        <p class="safe">
            Read in your browser, never uploaded.
            <a href="{resolve('faq')}#privacy">More in the FAQ</a>
        </p>

        <div class="feeds">{@render feeds()}</div>

        {#if demo}
            <button class="demo" type="button" onclick={demo.onLoad} disabled={demo.building}>
                <span class="play" aria-hidden="true">
                    <CirclePlay size={18} strokeWidth={1.75} />
                </span>
                {demo.building ? 'Building the sample…' : 'Load demo data'}
            </button>
        {/if}
    </div>

    <div class="aside">
        <WelcomePreview {preview} name={previewName} />
    </div>
</div>

<style>
    .welcome {
        display: grid;
        flex: 1;
        grid-template-columns: minmax(22rem, 30rem) minmax(0, 38rem);
        justify-content: center;
        align-items: center;
        gap: clamp(2.5rem, 5vw, 4.5rem);
        min-height: 0;
        padding: 2rem 2.5rem;
    }

    .column {
        display: flex;
        flex-direction: column;
        min-width: 0;
    }

    /* The window less the page header and this page's padding. */
    .aside {
        --preview-max-height: calc(100dvh - 9rem);
    }

    h2 {
        margin: 0;
        font-family: var(--font-display);
        font-size: var(--text-title);
        font-weight: 650;
        line-height: 1.15;
        letter-spacing: -0.02em;
        color: hsl(var(--heading));
        text-wrap: balance;
    }

    .subject {
        color: var(--module-accent);
    }

    .summary {
        margin: 0.5rem 0 0;
        font-size: var(--text-lede);
        line-height: 1.55;
        color: hsl(var(--muted-foreground));
    }

    .questions {
        display: flex;
        flex-direction: column;
        gap: 0.3rem;
        margin: 1rem 0 0;
        padding: 0;
        list-style: none;
        font-size: var(--text-body);
        line-height: 1.45;
        color: hsl(var(--foreground));
    }

    .questions li {
        padding-left: 0.85rem;
        border-left: 2px solid var(--module-fill);
    }

    .zone {
        margin-top: 1.5rem;
    }

    .safe {
        margin: 0.75rem 0 0;
        font-size: var(--text-small);
        color: hsl(var(--muted-foreground));
    }

    .safe a {
        color: hsl(var(--foreground));
        text-decoration: underline;
        text-underline-offset: 3px;
    }

    .feeds {
        margin-top: 1.25rem;
        font-size: var(--text-body);
        line-height: 1.6;
        color: hsl(var(--muted-foreground));
    }

    .demo {
        align-self: flex-start;
        margin-top: 1.25rem;
        display: inline-flex;
        align-items: center;
        gap: 0.55rem;
        padding: 0.5rem 1rem 0.5rem 0.65rem;
        border: 1px solid hsl(var(--border));
        border-radius: var(--radius-pill);
        background: hsl(var(--card));
        font-size: var(--text-body);
        font-weight: 550;
        color: hsl(var(--foreground));
        cursor: pointer;
        transition: border-color 0.15s;
    }

    .demo:hover:not(:disabled) {
        border-color: hsl(var(--foreground) / 0.45);
    }

    .demo:disabled {
        opacity: 0.6;
        cursor: default;
    }

    .play {
        display: flex;
        color: var(--module-accent);
    }

    /* Too narrow for the two side by side: the text alone. */
    @media (max-width: 959px) {
        .welcome {
            grid-template-columns: minmax(0, 34rem);
            padding-inline: 1.5rem;
        }

        .aside {
            display: none;
        }
    }
</style>
