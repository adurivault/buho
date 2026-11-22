<script lang="ts">
    import type { PlayRecord } from '#lib/data/queries/behaviorQueries.ts';
    import { formatPlayLength } from '#lib/utils/duration.ts';
    import { formatPlayReason } from '#lib/utils/spotify.ts';
    import { formatDayLabel } from '#lib/visualizations/listeningStory.ts';

    /**
     * One row of the export, shown as the fields it actually contains rather than
     * as JSON — so a reader can see what their data holds before any chart is
     * built on top of it. Empty fields are dropped instead of shown as blanks.
     */
    interface Props {
        record: PlayRecord;
    }

    let { record }: Props = $props();

    const yesNo = (value: boolean | null) => (value === null ? null : value ? 'Yes' : 'No');

    const rows = $derived(
        (
            [
                ['Track', record.track],
                ['Artist', record.artist],
                ['Album', record.album],
                ['Date', formatDayLabel(record.playedAt.slice(0, 10))],
                ['Time', record.playedAt.slice(11, 16)],
                [
                    'Listened for',
                    record.msPlayed === null ? null : formatPlayLength(record.msPlayed),
                ],
                ['Device', record.platform],
                ['Country', record.country],
                ['Shuffle', yesNo(record.shuffle)],
                ['Offline', yesNo(record.offline)],
                ['Started by', formatPlayReason(record.reasonStart, 'start')],
                ['Ended by', formatPlayReason(record.reasonEnd, 'end')],
            ] as [string, string | null][]
        ).filter(([, value]) => value !== null && value !== '')
    );
</script>

<dl class="record">
    {#each rows as [label, value] (label)}
        <div class="row">
            <dt>{label}</dt>
            <dd>{value}</dd>
        </div>
    {/each}
</dl>

<style>
    .record {
        margin: 0.9rem 0 0;
        padding: 0.75rem 0.9rem;
        border: 1px solid hsl(var(--border));
        border-radius: var(--radius-md);
        background: hsl(var(--card));
        font-size: var(--text-small);
        line-height: 1.45;
    }

    .row {
        display: grid;
        grid-template-columns: 7.5rem minmax(0, 1fr);
        gap: 0.75rem;
        padding: 0.2rem 0;
    }

    .row + .row {
        border-top: 1px solid hsl(var(--border) / 0.6);
    }

    dt {
        color: hsl(var(--muted-foreground));
    }

    dd {
        margin: 0;
        color: hsl(var(--foreground));
        overflow-wrap: anywhere;
    }
</style>
