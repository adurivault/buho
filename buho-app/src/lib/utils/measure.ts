import type { MeasureOption } from '#lib/components/visualizations/MeasureToggle.svelte';
import type { Measure } from '#lib/data/sql/measure.ts';
import { formatDuration } from './duration';

/**
 * How the measure reads on screen — the labels and the units the SQL side of
 * `data/sql/measure.ts` deliberately knows nothing about.
 */

/** The toggle, written once: the guide and the Explorer offer the same choice. */
export const MEASURE_OPTIONS: MeasureOption<Measure>[] = [
    { key: 'minutes', label: 'Time', hint: 'Weighted by minutes listened' },
    { key: 'plays', label: 'Plays', hint: 'One unit per play' },
];

/** A figure with its unit: "3.2 h", "1,204 plays". */
export function formatMeasure(measure: Measure, value: number): string {
    if (measure === 'minutes') return formatDuration(value);
    const rounded = Math.round(value);
    return `${rounded.toLocaleString()} play${rounded === 1 ? '' : 's'}`;
}

/** What a colour legend or an axis is scaled in. */
export function measureAxisLabel(measure: Measure): string {
    return measure === 'minutes' ? 'Minutes' : 'Plays';
}
