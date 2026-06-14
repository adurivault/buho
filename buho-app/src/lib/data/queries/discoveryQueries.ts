import { query } from '../db';
import { type DateRange, whereClause } from './common';

export interface MonthlyCohortPoint {
    month: string;   // YYYY-MM-DD (first day of the listening month)
    cohort: string;  // YYYY-MM-DD (first day of the month the track was discovered)
    plays: number;
}

export interface ArtistDiscoveryRecencyData {
    artist: string;
    firstDate: string;   // YYYY-MM-DD
    lastDate: string;    // YYYY-MM-DD
    plays: number;
    minutes: number;
}

export interface TrackObsessionData {
    track: string;
    artist: string;
    totalPlays: number;
    peakWeek: string;       // YYYY-MM-DD (start of the most intense week)
    peakWeekPlays: number;  // plays during that week
    firstWeek: string;      // YYYY-MM-DD
    lastWeek: string;       // YYYY-MM-DD
    concentration: number;  // peakWeekPlays / totalPlays (0..1)
}

/**
 * Monthly listening volume, split by the *discovery cohort* of each played track — the month
 * the track was first ever heard. Unlike recency, a track's cohort never changes, so a song
 * discovered in 2018 keeps its colour forever: old discoveries settle as deep sediment layers
 * at the bottom, fresh discoveries pile bright on top. The discovery month is computed against
 * the global first listen (not the filtered range) so cohorts stay stable when the slider moves.
 */
export async function getMonthlyDiscoveryCohorts(dateRange?: DateRange): Promise<MonthlyCohortPoint[]> {
    const trackKey = (prefix: string) => `COALESCE(
        NULLIF(TRIM(${prefix}track_uri), ''),
        CONCAT(COALESCE(NULLIF(TRIM(${prefix}track_name), ''), '__t__'), '::', COALESCE(NULLIF(TRIM(${prefix}artist_name), ''), '__a__'))
    )`;
    const sql = `
        WITH track_first AS (
            SELECT
                ${trackKey('')} as trackKey,
                DATE_TRUNC('month', MIN(date)) as cohort
            FROM spotify_plays
            WHERE date IS NOT NULL AND (track_uri IS NOT NULL OR track_name IS NOT NULL)
            GROUP BY 1
        )
        SELECT
            CAST(CAST(DATE_TRUNC('month', p.date) AS DATE) AS VARCHAR) as month,
            CAST(CAST(tf.cohort AS DATE) AS VARCHAR) as cohort,
            CAST(COUNT(*) AS INTEGER) as plays
        FROM spotify_plays p
        INNER JOIN track_first tf ON ${trackKey('p.')} = tf.trackKey
        ${whereClause(['p.date IS NOT NULL', '(p.track_uri IS NOT NULL OR p.track_name IS NOT NULL)'], 'p.date', dateRange)}
        GROUP BY month, cohort
        ORDER BY month ASC, cohort ASC
    `;

    const result = await query<any>(sql);
    return result.map(row => ({
        month: row.month || '',
        cohort: row.cohort || '',
        plays: Number(row.plays) || 0
    }));
}

/**
 * Per-artist discovery date vs. last-listen date, for the "kept vs. abandoned" scatter.
 */
export async function getArtistDiscoveryRecency(
    minPlays = 20,
    limit = 400,
    dateRange?: DateRange
): Promise<ArtistDiscoveryRecencyData[]> {
    const safeMinPlays = Math.max(1, Math.floor(minPlays));
    const safeLimit = Math.max(1, Math.floor(limit));
    const sql = `
        SELECT
            artist_name as artist,
            CAST(MIN(date) AS VARCHAR) as firstDate,
            CAST(MAX(date) AS VARCHAR) as lastDate,
            CAST(COUNT(*) AS INTEGER) as plays,
            CAST(SUM(ms_played) / 60000.0 AS DOUBLE) as minutes
        FROM spotify_plays
        ${whereClause(['artist_name IS NOT NULL', 'date IS NOT NULL'], 'date', dateRange)}
        GROUP BY artist_name
        HAVING COUNT(*) >= ${safeMinPlays}
        ORDER BY plays DESC
        LIMIT ${safeLimit}
    `;

    const result = await query<any>(sql);
    return result.map(row => ({
        artist: row.artist || 'Unknown',
        firstDate: row.firstDate || '',
        lastDate: row.lastDate || '',
        plays: Number(row.plays) || 0,
        minutes: Number(row.minutes) || 0
    }));
}

/**
 * Tracks that were binged in a tight window: ranked by how many plays landed in their
 * single most intense week. `concentration` is the share of all plays inside that week.
 */
export async function getTrackObsessions(
    minPlays = 15,
    limit = 25,
    dateRange?: DateRange
): Promise<TrackObsessionData[]> {
    const safeMinPlays = Math.max(1, Math.floor(minPlays));
    const safeLimit = Math.max(1, Math.floor(limit));
    const sql = `
        WITH base AS (
            SELECT
                track_name,
                artist_name,
                DATE_TRUNC('week', date) as wk
            FROM spotify_plays
            ${whereClause(['track_name IS NOT NULL', 'artist_name IS NOT NULL', 'date IS NOT NULL'], 'date', dateRange)}
        ),
        track_week AS (
            SELECT track_name, artist_name, wk, CAST(COUNT(*) AS INTEGER) as weekPlays
            FROM base
            GROUP BY track_name, artist_name, wk
        ),
        track_tot AS (
            SELECT
                track_name,
                artist_name,
                CAST(SUM(weekPlays) AS INTEGER) as totalPlays,
                MIN(wk) as firstWeek,
                MAX(wk) as lastWeek
            FROM track_week
            GROUP BY track_name, artist_name
        ),
        track_peak AS (
            SELECT
                track_name,
                artist_name,
                wk as peakWeek,
                weekPlays as peakWeekPlays,
                ROW_NUMBER() OVER (
                    PARTITION BY track_name, artist_name
                    ORDER BY weekPlays DESC, wk ASC
                ) as rn
            FROM track_week
        )
        SELECT
            t.track_name as track,
            t.artist_name as artist,
            t.totalPlays as totalPlays,
            p.peakWeekPlays as peakWeekPlays,
            CAST(CAST(p.peakWeek AS DATE) AS VARCHAR) as peakWeek,
            CAST(CAST(t.firstWeek AS DATE) AS VARCHAR) as firstWeek,
            CAST(CAST(t.lastWeek AS DATE) AS VARCHAR) as lastWeek,
            CAST(p.peakWeekPlays AS DOUBLE) / t.totalPlays as concentration
        FROM track_tot t
        INNER JOIN track_peak p
            ON t.track_name = p.track_name
            AND t.artist_name = p.artist_name
            AND p.rn = 1
        WHERE t.totalPlays >= ${safeMinPlays}
        ORDER BY p.peakWeekPlays DESC, concentration DESC
        LIMIT ${safeLimit}
    `;

    const result = await query<any>(sql);
    return result.map(row => ({
        track: row.track || 'Unknown',
        artist: row.artist || 'Unknown',
        totalPlays: Number(row.totalPlays) || 0,
        peakWeekPlays: Number(row.peakWeekPlays) || 0,
        peakWeek: row.peakWeek || '',
        firstWeek: row.firstWeek || '',
        lastWeek: row.lastWeek || '',
        concentration: Number(row.concentration) || 0
    }));
}
