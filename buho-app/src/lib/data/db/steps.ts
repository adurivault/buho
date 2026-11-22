import type { StepPacket } from '#lib/types/steps.ts';
import { getConnection, insertStaged } from './client';
import type { StagedTable } from './staging';

/** Columns of `step_packets`, in schema order, minus the derived `step_id`. */
export const STEPS_COLUMNS = `
    timestamp, date, start_timestamp, steps, active_seconds,
    span_seconds, distance_meters, calories, cadence_spm, intensity,
    running_steps, running_active_seconds
`;

/**
 * Move staged packets into `step_packets`, skipping those already stored.
 *
 * Exported so the headless DuckDB test exercises this exact statement.
 * A packet is everything the watch wrote at one instant, so the instant alone
 * identifies it.
 */
export function stepPacketsDedupeSql(target: string, staging: string): string {
    return `
        INSERT INTO ${target} (${STEPS_COLUMNS})
        SELECT ${STEPS_COLUMNS} FROM ${staging} t
        WHERE NOT EXISTS (
            SELECT 1 FROM ${target} p
            WHERE p.timestamp = t.timestamp
        )
        QUALIFY ROW_NUMBER() OVER (PARTITION BY t.timestamp) = 1
    `;
}

/** The table's staging spec — exported so the headless test runs the real one. */
export const STEP_PACKETS_TABLE: StagedTable<StepPacket> = {
    table: 'step_packets',
    schema: `
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
        step_id INTEGER
    `,
    columns: STEPS_COLUMNS,
    toRecord: (p: StepPacket) => ({
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
    }),
    dedupeSql: stepPacketsDedupeSql,
};

/**
 * Insert Garmin step packets, **appending** to whatever is already there.
 *
 * @throws {Error} If database is not initialized.
 */
export async function insertStepPackets(packets: StepPacket[]): Promise<void> {
    await insertStaged(STEP_PACKETS_TABLE, packets);
    if (packets.length === 0) return;
    // Stable per-row key, mirroring seg_id / msg_index / act_id.
    const connection = await getConnection();
    await connection.query(`UPDATE ${STEP_PACKETS_TABLE.table} SET step_id = rowid`);
}
