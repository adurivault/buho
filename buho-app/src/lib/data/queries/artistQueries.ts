import { query } from '../db';
import { type DateRange, whereClause } from './common';
import { buildWhereExceptMultiple } from './behaviorQueries';
import type { FilterState } from '$lib/types/filters';

export interface ArtistData {
    artist: string;
    minutes: number;
}

export interface ArtistMonthlyAlignedData {
    artist: string;
    monthIndex: number;
    minutes: number;
}

export interface ArtistMonthlyDurationData {
    artist: string;
    month: string;
    hours: number;
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


export interface ArtistSunburstRow {
    artist: string;
    album: string;
    track: string;
    minutes: number;
    playCount: number;
    trackUri: string | null; // spotify:track:<id> — pour ouvrir le titre sur Spotify
}

export async function getTopArtists(limit = 15, dateRange?: DateRange): Promise<ArtistData[]> {
    const sql = `
        SELECT
            artist_name as artist,
            CAST(SUM(ms_played) / 60000.0 AS INTEGER) as minutes
        FROM spotify_plays
        ${whereClause(['artist_name IS NOT NULL'], 'timestamp', dateRange)}
        GROUP BY artist_name
        ORDER BY SUM(ms_played) DESC
        LIMIT ${limit}
    `;

    const result = await query<any>(sql);
    return result.map(row => ({
        artist: row.artist,
        minutes: Number(row.minutes) || 0
    }));
}

export async function getTopArtistsMonthlyAligned(limit = 30, dateRange?: DateRange): Promise<ArtistMonthlyAlignedData[]> {
    const safeLimit = Math.max(1, Math.floor(limit));
    const filteredTopArtistsWhere = whereClause(
        ['artist_name IS NOT NULL', 'timestamp IS NOT NULL'],
        'timestamp',
        dateRange
    );
    const filteredArtistFirstDayWhere = whereClause(['p.timestamp IS NOT NULL'], 'p.timestamp', dateRange);
    const filteredMonthlyWhere = whereClause(['p.timestamp IS NOT NULL'], 'p.timestamp', dateRange);
    const sql = `
        WITH top_artists AS (
            SELECT 
                artist_name as artist,
                SUM(ms_played) as total_ms
            FROM spotify_plays
            ${filteredTopArtistsWhere}
            GROUP BY artist_name
            ORDER BY total_ms DESC
            LIMIT ${safeLimit}
        ),
        artist_first_day AS (
            SELECT
                p.artist_name as artist,
                DATE_TRUNC('day', MIN(p.timestamp)) as first_day
            FROM spotify_plays p
            INNER JOIN top_artists t ON p.artist_name = t.artist
            ${filteredArtistFirstDayWhere}
            GROUP BY p.artist_name
        )
        SELECT
            monthly.artist,
            monthly.monthIndex,
            CAST(SUM(monthly.ms_played) / 60000.0 AS INTEGER) as minutes
        FROM (
            SELECT
                p.artist_name as artist,
                CAST(
                    DATE_DIFF(
                        'month',
                        DATE_TRUNC('month', f.first_day),
                        DATE_TRUNC('month', p.timestamp)
                    ) AS INTEGER
                ) as monthIndex,
                p.ms_played as ms_played
            FROM spotify_plays p
            INNER JOIN artist_first_day f ON p.artist_name = f.artist
            ${filteredMonthlyWhere}
        ) monthly
        GROUP BY monthly.artist, monthly.monthIndex
        ORDER BY monthly.artist ASC, monthly.monthIndex ASC
    `;

    const result = await query<any>(sql);
    return result.map(row => ({
        artist: row.artist,
        monthIndex: Number(row.monthIndex) || 0,
        minutes: Number(row.minutes) || 0
    }));
}

export async function getTopArtistsMonthlyDuration(
    limit: number | null = null,
    dateRange?: DateRange
): Promise<ArtistMonthlyDurationData[]> {
    const hasLimit = limit !== null && Number.isFinite(limit) && Number(limit) > 0;
    const safeLimit = hasLimit ? Math.max(1, Math.floor(Number(limit))) : 0;
    const sql = hasLimit
        ? `
        WITH top_artists AS (
            SELECT
                artist_name as artist,
                SUM(ms_played) as total_ms
            FROM spotify_plays
            ${whereClause(
            ['artist_name IS NOT NULL', 'date IS NOT NULL', 'ms_played IS NOT NULL'],
            'date',
            dateRange
        )}
            GROUP BY artist_name
            ORDER BY total_ms DESC
            LIMIT ${safeLimit}
        )
        SELECT
            p.artist_name as artist,
            CAST(CAST(DATE_TRUNC('month', p.date) AS DATE) AS VARCHAR) as month,
            CAST(SUM(p.ms_played) / 3600000.0 AS DOUBLE) as hours
        FROM spotify_plays p
        INNER JOIN top_artists t ON p.artist_name = t.artist
        ${whereClause(['p.date IS NOT NULL', 'p.ms_played IS NOT NULL'], 'p.date', dateRange)}
        GROUP BY p.artist_name, DATE_TRUNC('month', p.date)
        ORDER BY DATE_TRUNC('month', p.date) ASC, hours DESC, p.artist_name ASC
    `
        : `
        SELECT
            artist_name as artist,
            CAST(CAST(DATE_TRUNC('month', date) AS DATE) AS VARCHAR) as month,
            CAST(SUM(ms_played) / 3600000.0 AS DOUBLE) as hours
        FROM spotify_plays
        ${whereClause(
            ['artist_name IS NOT NULL', 'date IS NOT NULL', 'ms_played IS NOT NULL'],
            'date',
            dateRange
        )}
        GROUP BY artist_name, DATE_TRUNC('month', date)
        ORDER BY DATE_TRUNC('month', date) ASC, hours DESC, artist_name ASC
    `;

    const result = await query<any>(sql);
    return result.map(row => ({
        artist: row.artist || 'Unknown',
        month: row.month || '',
        hours: Number(row.hours) || 0
    }));
}

export async function getArtistAnalysis(limit = 100, dateRange?: DateRange): Promise<ArtistAnalysisData[]> {
    const safeLimit = Math.max(1, Math.floor(limit));
    const sql = `
        WITH base AS (
            SELECT
                artist_name as artist,
                COALESCE(track_uri, '__unknown_track__') as trackKey,
                ms_played as msPlayed,
                CAST(epoch(timestamp) AS DOUBLE) as tsEpochSeconds,
                DATE(timestamp) as playDate,
                hour as hourOfDay,
                COALESCE(NULLIF(TRIM(reason_start), ''), 'unknown') as reasonStart,
                COALESCE(NULLIF(TRIM(reason_end), ''), 'unknown') as reasonEnd,
                CASE WHEN shuffle = true THEN 1 ELSE 0 END as isShuffle,
                CASE WHEN skipped = true THEN 1 ELSE 0 END as isSkipped
            FROM spotify_plays
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
                    AVG(CASE WHEN reasonEnd IN ('fwdbtn', 'backbtn', 'endplay') THEN 1.0 ELSE 0.0 END)
                    AS DOUBLE
                ) as intentionalStopRateRaw,
                CAST(AVG(CASE WHEN isSkipped = 1 THEN 1.0 ELSE 0.0 END) AS DOUBLE) as skipRateRaw,
                CAST(AVG(CASE WHEN isShuffle = 1 THEN 1.0 ELSE 0.0 END) AS DOUBLE) as shuffleRateRaw,
                CAST(
                    AVG(CASE WHEN reasonStart IN ('clickrow', 'playbtn', 'fwdbtn', 'backbtn') THEN 1.0 ELSE 0.0 END)
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

    const result = await query<any>(sql);
    return result.map(row => ({
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
        listenDateVarianceDays2: Math.round((Number(row.listenDateVarianceDays2Raw) || 0) * 1000) / 1000,
        eveningRate: Math.round((Number(row.eveningRateRaw) || 0) * 1000) / 10,
        repeatIntensity: Math.round((Number(row.repeatIntensityRaw) || 0) * 1000) / 1000,
        recencyDays: Math.max(0, Math.round((Number(row.recencyDaysRaw) || 0) * 10) / 10)
    }));
}


export async function getArtistAlbumTrackSunburst(dateRange?: DateRange): Promise<ArtistSunburstRow[]> {
    // Agrégat complet artiste/album/titre, sans regroupement : le bucket "Other"
    // dépend du niveau affiché (1° de la vue courante) et est calculé côté client
    // au moment du zoom, cf. bucketSunburstTree.
    const sql = `
        SELECT
            artist_name as artist,
            COALESCE(album_name, 'Unknown album') as album,
            COALESCE(track_name, 'Unknown track') as track,
            CAST(SUM(ms_played) / 60000.0 AS DOUBLE) as minutes,
            CAST(COUNT(*) AS INTEGER) as playCount,
            ANY_VALUE(track_uri) as trackUri
        FROM spotify_plays
        ${whereClause(['artist_name IS NOT NULL', 'ms_played IS NOT NULL'], 'timestamp', dateRange)}
        GROUP BY artist_name, album, track
        ORDER BY SUM(ms_played) DESC
    `;

    const result = await query<any>(sql);
    return result.map(row => ({
        artist: row.artist || 'Unknown',
        album: row.album || 'Unknown album',
        track: row.track || 'Unknown track',
        minutes: Number(row.minutes) || 0,
        playCount: Number(row.playCount) || 0,
        trackUri: row.trackUri ?? null
    }));
}

/**
 * Sunburst pour le mode Explorer : applique tous les filtres actifs SAUF
 * artist/album/track (les dimensions que le sunburst contrôle lui-même), afin
 * de conserver la hiérarchie complète et de pouvoir mettre en valeur / atténuer
 * la sélection — même pattern que BarChartSatellite.
 */
export async function getArtistSunburstFiltered(filters: FilterState = {}): Promise<ArtistSunburstRow[]> {
    const where = buildWhereExceptMultiple(filters, ['artist_name', 'album_name', 'track_name']);
    const sql = `
        SELECT
            artist_name as artist,
            COALESCE(album_name, 'Unknown album') as album,
            COALESCE(track_name, 'Unknown track') as track,
            CAST(SUM(ms_played) / 60000.0 AS DOUBLE) as minutes,
            CAST(COUNT(*) AS INTEGER) as playCount,
            ANY_VALUE(track_uri) as trackUri
        FROM spotify_plays
        ${where}
          AND artist_name IS NOT NULL
          AND ms_played IS NOT NULL
        GROUP BY artist_name, album, track
        ORDER BY SUM(ms_played) DESC
    `;

    try {
        const result = await query<any>(sql);
        return result.map(row => ({
            artist: row.artist || 'Unknown',
            album: row.album || 'Unknown album',
            track: row.track || 'Unknown track',
            minutes: Number(row.minutes) || 0,
            playCount: Number(row.playCount) || 0,
            trackUri: row.trackUri ?? null
        }));
    } catch (error) {
        console.error('Error fetching filtered artist sunburst:', error);
        return [];
    }
}
