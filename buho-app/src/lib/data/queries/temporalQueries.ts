import { query } from '../db';
import { trackKeySql } from '../sql/trackKey';
import { measureConditions, measureSql, type Measure } from '../sql/measure';
import { type DateRange, whereClause, type SqlNumber } from './common';

export interface DailyAnalysisData {
    date: string;
    dateEpochMs: number;
    playCount: number;
    totalMinutes: number;
    uniqueArtists: number;
    uniqueTracks: number;
    maxSameTrackPlays: number;
    shuffleRate: number;
    intentionalStopRate: number;
    intentionalStartRate: number;
    skipRate: number;
    eveningRate: number;
    meanListenHour: number;
    repeatIntensity: number;
}

export interface DailyCalendarPoint {
    date: string; // YYYY-MM-DD
    /** In the unit of the measure it was asked for — minutes, or plays. */
    value: number;
}

export async function getDailyAnalysis(dateRange?: DateRange): Promise<DailyAnalysisData[]> {
    const sql = `
        WITH base AS (
            SELECT
                DATE(timestamp) as playDate,
                CAST(epoch(DATE(timestamp)) * 1000 AS BIGINT) as dateEpochMs,
                ms_played as msPlayed,
                artist_name as artist,
                ${trackKeySql()} as trackKey,
                -- Left NULL where the service records no reason, so the rates
                -- below exclude those plays instead of scoring them 'unknown'.
                NULLIF(TRIM(reason_start), '') as reasonStart,
                NULLIF(TRIM(reason_end), '') as reasonEnd,
                hour(timestamp) as hourOfDay,
                -- NULL, not 0, where the service never recorded the flag: these
                -- feed rates below, and counting a Deezer play as "not shuffled"
                -- would drag the ratio down with rows that simply can't answer.
                CASE WHEN shuffle IS NULL THEN NULL WHEN shuffle THEN 1 ELSE 0 END as isShuffle,
                CASE WHEN skipped IS NULL THEN NULL WHEN skipped THEN 1 ELSE 0 END as isSkipped
            FROM plays
            ${whereClause(
                ['timestamp IS NOT NULL', 'ms_played IS NOT NULL', 'artist_name IS NOT NULL'],
                'timestamp',
                dateRange
            )}
        ),
        day_track_counts AS (
            SELECT
                playDate,
                trackKey,
                COUNT(*) as trackPlayCount
            FROM base
            GROUP BY playDate, trackKey
        ),
        day_track_max AS (
            SELECT
                playDate,
                CAST(MAX(trackPlayCount) AS INTEGER) as maxSameTrackPlays
            FROM day_track_counts
            GROUP BY playDate
        ),
        day_agg AS (
            SELECT
                CAST(playDate AS VARCHAR) as date,
                CAST(MAX(dateEpochMs) AS BIGINT) as dateEpochMs,
                CAST(COUNT(*) AS INTEGER) as playCount,
                CAST(SUM(msPlayed) / 60000.0 AS DOUBLE) as totalMinutes,
                CAST(COUNT(DISTINCT artist) AS INTEGER) as uniqueArtists,
                CAST(COUNT(DISTINCT trackKey) AS INTEGER) as uniqueTracks,
                -- Averaging the 1/0/NULL columns directly: AVG ignores NULLs, so
                -- each rate is over the plays whose service actually recorded
                -- the flag, and a Deezer-only day reports none rather than zero.
                CAST(AVG(isShuffle) AS DOUBLE) as shuffleRateRaw,
                CAST(
                    AVG(CASE WHEN reasonEnd IS NULL THEN NULL WHEN reasonEnd IN ('fwdbtn', 'backbtn', 'endplay') THEN 1.0 ELSE 0.0 END)
                    AS DOUBLE
                ) as intentionalStopRateRaw,
                CAST(
                    AVG(CASE WHEN reasonStart IS NULL THEN NULL WHEN reasonStart IN ('clickrow', 'playbtn', 'fwdbtn', 'backbtn') THEN 1.0 ELSE 0.0 END)
                    AS DOUBLE
                ) as intentionalStartRateRaw,
                CAST(AVG(isSkipped) AS DOUBLE) as skipRateRaw,
                CAST(AVG(CASE WHEN hourOfDay >= 19 OR hourOfDay <= 5 THEN 1.0 ELSE 0.0 END) AS DOUBLE) as eveningRateRaw,
                CAST(AVG(hourOfDay) AS DOUBLE) as meanListenHourRaw,
                CASE
                    WHEN COUNT(DISTINCT trackKey) = 0 THEN 0.0
                    ELSE CAST(COUNT(*) AS DOUBLE) / COUNT(DISTINCT trackKey)
                END as repeatIntensityRaw,
                playDate
            FROM base
            GROUP BY playDate
        )
        SELECT
            d.date,
            d.dateEpochMs,
            d.playCount,
            d.totalMinutes,
            d.uniqueArtists,
            d.uniqueTracks,
            COALESCE(m.maxSameTrackPlays, 0) as maxSameTrackPlays,
            d.shuffleRateRaw,
            d.intentionalStopRateRaw,
            d.intentionalStartRateRaw,
            d.skipRateRaw,
            d.eveningRateRaw,
            d.meanListenHourRaw,
            d.repeatIntensityRaw
        FROM day_agg d
        LEFT JOIN day_track_max m ON d.playDate = m.playDate
        ORDER BY d.playDate ASC
    `;

    try {
        const result = await query<{
            date: DailyAnalysisData['date'];
            dateEpochMs: SqlNumber;
            playCount: SqlNumber;
            totalMinutes: SqlNumber;
            uniqueArtists: SqlNumber;
            uniqueTracks: SqlNumber;
            maxSameTrackPlays: SqlNumber;
            shuffleRateRaw: SqlNumber;
            intentionalStopRateRaw: SqlNumber;
            intentionalStartRateRaw: SqlNumber;
            skipRateRaw: SqlNumber;
            eveningRateRaw: SqlNumber;
            meanListenHourRaw: SqlNumber;
            repeatIntensityRaw: SqlNumber;
        }>(sql);
        return result.map((row) => ({
            date: row.date,
            dateEpochMs: Number(row.dateEpochMs) || 0,
            playCount: Number(row.playCount) || 0,
            totalMinutes: Number(row.totalMinutes) || 0,
            uniqueArtists: Number(row.uniqueArtists) || 0,
            uniqueTracks: Number(row.uniqueTracks) || 0,
            maxSameTrackPlays: Number(row.maxSameTrackPlays) || 0,
            shuffleRate: Math.round((Number(row.shuffleRateRaw) || 0) * 1000) / 10,
            intentionalStopRate: Math.round((Number(row.intentionalStopRateRaw) || 0) * 1000) / 10,
            intentionalStartRate:
                Math.round((Number(row.intentionalStartRateRaw) || 0) * 1000) / 10,
            skipRate: Math.round((Number(row.skipRateRaw) || 0) * 1000) / 10,
            eveningRate: Math.round((Number(row.eveningRateRaw) || 0) * 1000) / 10,
            meanListenHour: Math.round((Number(row.meanListenHourRaw) || 0) * 100) / 100,
            repeatIntensity: Math.round((Number(row.repeatIntensityRaw) || 0) * 1000) / 1000,
        }));
    } catch (error) {
        console.error('Error fetching daily analysis:', error);
        return [];
    }
}

