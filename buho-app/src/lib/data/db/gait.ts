import type { GaitReading } from '#lib/types/steps.ts';
import { insertStaged } from './client';
import type { StagedTable } from './staging';

/** Columns of `gait_readings`, in schema order. */
export const GAIT_COLUMNS = `source, timestamp, date, metric, value`;

/**
 * Move staged readings into `gait_readings`, skipping those already stored.
 *
 * A reading is identified by its source, its instant and its metric: one walk
 * yields a speed, a step length and the rest at the same instant, and a second
 * drop of the same export must not double them.
 */
export function gaitReadingsDedupeSql(target: string, staging: string): string {
    return `
        INSERT INTO ${target} (${GAIT_COLUMNS})
        SELECT ${GAIT_COLUMNS} FROM ${staging} t
        WHERE NOT EXISTS (
            SELECT 1 FROM ${target} p
            WHERE p.source = t.source AND p.timestamp = t.timestamp AND p.metric = t.metric
        )
        QUALIFY ROW_NUMBER() OVER (PARTITION BY t.source, t.timestamp, t.metric) = 1
    `;
}

/** The table's staging spec — exported so the headless test runs the real one. */
export const GAIT_READINGS_TABLE: StagedTable<GaitReading> = {
    table: 'gait_readings',
    schema: `
        source VARCHAR,
        timestamp TIMESTAMP,
        date DATE,
        metric VARCHAR,
        value DOUBLE
    `,
    columns: GAIT_COLUMNS,
    // Already keyed by column name.
    toRecord: (reading: GaitReading) => reading,
    dedupeSql: gaitReadingsDedupeSql,
};

/**
 * Insert gait readings, **appending** to whatever is already there.
 *
 * @throws {Error} If database is not initialized.
 */
export async function insertGaitReadings(readings: GaitReading[]): Promise<void> {
    await insertStaged(GAIT_READINGS_TABLE, readings);
}
