import { query } from '../db';
import { type DateRange, whereClause } from './common';

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

export interface ListeningProgressPlayData {
    date: string;
    score: number;
    msPlayed: number;
    refDurationMs: number;
}

export interface DailyCalendarPoint {
    date: string;    // YYYY-MM-DD
    minutes: number;
}

export interface TracklistSizePoint {
    date: string;
    tracklistSize: number;
}

export async function getDailyAnalysis(dateRange?: DateRange): Promise<DailyAnalysisData[]> {
    const sql = `
        WITH base AS (
            SELECT
                DATE(timestamp) as playDate,
                CAST(epoch(DATE(timestamp)) * 1000 AS BIGINT) as dateEpochMs,
                ms_played as msPlayed,
                artist_name as artist,
                COALESCE(track_uri, '__unknown_track__') as trackKey,
                COALESCE(NULLIF(TRIM(reason_start), ''), 'unknown') as reasonStart,
                COALESCE(NULLIF(TRIM(reason_end), ''), 'unknown') as reasonEnd,
                hour(timestamp) as hourOfDay,
                CASE WHEN shuffle = true THEN 1 ELSE 0 END as isShuffle,
                CASE WHEN skipped = true THEN 1 ELSE 0 END as isSkipped
            FROM spotify_plays
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
                CAST(AVG(CASE WHEN isShuffle = 1 THEN 1.0 ELSE 0.0 END) AS DOUBLE) as shuffleRateRaw,
                CAST(
                    AVG(CASE WHEN reasonEnd IN ('fwdbtn', 'backbtn', 'endplay') THEN 1.0 ELSE 0.0 END)
                    AS DOUBLE
                ) as intentionalStopRateRaw,
                CAST(
                    AVG(CASE WHEN reasonStart IN ('clickrow', 'playbtn', 'fwdbtn', 'backbtn') THEN 1.0 ELSE 0.0 END)
                    AS DOUBLE
                ) as intentionalStartRateRaw,
                CAST(AVG(CASE WHEN isSkipped = 1 THEN 1.0 ELSE 0.0 END) AS DOUBLE) as skipRateRaw,
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
        const result = await query<any>(sql);
        return result.map(row => ({
            date: row.date,
            dateEpochMs: Number(row.dateEpochMs) || 0,
            playCount: Number(row.playCount) || 0,
            totalMinutes: Number(row.totalMinutes) || 0,
            uniqueArtists: Number(row.uniqueArtists) || 0,
            uniqueTracks: Number(row.uniqueTracks) || 0,
            maxSameTrackPlays: Number(row.maxSameTrackPlays) || 0,
            shuffleRate: Math.round((Number(row.shuffleRateRaw) || 0) * 1000) / 10,
            intentionalStopRate: Math.round((Number(row.intentionalStopRateRaw) || 0) * 1000) / 10,
            intentionalStartRate: Math.round((Number(row.intentionalStartRateRaw) || 0) * 1000) / 10,
            skipRate: Math.round((Number(row.skipRateRaw) || 0) * 1000) / 10,
            eveningRate: Math.round((Number(row.eveningRateRaw) || 0) * 1000) / 10,
            meanListenHour: Math.round((Number(row.meanListenHourRaw) || 0) * 100) / 100,
            repeatIntensity: Math.round((Number(row.repeatIntensityRaw) || 0) * 1000) / 1000
        }));
    } catch (error) {
        console.error('Error fetching daily analysis:', error);
        return [];
    }
}

export async function getListeningProgressPlays(dateRange?: DateRange): Promise<ListeningProgressPlayData[]> {
    const sql = `
        WITH base AS (
            SELECT
                DATE(timestamp) as playDate,
                track_uri as trackUri,
                CAST(ms_played AS DOUBLE) as msPlayed,
                COALESCE(NULLIF(TRIM(reason_end), ''), 'unknown') as reasonEnd,
                CASE WHEN skipped = true THEN 1 ELSE 0 END as isSkipped
            FROM spotify_plays
            ${whereClause(
        ['timestamp IS NOT NULL', 'track_uri IS NOT NULL', 'ms_played IS NOT NULL', 'ms_played > 0'],
        'timestamp',
        dateRange
    )}
        ),
        track_stats AS (
            SELECT
                trackUri,
                CAST(COUNT(*) AS INTEGER) as playCount,
                CAST(
                    COUNT(*) FILTER (WHERE reasonEnd = 'trackdone' AND isSkipped = 0)
                    AS INTEGER
                ) as fullPlayCount,
                CAST(
                    quantile_cont(msPlayed, 0.85) FILTER (WHERE reasonEnd = 'trackdone' AND isSkipped = 0)
                    AS DOUBLE
                ) as fullQ85,
                CAST(quantile_cont(msPlayed, 0.95) AS DOUBLE) as allQ95,
                CAST(MAX(msPlayed) AS DOUBLE) as allMax
            FROM base
            GROUP BY trackUri
        ),
        scored AS (
            SELECT
                CAST(b.playDate AS VARCHAR) as date,
                b.msPlayed as msPlayed,
                b.refDuration as refDuration,
                CASE
                    WHEN refDuration <= 0 THEN 0.0
                    ELSE LEAST(1.0, GREATEST(0.0, b.msPlayed / refDuration))
                END as score
            FROM (
                SELECT
                    b.playDate,
                    b.msPlayed,
                    CASE
                        WHEN s.fullPlayCount >= 3 AND s.fullQ85 IS NOT NULL THEN s.fullQ85
                        WHEN s.playCount >= 8 AND s.allQ95 IS NOT NULL THEN s.allQ95
                        WHEN s.allMax IS NOT NULL THEN s.allMax
                        ELSE 0.0
                    END as refDuration
                FROM base b
                INNER JOIN track_stats s ON b.trackUri = s.trackUri
            ) b
        )
        SELECT
            date,
            score,
            msPlayed,
            refDuration
        FROM scored
        ORDER BY date ASC
    `;

    try {
        const result = await query<any>(sql);
        return result.map(row => ({
            date: row.date,
            score: Math.max(0, Math.min(1, Number(row.score) || 0)),
            msPlayed: Math.max(0, Number(row.msPlayed) || 0),
            refDurationMs: Math.max(0, Number(row.refDuration) || 0)
        }));
    } catch (error) {
        console.error('Error fetching listening progress plays:', error);
        return [];
    }
}

/**
 * Daily total listening minutes, for the GitHub-style calendar heatmap.
 */
export async function getDailyListeningCalendar(dateRange?: DateRange): Promise<DailyCalendarPoint[]> {
    const sql = `
        SELECT
            CAST(date AS VARCHAR) as date,
            CAST(SUM(ms_played) / 60000.0 AS DOUBLE) as minutes
        FROM spotify_plays
        ${whereClause(['date IS NOT NULL', 'ms_played IS NOT NULL'], 'date', dateRange)}
        GROUP BY date
        ORDER BY date ASC
    `;

    try {
        const result = await query<any>(sql);
        return result.map(row => ({
            date: row.date,
            minutes: Math.max(0, Number(row.minutes) || 0)
        }));
    } catch (error) {
        console.error('Error fetching daily listening calendar:', error);
        return [];
    }
}

export async function getTracklistSizeOverTime(
    minPlays = 5,
    windowMonths = 3,
    dateRange?: DateRange
): Promise<TracklistSizePoint[]> {
    const safeMinPlays = Math.max(1, Math.floor(minPlays));
    const safeWindowMonths = Math.max(1, Math.floor(windowMonths));

    const sql = `
        WITH plays AS (
            SELECT
                DATE(timestamp) as playDate,
                COALESCE(
                    NULLIF(TRIM(track_uri), ''),
                    CONCAT(
                        COALESCE(NULLIF(TRIM(track_name), ''), '__unknown_track__'),
                        '::',
                        COALESCE(NULLIF(TRIM(artist_name), ''), '__unknown_artist__')
                    )
                ) as trackKey
            FROM spotify_plays
            ${whereClause(
        [
            'timestamp IS NOT NULL',
            '(track_uri IS NOT NULL OR track_name IS NOT NULL)'
        ],
        'timestamp',
        dateRange
    )}
        ),
        calendar AS (
            SELECT DISTINCT playDate
            FROM plays
        ),
        rolling_counts AS (
            SELECT
                c.playDate as date,
                p.trackKey as trackKey,
                CAST(COUNT(*) AS INTEGER) as playCount
            FROM calendar c
            INNER JOIN plays p
                ON p.playDate BETWEEN c.playDate - INTERVAL '${safeWindowMonths} months' AND c.playDate
            GROUP BY c.playDate, p.trackKey
        )
        SELECT
            CAST(date AS VARCHAR) as date,
            CAST(COUNT(*) FILTER (WHERE playCount > ${safeMinPlays}) AS INTEGER) as tracklistSize
        FROM rolling_counts
        GROUP BY date
        ORDER BY date ASC
    `;

    try {
        const result = await query<any>(sql);
        return result.map(row => ({
            date: row.date,
            tracklistSize: Math.max(0, Number(row.tracklistSize) || 0)
        }));
    } catch (error) {
        console.error('Error fetching tracklist size over time:', error);
        return [];
    }
}
