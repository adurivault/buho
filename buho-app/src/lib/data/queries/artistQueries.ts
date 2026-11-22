import { query } from '../db';
import { trackKeySql } from '../sql/trackKey';
import { measureConditions, measureSql, type Measure } from '../sql/measure';
import { type DateRange, whereClause, type SqlNumber, type SqlText } from './common';
import { buildWhereExceptMultiple } from './behaviorQueries';
import type { FilterState } from '#lib/types/filters.ts';

export interface ArtistMonthlyPoint {
    artist: string;
    month: string;
    /** In the unit of the measure it was asked for — minutes, or plays. */
    value: number;
}

export interface ArtistAnalysisData {
    artist: string;
    totalMinutes: number;
    playCount: number;
    uniqueTracks: number;
    intentionalStopRate: number;
    shuffleRate: number;
    intentionalStartRate: number;
    meanListenDateEpochMs: number;
    listenDateVarianceDays2: number;
    eveningRate: number;
    recencyDays: number;
    activeDays: number;
    skipRate: number;
    repeatIntensity: number;
}

/** A sunburst row as the SQL returns it, before defaults fill the gaps. */
interface ArtistSunburstSqlRow {
    artist: SqlText;
    album: SqlText;
    track: SqlText;
    minutes: SqlNumber;
    playCount: SqlNumber;
    trackUri: SqlText;
}

export interface ArtistSunburstRow {
    artist: string;
    album: string;
    track: string;
    minutes: number;
    playCount: number;
    trackUri: string | null; // spotify:track:<id> — to open the track on Spotify
}

/**
 * Per artist, what each of their months was worth — behind both the bar chart
 * race and the ridgeline, which are the same numbers accumulating and not.
 *
 * @param limit how many artists to keep, ranked by their total; null for all.
 */
export async function getTopArtistsMonthly(
    limit: number | null = null,
    measure: Measure = 'minutes',
    dateRange?: DateRange
): Promise<ArtistMonthlyPoint[]> {
    const hasLimit = limit !== null && Number.isFinite(limit) && Number(limit) > 0;
    const safeLimit = hasLimit ? Math.max(1, Math.floor(Number(limit))) : 0;
    const total = measureSql(measure);
    const monthly = measureSql(measure, 'p.');
    const base = ['artist_name IS NOT NULL', 'date IS NOT NULL', ...measureConditions(measure)];

    const sql = hasLimit
        ? `
        WITH top_artists AS (
            SELECT
                artist_name as artist,
                ${total} as total
            FROM plays
            ${whereClause(base, 'date', dateRange)}
            GROUP BY artist_name
            ORDER BY total DESC
            LIMIT ${safeLimit}
        )
        SELECT
            p.artist_name as artist,
            CAST(CAST(DATE_TRUNC('month', p.date) AS DATE) AS VARCHAR) as month,
            CAST(${monthly} AS DOUBLE) as value
        FROM plays p
        INNER JOIN top_artists t ON p.artist_name = t.artist
        ${whereClause(['p.date IS NOT NULL', ...measureConditions(measure, 'p.')], 'p.date', dateRange)}
        GROUP BY p.artist_name, DATE_TRUNC('month', p.date)
        ORDER BY DATE_TRUNC('month', p.date) ASC, value DESC, p.artist_name ASC
    `
        : `
        SELECT
            artist_name as artist,
            CAST(CAST(DATE_TRUNC('month', date) AS DATE) AS VARCHAR) as month,
            CAST(${total} AS DOUBLE) as value
        FROM plays
        ${whereClause(base, 'date', dateRange)}
        GROUP BY artist_name, DATE_TRUNC('month', date)
        ORDER BY DATE_TRUNC('month', date) ASC, value DESC, artist_name ASC
    `;

    const result = await query<{ artist: SqlText; month: SqlText; value: SqlNumber }>(sql);
    return result.map((row) => ({
        artist: row.artist || 'Unknown',
        month: row.month || '',
        value: Number(row.value) || 0,
    }));
}

