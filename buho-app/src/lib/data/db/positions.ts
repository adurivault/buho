import type { LocationSegment } from '#lib/types/positions.ts';
import { getConnection, insertStaged, tableExists } from './client';
import type { StagedTable } from './staging';

/** Columns of `location_segments`, in schema order, minus the derived `seg_id`. */
export const LOCATION_COLUMNS = `
    source, timestamp, date, end_timestamp, duration_seconds, lat, lon,
    segment_type, activity_type, semantic_type, place_id, distance_meters,
    speed_kmh, azimuth_degrees, altitude_m, heart_rate, cadence_spm
`;

/**
 * Move staged rows into `location_segments`, skipping those already stored.
 *
 * Exported so the headless DuckDB test exercises this exact statement rather
 * than a paraphrase of it — the anti-join is the whole reason importing a Garmin
 * export next to a Timeline one doesn't duplicate either.
 *
 * `source` leads the key: the two providers record the same walk at different
 * rates, and a Timeline point that happens to share a second and a rounded
 * position with a watch fix is still a separate observation.
 */
export function locationDedupeSql(target: string, staging: string): string {
    return `
        INSERT INTO ${target} (${LOCATION_COLUMNS})
        SELECT ${LOCATION_COLUMNS} FROM ${staging} t
        WHERE NOT EXISTS (
            SELECT 1 FROM ${target} s
            WHERE s.source = t.source
              AND s.timestamp = t.timestamp
              AND s.lat = t.lat
              AND s.lon = t.lon
        )
        -- The anti-join only sees what is already stored, so twins arriving in
        -- the *same* drop would both pass it. A watch standing still writes the
        -- same fix repeatedly, so the key is enforced inside the batch too.
        QUALIFY ROW_NUMBER() OVER (
            PARTITION BY t.source, t.timestamp, t.lat, t.lon
        ) = 1
    `;
}

/**
 * The view every read of recorded positions goes through.
 *
 * Several providers record the same life at different resolutions, and stacking
 * them raw gives a timeline that says you were in three places at once. The rule
 * is minute by minute: wherever a watch was recording, the watch wins; the rest
 * of the time the phone fills in. What comes out is one continuous answer to
 * "where was I at this moment", which is what every view over positions wants.
 *
 * It lives here rather than in each query on purpose — a chart that forgot the
 * predicate wouldn't look broken, it would just quietly double-count.
 */
export const POSITIONS_VIEW = 'positions';

/**
 * `NOT superseded`, written to survive the column being NULL before a recompute.
 * Exported so the headless tests read positions through the same view.
 */
export const POSITIONS_VIEW_SQL = `
    CREATE OR REPLACE VIEW ${POSITIONS_VIEW} AS
    SELECT * FROM location_segments WHERE superseded IS NOT TRUE
`;

/**
 * Which recorder wins a minute two of them both hold, best first.
 *
 * Garmin ahead of Strava because they are usually the *same* recording twice
 * over: the watch writes the file, Strava receives a copy. What Garmin keeps and
 * the copy loses is the offset the watch was set to — Strava normalises its
 * tracks to UTC — so the watch's own file is the one that knows what time of day
 * it was. Both are ahead of a phone, which samples once a minute where they
 * sample once a second.
 *
 * Anything unlisted ranks last, which is the right default: a source logging a
 * life is exactly the one that should give way to a recorded activity.
 */
const POSITION_PRECEDENCE = ['garmin', 'strava'];

/** That order as a rank over a `source` column — lower wins. */
function precedenceSql(column: string): string {
    const ranked = POSITION_PRECEDENCE.map(
        (source, rank) => `WHEN ${column} = '${source}' THEN ${rank}`
    ).join(' ');
    return `CASE ${ranked} ELSE ${POSITION_PRECEDENCE.length} END`;
}

/**
 * Mark every point a better recording of the same minute covers.
 *
 * Recomputed over the whole table after every import, never incrementally: a
 * Garmin export arriving second has to supersede the Timeline already loaded,
 * and a Timeline arriving second must not resurrect what the watch already
 * covers.
 *
 * The unit is the minute, matching how coarsely the phone samples. A watch
 * recording at 1 Hz has a point in every minute it ran, so those minutes are
 * fully covered and the phone's version of them is redundant.
 *
 * Exported so the headless test exercises this exact statement.
 */
