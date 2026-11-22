<script lang="ts">
    import { resolve } from '$app/paths';
    import DropZone from '#lib/components/DropZone.svelte';
    import Welcome from '#lib/components/Welcome.svelte';
    import { CALENDAR_SHOTS } from '#lib/shots.ts';

    /**
     * The calendar before anything is loaded: what it lays out, the questions
     * that needs every export at once to answer, a drop zone that takes any of
     * them, and the samples, which are one person and so line up day by day.
     *
     * The layout is the module welcomes' ({@link Welcome}), without a module's
     * colour: the calendar holds no data of its own.
     */
    interface Props {
        onDemo: () => void;
        building: boolean;
    }

    let { onDemo, building }: Props = $props();
</script>

<Welcome
    subject="Every module,"
    rest="day by day"
    summary="What you listened to, where you went, who you wrote to, what you looked up, how much you walked and your heart rate, on the same days."
    questions={[
        'What happened on a given day, across all your exports?',
        'How does one year compare with the next?',
    ]}
    preview={CALENDAR_SHOTS}
    previewName="Calendar"
    demo={{ onLoad: onDemo, building }}
>
    {#snippet zone()}
        <DropZone
            surface="calendar"
            title="Drop any export here"
            pickTitle="Pick an export"
            hint="A .zip, a folder or loose files, from any service Buho reads."
        />
    {/snippet}

    {#snippet feeds()}
        <p>
            Every export Buho reads has its lane here.
            <a href={resolve('sources')}>See them all</a>
        </p>
    {/snippet}
</Welcome>

<style>
    p {
        margin: 0;
    }

    a {
        color: hsl(var(--foreground));
        font-weight: 600;
        text-decoration: underline;
        text-underline-offset: 3px;
    }
</style>