export async function getArtistAnalysis(
    limit = 100,
    dateRange?: DateRange
): Promise<ArtistAnalysisData[]> {
    const safeLimit = Math.max(1, Math.floor(limit));
    const sql = `
        WITH base AS (
            SELECT
                artist_name as artist,
                ${trackKeySql()} as trackKey,
                ms_played as msPlayed,
                CAST(epoch(timestamp) AS DOUBLE) as tsEpochSeconds,
                DATE(timestamp) as playDate,
                hour(timestamp) as hourOfDay,
                -- Left NULL where the service records none, so the rates below
                -- average over the plays that can answer rather than over all.
                NULLIF(TRIM(reason_start), '') as reasonStart,
                NULLIF(TRIM(reason_end), '') as reasonEnd,
                CASE WHEN shuffle IS NULL THEN NULL WHEN shuffle THEN 1 ELSE 0 END as isShuffle,
                CASE WHEN skipped IS NULL THEN NULL WHEN skipped THEN 1 ELSE 0 END as isSkipped
            FROM plays
            ${whereClause(['artist_name IS NOT NULL', 'ms_played IS NOT NULL', 'timestamp IS NOT NULL'], 'timestamp', dateRange)}
        ),
        bounds AS (
            SELECT MAX(tsEpochSeconds) as maxTsEpochSeconds
            FROM base
        ),
        artist_core AS (
            SELECT
                artist,
                CAST(SUM(msPlayed) / 60000.0 AS DOUBLE) as totalMinutes,
                CAST(COUNT(*) AS INTEGER) as playCount,
                CAST(COUNT(DISTINCT trackKey) AS INTEGER) as uniqueTrackCount,
                CAST(COUNT(DISTINCT playDate) AS INTEGER) as activeDaysRaw,
                CAST(MAX(tsEpochSeconds) AS DOUBLE) as lastListenEpochSecondsRaw,
                CAST(
                    AVG(CASE WHEN reasonEnd IS NULL THEN NULL WHEN reasonEnd IN ('fwdbtn', 'backbtn', 'endplay') THEN 1.0 ELSE 0.0 END)
                    AS DOUBLE
                ) as intentionalStopRateRaw,
                CAST(AVG(isSkipped) AS DOUBLE) as skipRateRaw,
                CAST(AVG(isShuffle) AS DOUBLE) as shuffleRateRaw,
                CAST(
                    AVG(CASE WHEN reasonStart IS NULL THEN NULL WHEN reasonStart IN ('clickrow', 'playbtn', 'fwdbtn', 'backbtn') THEN 1.0 ELSE 0.0 END)
                    AS DOUBLE
                ) as intentionalStartRateRaw,
                CAST(AVG(tsEpochSeconds) AS DOUBLE) as meanListenEpochSecondsRaw,
                CAST(VAR_POP(tsEpochSeconds / 86400.0) AS DOUBLE) as listenDateVarianceDays2Raw,
                CAST(
                    AVG(CASE WHEN hourOfDay >= 19 OR hourOfDay <= 5 THEN 1.0 ELSE 0.0 END)
                    AS DOUBLE
                ) as eveningRateRaw
            FROM base
            GROUP BY artist
        )
        SELECT
            c.artist as artist,
            c.totalMinutes as totalMinutes,
            c.playCount as playCount,
            c.uniqueTrackCount as uniqueTracksRaw,
            c.activeDaysRaw as activeDaysRaw,
            c.intentionalStopRateRaw as intentionalStopRateRaw,
            c.skipRateRaw as skipRateRaw,
            c.shuffleRateRaw as shuffleRateRaw,
            c.intentionalStartRateRaw as intentionalStartRateRaw,
            c.meanListenEpochSecondsRaw as meanListenEpochSecondsRaw,
            c.listenDateVarianceDays2Raw as listenDateVarianceDays2Raw,
            c.eveningRateRaw as eveningRateRaw,
            CASE
                WHEN c.uniqueTrackCount = 0 THEN 0.0
                ELSE CAST(c.playCount AS DOUBLE) / c.uniqueTrackCount
            END as repeatIntensityRaw,
            CASE
                WHEN b.maxTsEpochSeconds IS NULL OR c.lastListenEpochSecondsRaw IS NULL THEN 0.0
                ELSE (b.maxTsEpochSeconds - c.lastListenEpochSecondsRaw) / 86400.0
            END as recencyDaysRaw
        FROM artist_core c
        CROSS JOIN bounds b
        ORDER BY c.totalMinutes DESC
        LIMIT ${safeLimit}
    `;

    const result = await query<{
        artist: SqlText;
        totalMinutes: SqlNumber;
        playCount: SqlNumber;
        uniqueTracksRaw: SqlNumber;
        activeDaysRaw: SqlNumber;
        intentionalStopRateRaw: SqlNumber;
        skipRateRaw: SqlNumber;
        shuffleRateRaw: SqlNumber;
        intentionalStartRateRaw: SqlNumber;
        meanListenEpochSecondsRaw: SqlNumber;
        listenDateVarianceDays2Raw: SqlNumber;
        eveningRateRaw: SqlNumber;
        repeatIntensityRaw: SqlNumber;
        recencyDaysRaw: SqlNumber;
    }>(sql);
    return result.map((row) => ({
        artist: row.artist || 'Unknown',
        totalMinutes: Number(row.totalMinutes) || 0,
        playCount: Number(row.playCount) || 0,
        uniqueTracks: Number(row.uniqueTracksRaw) || 0,
        activeDays: Number(row.activeDaysRaw) || 0,
        intentionalStopRate: Math.round((Number(row.intentionalStopRateRaw) || 0) * 1000) / 10,
        skipRate: Math.round((Number(row.skipRateRaw) || 0) * 1000) / 10,
        shuffleRate: Math.round((Number(row.shuffleRateRaw) || 0) * 1000) / 10,
        intentionalStartRate: Math.round((Number(row.intentionalStartRateRaw) || 0) * 1000) / 10,
        meanListenDateEpochMs: Math.round((Number(row.meanListenEpochSecondsRaw) || 0) * 1000),
        listenDateVarianceDays2:
            Math.round((Number(row.listenDateVarianceDays2Raw) || 0) * 1000) / 1000,
        eveningRate: Math.round((Number(row.eveningRateRaw) || 0) * 1000) / 10,
        repeatIntensity: Math.round((Number(row.repeatIntensityRaw) || 0) * 1000) / 1000,
        recencyDays: Math.max(0, Math.round((Number(row.recencyDaysRaw) || 0) * 10) / 10),
    }));
}

