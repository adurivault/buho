import { query } from '#lib/data/db/index.ts';
import { type DateRange, whereClause } from './common';

/**
 * Reads of `health_readings`, for the exploratory health page.
 *
 * Nothing here is filtered or cross-filtered: the point of the page is to find
 * out what three years of readings look like, which means showing them before
 * deciding what they are for.
 */

export interface HealthMetricSummary {
    metric: string;
    readings: number;
    firstDay: string;
    lastDay: string;
    low: number;
    median: number;
    high: number;
    /**
     * The far end of the tail — the 99.5th percentile.
     *
     * A ramp that stops at p95 paints every effort the same colour: for heart
     * rate that is a brisk walk and a sprint on the same red. This is where the
     * ramp is allowed to run on to, and it is a percentile rather than the
     * maximum so one mis-read beat cannot own the whole top of the scale.
     */
    peak: number;
}

/** What the table actually holds — the page builds its controls from this. */
export async function getHealthMetrics(): Promise<HealthMetricSummary[]> {
    const sql = `
        SELECT
            metric,
            CAST(COUNT(*) AS BIGINT) as readings,
            CAST(MIN(DATE(timestamp)) AS VARCHAR) as firstDay,
            CAST(MAX(DATE(timestamp)) AS VARCHAR) as lastDay,
            CAST(quantile_cont(value, 0.05) AS DOUBLE) as low,
            CAST(quantile_cont(value, 0.5) AS DOUBLE) as median,
            CAST(quantile_cont(value, 0.95) AS DOUBLE) as high,
            CAST(quantile_cont(value, 0.995) AS DOUBLE) as peak
        FROM health_readings
        GROUP BY metric
    `;

    try {
        const rows = await query<Record<string, unknown>>(sql);
        return rows.map((row) => ({
            metric: String(row.metric),
            readings: Number(row.readings) || 0,
            firstDay: String(row.firstDay),
            lastDay: String(row.lastDay),
            low: Number(row.low) || 0,
            median: Number(row.median) || 0,
            high: Number(row.high) || 0,
            peak: Number(row.peak) || 0,
        }));
    } catch (error) {
        console.error('Failed to summarise health metrics:', error);
        return [];
    }
}

/**
 * Minutes per slot — the grid's vertical resolution.
 *
 * Five puts 288 rows on a day, finer than a panel has pixels for, and keeps the
 * whole export at a few hundred thousand cells. A reading a minute over three
 * years is four million; averaging into slots in SQL is what makes the page
 * open at all, and at this resolution nothing visible is lost.
 */
export const SLOT_MINUTES = 5;

export interface HealthSlot {
    /** Epoch ms of the local day — one column of the grid. */
    x: number;
    /**
     * Index of the slot within the day — one row.
     *
     * An integer, and never an hour to be converted back: a fractional hour is
     * not exactly representable, so 8:10 came back from `× 60` as 489.99999 and
     * floored onto the row above. Seven slots of 288 landed one row early and
     * their own row stayed empty for every day of the export.
     */
    slot: number;
    value: number;
}

/**
 * One averaged reading per (day, slot), ready to be laid out as an image.
 *
 * @param dateRange the days to read, all of them when absent.
 */
export async function getHealthSlots(metric: string, dateRange?: DateRange): Promise<HealthSlot[]> {
    const sql = `
        SELECT
            CAST(epoch(DATE(timestamp)) * 1000 AS BIGINT) as x,
            CAST(FLOOR((hour(timestamp) * 60 + minute(timestamp)) / ${SLOT_MINUTES}) AS INTEGER) as slot,
            CAST(AVG(value) AS DOUBLE) as value
        FROM health_readings
        ${whereClause(['metric = ?'], 'date', dateRange)}
        GROUP BY 1, 2
        ORDER BY 1
    `;

    try {
        const rows = await query<Record<string, unknown>>(sql, [metric]);
        return rows.map((row) => ({
            x: Number(row.x),
            slot: Number(row.slot),
            value: Number(row.value) || 0,
        }));
    } catch (error) {
        console.error(`Failed to load health slots for "${metric}":`, error);
        return [];
    }
}
