import type { StepPacket } from '#lib/types/steps.ts';
import { getConnection, insertStaged, tableExists } from './client';
import type { StagedTable } from './staging';

/** Columns of `step_packets`, in schema order, minus the derived ones. */
export const STEPS_COLUMNS = `
    source, timestamp, date, start_timestamp, steps, active_seconds,
    span_seconds, distance_meters, calories, cadence_spm, intensity,
    running_steps, running_active_seconds, worn
`;

/**
 * Move staged packets into `step_packets`, skipping those already stored.
 *
 * Exported so the headless DuckDB test exercises this exact statement.
 * A packet is everything one recorder wrote at one instant, so the source and
 * the instant identify it: a phone and a watch closing a window on the same
 * second are still two packets.
 */
export function stepPacketsDedupeSql(target: string, staging: string): string {
    return `
        INSERT INTO ${target} (${STEPS_COLUMNS})
        SELECT ${STEPS_COLUMNS} FROM ${staging} t
        WHERE NOT EXISTS (
            SELECT 1 FROM ${target} p
            WHERE p.source = t.source AND p.timestamp = t.timestamp
        )
        QUALIFY ROW_NUMBER() OVER (PARTITION BY t.source, t.timestamp) = 1
    `;
}

/**
 * The view every read of step counts goes through.
 *
 * A phone in a pocket and a watch on a wrist count the same walk twice, and
 * summing both doubles the day. The rule is hour by hour: an hour the watch was
 * worn — it measured a pulse — is the watch's; an hour it sat on a desk or its
 * charger goes to the phone, if the phone counted anything.
 *
 * Two simpler rules were tried on three years of a phone next to a watch, and
 * both miss. "Whichever counted more" keeps the larger of two noisy readings of
 * the same hour, every hour, and the day came out a fifth longer than either
 * device said. "The watch whenever it recorded" trusts a watch that keeps
 * writing its counters off the wrist, and the days it was barely worn lost a
 * third of their steps. Reading the pulse keeps the day within a few percent of
 * the watch when it was worn, and close to the phone when it was not.
 *
 * It lives here rather than in each query for the same reason as the positions
 * view: a chart that forgot the predicate would not look broken, it would just
 * quietly double-count.
 */
export const STEPS_VIEW = 'steps';

/** Exported so the headless tests read packets through the same view. */
export const STEPS_VIEW_SQL = `
    CREATE OR REPLACE VIEW ${STEPS_VIEW} AS
    SELECT * FROM step_packets WHERE superseded IS NOT TRUE
`;

/**
 * Who holds an hour two recorders claim equally, best first: the watch, worn
 * all day, ahead of the phone, carried some of it. Only reached when neither
 * can say more than the other — a watch without a heart-rate sensor next to a
 * phone. Unlisted sources rank last.
 */
const STEP_PRECEDENCE = ['garmin', 'apple-health'];

function precedenceSql(column: string): string {
    const ranked = STEP_PRECEDENCE.map(
        (source, rank) => `WHEN ${column} = '${source}' THEN ${rank}`
    ).join(' ');
    return `CASE ${ranked} ELSE ${STEP_PRECEDENCE.length} END`;
}

/**
 * Mark every packet that ends in an hour another recorder holds.
 *
 * Each recorder stakes a claim on the hours it saw, strongest first:
 *  - 2, worn: every hour a window with a pulse in it touches — a watch at rest
 *    writes one packet in two hours, and the hour in the middle is still worn;
 *  - 1, cannot tell: the hour a phone's window closes in;
 *  - 0, off the body: the hour a watch's pulseless window closes in.
 * The strongest claim holds the hour, ties going to {@link STEP_PRECEDENCE}.
 *
 * Recomputed over the whole table after every change, like the positions one:
 * the second export to arrive can take hours from the first, and removing one
 * has to give them back.
 *
 * Exported so the headless test exercises this exact statement.
 */
export function supersedeStepsSql(table = 'step_packets'): string {
    return `
        UPDATE ${table} SET superseded = ${table}.source <> held.source
        FROM (
            SELECT hour, FIRST(source ORDER BY claim DESC, rank, source) AS source
            FROM (
                SELECT hour, source, MAX(claim) AS claim, ${precedenceSql('source')} AS rank
                FROM (
                    SELECT
                        unnest(generate_series(
                            date_trunc('hour', COALESCE(start_timestamp, timestamp)),
                            date_trunc('hour', timestamp),
                            INTERVAL 1 HOUR
                        )) AS hour,
                        source,
                        2 AS claim
                    FROM ${table}
                    WHERE worn AND timestamp IS NOT NULL
                    UNION ALL
                    SELECT
                        date_trunc('hour', timestamp) AS hour,
                        source,
                        CASE WHEN worn IS NULL THEN 1 WHEN worn THEN 2 ELSE 0 END AS claim
                    FROM ${table}
                    WHERE timestamp IS NOT NULL
                )
                GROUP BY hour, source
            )
            GROUP BY hour
        ) held
        WHERE date_trunc('hour', ${table}.timestamp) = held.hour
    `;
}

/** The table's staging spec — exported so the headless test runs the real one. */
export const STEP_PACKETS_TABLE: StagedTable<StepPacket> = {
    table: 'step_packets',
    schema: `
        source VARCHAR,
        timestamp TIMESTAMP,
        date DATE,
        start_timestamp TIMESTAMP,
        steps INTEGER,
        active_seconds DOUBLE,
        span_seconds DOUBLE,
        distance_meters DOUBLE,
        calories DOUBLE,
        cadence_spm DOUBLE,
        intensity INTEGER,
        running_steps INTEGER,
        running_active_seconds DOUBLE,
        worn BOOLEAN,
        superseded BOOLEAN,
        step_id INTEGER
    `,
    columns: STEPS_COLUMNS,
    toRecord: (p: StepPacket) => ({
        source: p.source,
        timestamp: p.timestamp,
        date: p.date,
        start_timestamp: p.startTimestamp,
        steps: p.steps,
        active_seconds: p.activeSeconds,
        span_seconds: p.spanSeconds,
        distance_meters: p.distanceMeters,
        calories: p.calories,
        cadence_spm: p.cadenceSpm,
        intensity: p.intensity,
        running_steps: p.runningSteps,
        running_active_seconds: p.runningActiveSeconds,
        worn: p.worn,
    }),
    dedupeSql: stepPacketsDedupeSql,
};

/**
 * Insert step packets, **appending** to whatever is already there.
 *
 * @throws {Error} If database is not initialized.
 */
export async function insertStepPackets(packets: StepPacket[]): Promise<void> {
    await insertStaged(STEP_PACKETS_TABLE, packets);
    if (packets.length === 0) return;
    // Stable per-row key, mirroring seg_id / msg_index / act_id.
    const connection = await getConnection();
    await connection.query(`UPDATE ${STEP_PACKETS_TABLE.table} SET step_id = rowid`);
    await rebuildStepsDerived();
}

/**
 * Recompute which recorder holds each hour, and make sure the view over them
 * exists. Runs after any change to the row set — see {@link supersedeStepsSql}.
 */
export async function rebuildStepsDerived(): Promise<void> {
    if (!(await tableExists(STEP_PACKETS_TABLE.table))) return;
    const connection = await getConnection();
    await connection.query(supersedeStepsSql(STEP_PACKETS_TABLE.table));
    await connection.query(STEPS_VIEW_SQL);
}