/**
 * One row per day with anything on it, for the GitHub-style calendar heatmap.
 *
 * Days with no play are absent rather than zero — the heatmap draws only what
 * is there — so the row count doubles as "days you played something", which is
 * what the guide reports beside it.
 */
export async function getDailyListeningCalendar(
    measure: Measure,
    dateRange?: DateRange
): Promise<DailyCalendarPoint[]> {
    const sql = `
        SELECT
            CAST(date AS VARCHAR) as date,
            CAST(${measureSql(measure)} AS DOUBLE) as value
        FROM plays
        ${whereClause(['date IS NOT NULL', ...measureConditions(measure)], 'date', dateRange)}
        GROUP BY date
        ORDER BY date ASC
    `;

    try {
        const result = await query<{ date: string; value: SqlNumber }>(sql);
        return result.map((row) => ({
            date: row.date,
            value: Math.max(0, Number(row.value) || 0),
        }));
    } catch (error) {
        console.error('Error fetching daily listening calendar:', error);
        return [];
    }
}

export interface HourWeekdayCell {
    dow: number; // 0 = Sunday, DuckDB's DAYOFWEEK
    hour: number; // 0–23
    minutes: number;
    plays: number;
}

/**
 * Listening per (weekday, hour) — the constellation with its calendar axis folded
 * away, so every Monday 8am in the history lands in the same cell.
 */
export async function getHourWeekdayMinutes(dateRange?: DateRange): Promise<HourWeekdayCell[]> {
    const sql = `
        SELECT
            CAST(DAYOFWEEK(timestamp) AS INTEGER) as dow,
            CAST(HOUR(timestamp) AS INTEGER) as hour,
            CAST(SUM(ms_played) / 60000.0 AS DOUBLE) as minutes,
            CAST(COUNT(*) AS BIGINT) as plays
        FROM plays
        ${whereClause(['timestamp IS NOT NULL'], 'timestamp', dateRange)}
        GROUP BY dow, hour
        ORDER BY dow ASC, hour ASC
    `;

    try {
        const result = await query<{
            dow: SqlNumber;
            hour: SqlNumber;
            minutes: SqlNumber;
            plays: SqlNumber;
        }>(sql);
        return result.map((row) => ({
            dow: Number(row.dow) || 0,
            hour: Number(row.hour) || 0,
            minutes: Math.max(0, Number(row.minutes) || 0),
            plays: Number(row.plays) || 0,
        }));
    } catch (error) {
        console.error('Error fetching hour/weekday listening grid:', error);
        return [];
    }
}
