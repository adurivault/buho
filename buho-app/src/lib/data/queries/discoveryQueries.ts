import { query } from '../db';
import { trackKeySql } from '../sql/trackKey';
import { type DateRange, whereClause, type SqlNumber, type SqlText } from './common';

export interface MonthlyCohortPoint {
    month: string; // YYYY-MM-DD (first day of the listening month)
    cohort: string; // YYYY-MM-DD (first day of the month the track was discovered)
    plays: number;
}

export interface ArtistDiscoveryRecencyData {
    artist: string;
    firstDate: string; // YYYY-MM-DD
    lastDate: string; // YYYY-MM-DD
    plays: number;
    minutes: number;
}

/**
 * Monthly listening volume, split by the *discovery cohort* of each played track — the month
 * the track was first ever heard. Unlike recency, a track's cohort never changes, so a song
 * discovered in 2018 keeps its colour forever: old discoveries settle as deep sediment layers
 * at the bottom, fresh discoveries pile bright on top. The discovery month is computed against
 * the global first listen (not the filtered range) so cohorts stay stable when the slider moves.
 */
export async function getMonthlyDiscoveryCohorts(
    dateRange?: DateRange
): Promise<MonthlyCohortPoint[]> {
    const sql = `
        WITH track_first AS (
            SELECT
                ${trackKeySql()} as trackKey,
                DATE_TRUNC('month', MIN(date)) as cohort
            FROM plays
            WHERE date IS NOT NULL AND track_name IS NOT NULL
            GROUP BY 1
        )
        SELECT
            CAST(CAST(DATE_TRUNC('month', p.date) AS DATE) AS VARCHAR) as month,
            CAST(CAST(tf.cohort AS DATE) AS VARCHAR) as cohort,
            CAST(COUNT(*) AS INTEGER) as plays
        FROM plays p
        INNER JOIN track_first tf ON ${trackKeySql('p.')} = tf.trackKey
        ${whereClause(['p.date IS NOT NULL', 'p.track_name IS NOT NULL'], 'p.date', dateRange)}
        GROUP BY month, cohort
        ORDER BY month ASC, cohort ASC
    `;

    const result = await query<{ month: SqlText; cohort: SqlText; plays: SqlNumber }>(sql);
    return result.map((row) => ({
        month: row.month || '',
        cohort: row.cohort || '',
        plays: Number(row.plays) || 0,
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
        FROM plays
        ${whereClause(['artist_name IS NOT NULL', 'date IS NOT NULL'], 'date', dateRange)}
        GROUP BY artist_name
        HAVING COUNT(*) >= ${safeMinPlays}
        ORDER BY plays DESC
        LIMIT ${safeLimit}
    `;

    const result = await query<{
        artist: SqlText;
        firstDate: SqlText;
        lastDate: SqlText;
        plays: SqlNumber;
        minutes: SqlNumber;
    }>(sql);
    return result.map((row) => ({
        artist: row.artist || 'Unknown',
        firstDate: row.firstDate || '',
        lastDate: row.lastDate || '',
        plays: Number(row.plays) || 0,
        minutes: Number(row.minutes) || 0,
    }));
}