/**
 * Sunburst for the Explorer mode: applies all active filters EXCEPT
 * artist/album/track (the dimensions the sunburst controls itself), in order to
 * keep the full hierarchy and be able to highlight / dim the selection.
 */
export async function getArtistSunburstFiltered(
    filters: FilterState = {}
): Promise<ArtistSunburstRow[]> {
    const where = buildWhereExceptMultiple(filters, ['artist_name', 'album_name', 'track_name']);
    const sql = `
        SELECT
            artist_name as artist,
            COALESCE(album_name, 'Unknown album') as album,
            COALESCE(track_name, 'Unknown track') as track,
            CAST(COALESCE(SUM(ms_played), 0) / 60000.0 AS DOUBLE) as minutes,
            CAST(COUNT(*) AS INTEGER) as playCount,
            ANY_VALUE(track_uri) as trackUri
        FROM plays
        ${where}
          AND artist_name IS NOT NULL
        GROUP BY artist_name, album, track
        ORDER BY SUM(ms_played) DESC
    `;

    try {
        const result = await query<ArtistSunburstSqlRow>(sql);
        return result.map((row) => ({
            artist: row.artist || 'Unknown',
            album: row.album || 'Unknown album',
            track: row.track || 'Unknown track',
            minutes: Number(row.minutes) || 0,
            playCount: Number(row.playCount) || 0,
            trackUri: row.trackUri ?? null,
        }));
    } catch (error) {
        console.error('Error fetching filtered artist sunburst:', error);
        return [];
    }
}
