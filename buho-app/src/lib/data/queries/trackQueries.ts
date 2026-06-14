import { query } from '../db';
import { type DateRange, whereClause } from './common';

export interface TrackData {
    track: string;
    artist: string;
    plays: number;
    minutes: number;
}

export interface TrackAnalysisData {
    artist: string;
    track: string;
    playCount: number;
    totalMinutes: number;
    intentionalityRate: number;
    skipRate: number;
    recencyDays: number;
    maxSameDayPlays: number;
    artistPrevalenceRate: number;
    activeDays: number;
}

export interface TrackMonthlyDurationData {
    track: string;
    artist: string;
    item: string;
    month: string;
    hours: number;
}

export async function getTopTracks(limit = 15, dateRange?: DateRange): Promise<TrackData[]> {
    const sql = `
        SELECT
            track_name as track,
            artist_name as artist,
            CAST(COUNT(*) AS INTEGER) as plays,
            CAST(SUM(ms_played) / 60000.0 AS INTEGER) as minutes
        FROM spotify_plays
        ${whereClause(['track_name IS NOT NULL'], 'timestamp', dateRange)}
        GROUP BY track_name, artist_name
        ORDER BY COUNT(*) DESC
        LIMIT ${limit}
    `;

    try {
        const result = await query<any>(sql);
        return result.map(row => ({
            track: row.track,
            artist: row.artist || 'Unknown',
            plays: Number(row.plays) || 0,
            minutes: Number(row.minutes) || 0
        }));
    } catch (error) {
        console.error('Error fetching top tracks:', error);
        return [];
    }
}

export async function getTrackAnalysis(limit = 3000, dateRange?: DateRange): Promise<TrackAnalysisData[]> {
    const safeLimit = Math.max(1, Math.floor(limit));
    const sql = `
        WITH base AS (
            SELECT
                artist_name as artist,
                track_name as track,
                DATE(timestamp) as playDate,
                CAST(epoch(timestamp) AS DOUBLE) as tsEpochSeconds,
                ms_played as msPlayed,
                COALESCE(NULLIF(TRIM(reason_start), ''), 'unknown') as reasonStart,
                CASE WHEN skipped = true THEN 1 ELSE 0 END as isSkipped
            FROM spotify_plays
            ${whereClause(
        ['artist_name IS NOT NULL', 'track_name IS NOT NULL', 'timestamp IS NOT NULL', 'ms_played IS NOT NULL'],
        'timestamp',
        dateRange
    )}
        ),
        bounds AS (
            SELECT MAX(tsEpochSeconds) as maxTsEpochSeconds
            FROM base
        ),
        artist_totals AS (
            SELECT
                artist,
                CAST(COUNT(*) AS DOUBLE) as artistPlayCount
            FROM base
            GROUP BY artist
        ),
        track_day_counts AS (
            SELECT
                artist,
                track,
                playDate,
                CAST(COUNT(*) AS INTEGER) as dayPlayCount
            FROM base
            GROUP BY artist, track, playDate
        ),
        track_day_max AS (
            SELECT
                artist,
                track,
                CAST(MAX(dayPlayCount) AS INTEGER) as maxSameDayPlays
            FROM track_day_counts
            GROUP BY artist, track
        ),
        track_core AS (
            SELECT
                artist,
                track,
                CAST(COUNT(*) AS INTEGER) as playCount,
                CAST(SUM(msPlayed) / 60000.0 AS DOUBLE) as totalMinutes,
                CAST(
                    AVG(CASE WHEN reasonStart IN ('clickrow', 'playbtn', 'fwdbtn', 'backbtn') THEN 1.0 ELSE 0.0 END)
                    AS DOUBLE
                ) as intentionalityRateRaw,
                CAST(AVG(CASE WHEN isSkipped = 1 THEN 1.0 ELSE 0.0 END) AS DOUBLE) as skipRateRaw,
                CAST(COUNT(DISTINCT playDate) AS INTEGER) as activeDaysRaw,
                CAST(MAX(tsEpochSeconds) AS DOUBLE) as lastListenEpochSecondsRaw
            FROM base
            GROUP BY artist, track
        )
        SELECT
            c.artist as artist,
            c.track as track,
            c.playCount as playCount,
            c.totalMinutes as totalMinutes,
            c.intentionalityRateRaw as intentionalityRateRaw,
            c.skipRateRaw as skipRateRaw,
            c.activeDaysRaw as activeDaysRaw,
            COALESCE(m.maxSameDayPlays, 0) as maxSameDayPlays,
            CASE
                WHEN a.artistPlayCount = 0 THEN 0.0
                ELSE c.playCount / a.artistPlayCount
            END as artistPrevalenceRateRaw,
            CASE
                WHEN b.maxTsEpochSeconds IS NULL OR c.lastListenEpochSecondsRaw IS NULL THEN 0.0
                ELSE (b.maxTsEpochSeconds - c.lastListenEpochSecondsRaw) / 86400.0
            END as recencyDaysRaw
        FROM track_core c
        INNER JOIN artist_totals a ON c.artist = a.artist
        LEFT JOIN track_day_max m ON c.artist = m.artist AND c.track = m.track
        CROSS JOIN bounds b
        ORDER BY c.playCount DESC, c.totalMinutes DESC
        LIMIT ${safeLimit}
    `;

    try {
        const result = await query<any>(sql);
        return result.map(row => ({
            artist: row.artist || 'Unknown',
            track: row.track || 'Unknown',
            playCount: Number(row.playCount) || 0,
            totalMinutes: Number(row.totalMinutes) || 0,
            intentionalityRate: Math.round((Number(row.intentionalityRateRaw) || 0) * 1000) / 10,
            skipRate: Math.round((Number(row.skipRateRaw) || 0) * 1000) / 10,
            recencyDays: Math.max(0, Math.round((Number(row.recencyDaysRaw) || 0) * 10) / 10),
            maxSameDayPlays: Number(row.maxSameDayPlays) || 0,
            artistPrevalenceRate: Math.round((Number(row.artistPrevalenceRateRaw) || 0) * 1000) / 10,
            activeDays: Number(row.activeDaysRaw) || 0
        }));
    } catch (error) {
        console.error('Error fetching track analysis:', error);
        return [];
    }
}

