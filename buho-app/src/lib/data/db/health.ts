import type { HealthReading } from '#lib/types/health.ts';
import { insertStaged } from './client';
import type { StagedTable } from './staging';

/** Columns of `health_readings`, in schema order. */
export const HEALTH_COLUMNS = `timestamp, date, metric, value`;

/**
 * Move staged readings into `health_readings`, skipping those already stored.
 *
 * A reading is identified by its instant and its metric: the export writes
 * about three monitoring files a day over the same window, so the same reading
 * arrives several times and a second drop would otherwise double the table.
 */
export function healthReadingsDedupeSql(target: string, staging: string): string {
    return `
        INSERT INTO ${target} (${HEALTH_COLUMNS})
        SELECT ${HEALTH_COLUMNS} FROM ${staging} t
        WHERE NOT EXISTS (
            SELECT 1 FROM ${target} p
            WHERE p.timestamp = t.timestamp AND p.metric = t.metric
        )
        QUALIFY ROW_NUMBER() OVER (PARTITION BY t.timestamp, t.metric) = 1
    `;
}

/** The table's staging spec — exported so the headless test runs the real one. */
export const HEALTH_READINGS_TABLE: StagedTable<HealthReading> = {
    table: 'health_readings',
    schema: `
        timestamp TIMESTAMP,
        date DATE,
        metric VARCHAR,
        value DOUBLE
    `,
    columns: HEALTH_COLUMNS,
    // Already keyed by column name.
    toRecord: (reading: HealthReading) => reading,
    dedupeSql: healthReadingsDedupeSql,
};

/**
 * Insert Garmin health readings, **appending** to whatever is already there.
 *
 * @throws {Error} If database is not initialized.
 */
export async function insertHealthReadings(readings: HealthReading[]): Promise<void> {
    await insertStaged(HEALTH_READINGS_TABLE, readings);
}
