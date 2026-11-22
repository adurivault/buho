/**
 * What a listening chart counts: time played, or plays.
 *
 * The two answer different questions and neither is a rounding of the other —
 * a three-hour DJ set and forty singles are the same afternoon, but only one of
 * them is forty listens. They are a pair here because one service records no
 * duration at all: a Last.fm scrobble says a track was played and when, and
 * nothing else, so `ms_played` is NULL on every one of its rows. Measured in
 * minutes a scrobbled history sums to zero and every duration-filtered view
 * comes back empty; measured in plays it is exactly as complete as Spotify's.
 *
 * Kept in its own module, free of any import, for the same reason `trackKey.ts`
 * is: the query layer builds the aggregate and the pages label the axis, and
 * neither should have to depend on the other to say what is being counted.
 */

export type Measure = 'minutes' | 'plays';

/**
 * The aggregate one measure sums a group of plays into, in its own unit.
 *
 * @param prefix table alias to qualify `ms_played` with, e.g. `'p.'`.
 */
export function measureSql(measure: Measure, prefix = ''): string {
    return measure === 'plays' ? 'COUNT(*)' : `SUM(${prefix}ms_played) / 60000.0`;
}

/**
 * The rows a measure can be computed from, as extra WHERE conditions.
 *
 * Only minutes need one. A play whose service recorded no duration is not a
 * play of zero minutes, so it is dropped rather than dragging the total down —
 * but that same predicate is what empties the view for a history that has no
 * durations anywhere. Counting plays excludes nothing, which is the point.
 *
 * @param prefix table alias to qualify `ms_played` with, e.g. `'p.'`.
 */
export function measureConditions(measure: Measure, prefix = ''): string[] {
    return measure === 'minutes' ? [`${prefix}ms_played IS NOT NULL`] : [];
}
