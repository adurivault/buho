/**
 * The two kinds of position export.
 *
 * A Google Timeline is meant to be a complete record: the phone was on, it was
 * logging, and a stretch with no point in it is a stretch where nothing moved.
 * A watch is the opposite — it records an activity and nothing else, so the
 * hours between two runs are not a stay somewhere, they are the watch being off
 * the wrist.
 *
 * The distinction only matters where the code fills a gap in with something:
 * time credited to the last known position, a dot held at a home anchor from
 * 04:00. Both are true readings of a continuous export and pure invention over
 * an episodic one — a single Garmin import otherwise reports having spent
 * eighteen hours standing at the end of Sunday's run.
 *
 * Which side an export falls on follows from what it set out to log: a life, or
 * workouts. Garmin and Strava are both the latter — the same recordings, one
 * straight off the watch and one by way of an upload.
 */
export type SourceCoverage = 'continuous' | 'episodic';

/** Coverage per source slug, as stored in `location_segments.source`. */
export const POSITION_SOURCE_COVERAGE: Record<string, SourceCoverage> = {
    'google-timeline': 'continuous',
    garmin: 'episodic',
    strava: 'episodic',
};

/**
 * Whether a source's silence can be read as "still there".
 *
 * Unknown slugs count as continuous: that is what a source logging a life is,
 * and a new one being read as episodic would silently drop time nobody meant to
 * drop.
 */
export function isContinuousSource(slug: string): boolean {
    return POSITION_SOURCE_COVERAGE[slug] !== 'episodic';
}

/**
 * The same test in SQL, over a `source` column.
 *
 * Written as "not one of the episodic ones" rather than "one of the continuous
 * ones" so it agrees with {@link isContinuousSource} on a slug neither list
 * knows about.
 */
export const IS_CONTINUOUS_SOURCE_SQL = `source NOT IN (${Object.entries(POSITION_SOURCE_COVERAGE)
    .filter(([, coverage]) => coverage === 'episodic')
    .map(([slug]) => `'${slug}'`)
    .join(', ')})`;