export async function getTopTracksMonthlyDuration(
    limit: number | null = null,
    dateRange?: DateRange
): Promise<TrackMonthlyDurationData[]> {
    const hasLimit = limit !== null && Number.isFinite(limit) && Number(limit) > 0;
    const safeLimit = hasLimit ? Math.max(1, Math.floor(Number(limit))) : 0;
    const sql = hasLimit
        ? `
        WITH top_tracks AS (
            SELECT
                track_name as track,
                artist_name as artist,
                SUM(ms_played) as total_ms
            FROM spotify_plays
            ${whereClause(
                ['track_name IS NOT NULL', 'artist_name IS NOT NULL', 'date IS NOT NULL', 'ms_played IS NOT NULL'],
                'date',
                dateRange
            )}
            GROUP BY track_name, artist_name
            ORDER BY total_ms DESC
            LIMIT ${safeLimit}
        )
        SELECT
            p.track_name as track,
            p.artist_name as artist,
            CAST(CAST(DATE_TRUNC('month', p.date) AS DATE) AS VARCHAR) as month,
            CAST(SUM(p.ms_played) / 3600000.0 AS DOUBLE) as hours
        FROM spotify_plays p
        INNER JOIN top_tracks t ON p.track_name = t.track AND p.artist_name = t.artist
        ${whereClause(
            ['p.track_name IS NOT NULL', 'p.artist_name IS NOT NULL', 'p.date IS NOT NULL', 'p.ms_played IS NOT NULL'],
            'p.date',
            dateRange
        )}
        GROUP BY p.track_name, p.artist_name, DATE_TRUNC('month', p.date)
        ORDER BY DATE_TRUNC('month', p.date) ASC, hours DESC, p.track_name ASC, p.artist_name ASC
    `
        : `
        SELECT
            track_name as track,
            artist_name as artist,
            CAST(CAST(DATE_TRUNC('month', date) AS DATE) AS VARCHAR) as month,
            CAST(SUM(ms_played) / 3600000.0 AS DOUBLE) as hours
        FROM spotify_plays
        ${whereClause(
            ['track_name IS NOT NULL', 'artist_name IS NOT NULL', 'date IS NOT NULL', 'ms_played IS NOT NULL'],
            'date',
            dateRange
        )}
        GROUP BY track_name, artist_name, DATE_TRUNC('month', date)
        ORDER BY DATE_TRUNC('month', date) ASC, hours DESC, track_name ASC, artist_name ASC
    `;

    try {
        const result = await query<any>(sql);
        return result.map(row => {
            const track = row.track || 'Unknown';
            const artist = row.artist || 'Unknown';
            return {
                track,
                artist,
                item: `${track} — ${artist}`,
                month: row.month || '',
                hours: Number(row.hours) || 0
            };
        });
    } catch (error) {
        console.error('Error fetching top tracks monthly duration:', error);
        return [];
    }
}