export function supersedeSql(table = 'location_segments'): string {
    return `
        UPDATE ${table} SET superseded = ${precedenceSql(`${table}.source`)} > (
            SELECT MIN(${precedenceSql('other.source')})
            FROM ${table} other
            WHERE date_trunc('minute', other.timestamp)
                = date_trunc('minute', ${table}.timestamp)
        )
    `;
}

/** The table's staging spec — exported so the headless test runs the real one. */
export const LOCATION_SEGMENTS_TABLE: StagedTable<LocationSegment> = {
    table: 'location_segments',
    // Geo columns (country…arrondissement) are declared up front so the
    // explorer's base points query can always read them; attributeZones fills
    // them in afterwards, leaving them NULL if attribution is skipped or fails.
    schema: `
        source VARCHAR,
        timestamp TIMESTAMP,
        date DATE,
        end_timestamp TIMESTAMP,
        duration_seconds DOUBLE,
        lat DOUBLE,
        lon DOUBLE,
        segment_type VARCHAR,
        activity_type VARCHAR,
        semantic_type VARCHAR,
        place_id VARCHAR,
        distance_meters DOUBLE,
        speed_kmh DOUBLE,
        azimuth_degrees DOUBLE,
        altitude_m DOUBLE,
        heart_rate INTEGER,
        cadence_spm INTEGER,
        superseded BOOLEAN,
        country VARCHAR,
        region VARCHAR,
        department VARCHAR,
        nearest_city VARCHAR,
        city_km DOUBLE,
        arrondissement VARCHAR,
        seg_id INTEGER
    `,
    columns: LOCATION_COLUMNS,
    toRecord: (s: LocationSegment) => ({
        source: s.source,
        timestamp: s.timestamp,
        date: s.date,
        end_timestamp: s.endTimestamp,
        duration_seconds: s.durationSeconds,
        lat: s.lat,
        lon: s.lon,
        segment_type: s.segmentType,
        activity_type: s.activityType,
        semantic_type: s.semanticType,
        place_id: s.placeId,
        distance_meters: s.distanceMeters,
        speed_kmh: s.speedKmh,
        azimuth_degrees: s.azimuthDegrees,
        altitude_m: s.altitudeMeters,
        heart_rate: s.heartRate,
        cadence_spm: s.cadenceSpm,
    }),
    dedupeSql: locationDedupeSql,
};

/**
 * Insert recorded positions, **appending** to whatever is already there.
 *
 * One table for every provider, keyed by `source`: a Google Timeline point and a
 * watch fix are the same fact recorded at different resolutions, and keeping
 * them together is what lets one map, one constellation and one set of geo
 * attribution serve all of them.
 *
 * Appending rather than replacing is what makes that work at all — importing a
 * Garmin export must not wipe the Timeline already loaded — so duplicates are
 * possible and rows go through a temp table first. The timestamps are already
 * local wall-clock strings, resolved by each provider's parser from the offset
 * it recorded, so they are inserted as-is rather than reformatted from a Date.
 *
 * @throws {Error} If database is not initialized.
 */
export async function insertLocationSegments(segments: LocationSegment[]): Promise<void> {
    await insertStaged(LOCATION_SEGMENTS_TABLE, segments);
    if (segments.length === 0) return;
    const connection = await getConnection();

    // Stable per-row key, materialised once the dedupe has settled the row set.
    // Geo attribution runs in the background after the import unblocks, so its
    // results are matched back onto already-loaded points by `seg_id`; the
    // `rowid` pseudo-column itself can't be used, as the finalize UPDATE
    // rewrites rows.
    await connection.query(`UPDATE ${LOCATION_SEGMENTS_TABLE.table} SET seg_id = rowid`);

    // Resolve provider overlap once, here, rather than in every query that reads
    // positions back out. See POSITIONS_VIEW.
    await rebuildPositionsDerived();
}

/**
 * Recompute what one provider's points hide of the other's, and make sure the
 * view over them exists.
 *
 * `superseded` is a claim about the table as a whole, not about any single row:
 * a phone point is hidden because a watch was recording that minute. Remove the
 * watch and that claim is false — the phone points it covered have to come back,
 * or the map keeps a hole where the deleted source used to be. So this runs
 * after any change to the row set, insertion or deletion alike.
 */
export async function rebuildPositionsDerived(): Promise<void> {
    if (!(await tableExists('location_segments'))) return;
    const connection = await getConnection();
    await connection.query(supersedeSql('location_segments'));
    await connection.query(POSITIONS_VIEW_SQL);
}
