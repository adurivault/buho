import { query } from '../db';
import { buildWhereExceptMultiple } from './behaviorQueries';
import type { FilterState } from '$lib/types/filters';

export interface DimensionAggregation {
    dimension_name: string;
    item_value: string;
    item_count: number;
    total_minutes: number;
}

function buildWhereExcept(filters: FilterState, keyToExclude: string): string {
    return buildWhereExceptMultiple(filters, [keyToExclude]);
}

export async function getTopItemsByDimensions(filters: FilterState = {}): Promise<DimensionAggregation[]> {
    const whereArtist = buildWhereExcept(filters, 'artist_name');
    const whereAlbum = buildWhereExcept(filters, 'album_name');
    const whereTrack = buildWhereExcept(filters, 'track_name');
    const wherePlatform = buildWhereExcept(filters, 'platform_clean');
    const whereShuffle = buildWhereExcept(filters, 'shuffle');
    const whereSkipped = buildWhereExcept(filters, 'skipped');
    const whereReasonStart = buildWhereExcept(filters, 'reason_start');
    const whereReasonEnd = buildWhereExcept(filters, 'reason_end');
    const whereIpAddr = buildWhereExcept(filters, 'ip_addr');
    const whereCountry = buildWhereExcept(filters, 'country');
    const whereDow = buildWhereExcept(filters, 'dayofweek');
    const whereIncognito = buildWhereExcept(filters, 'incognito_mode');
    const whereMediaType = buildWhereExcept(filters, 'media_type');
    const whereIsFirstPlay = buildWhereExcept(filters, 'is_first_play');

    // We add timestamp IS NOT NULL here in case whereClause doesn't have it, but buildExplorerWhereClause
    // actually already starts with ['timestamp IS NOT NULL'].
    const sql = `
        WITH artist AS (
            SELECT 'artist' as dimension_name, COALESCE(CAST(artist_name AS VARCHAR), 'Unknown') as item_value, CAST(COUNT(*) AS INTEGER) as item_count, CAST(SUM(ms_played) / 60000.0 AS DOUBLE) as total_minutes FROM spotify_plays ${whereArtist} GROUP BY artist_name
        ),
        album AS (
            SELECT 'album' as dimension_name, COALESCE(CAST(album_name AS VARCHAR), 'Unknown') as item_value, CAST(COUNT(*) AS INTEGER) as item_count, CAST(SUM(ms_played) / 60000.0 AS DOUBLE) as total_minutes FROM spotify_plays ${whereAlbum} GROUP BY album_name
        ),
        track AS (
            SELECT 'track' as dimension_name, COALESCE(CAST(track_name AS VARCHAR), 'Unknown') as item_value, CAST(COUNT(*) AS INTEGER) as item_count, CAST(SUM(ms_played) / 60000.0 AS DOUBLE) as total_minutes FROM spotify_plays ${whereTrack} GROUP BY track_name
        ),
        platform AS (
            SELECT 'platform' as dimension_name, COALESCE(CAST(platform_clean AS VARCHAR), 'Unknown') as item_value, CAST(COUNT(*) AS INTEGER) as item_count, CAST(SUM(ms_played) / 60000.0 AS DOUBLE) as total_minutes FROM spotify_plays ${wherePlatform} GROUP BY platform_clean
        ),
        shuffle_cte AS (
            SELECT 'shuffle' as dimension_name, CASE WHEN shuffle THEN 'True' ELSE 'False' END as item_value, CAST(COUNT(*) AS INTEGER) as item_count, CAST(SUM(ms_played) / 60000.0 AS DOUBLE) as total_minutes FROM spotify_plays ${whereShuffle} GROUP BY shuffle
        ),
        skipped_cte AS (
            SELECT 'skipped' as dimension_name, CASE WHEN skipped THEN 'True' ELSE 'False' END as item_value, CAST(COUNT(*) AS INTEGER) as item_count, CAST(SUM(ms_played) / 60000.0 AS DOUBLE) as total_minutes FROM spotify_plays ${whereSkipped} GROUP BY skipped
        ),
        reason_start_cte AS (
            SELECT 'reason_start' as dimension_name, COALESCE(NULLIF(TRIM(CAST(reason_start AS VARCHAR)), ''), 'Unknown') as item_value, CAST(COUNT(*) AS INTEGER) as item_count, CAST(SUM(ms_played) / 60000.0 AS DOUBLE) as total_minutes FROM spotify_plays ${whereReasonStart} GROUP BY reason_start
        ),
        reason_end_cte AS (
            SELECT 'reason_end' as dimension_name, COALESCE(NULLIF(TRIM(CAST(reason_end AS VARCHAR)), ''), 'Unknown') as item_value, CAST(COUNT(*) AS INTEGER) as item_count, CAST(SUM(ms_played) / 60000.0 AS DOUBLE) as total_minutes FROM spotify_plays ${whereReasonEnd} GROUP BY reason_end
        ),
        ip_addr_cte AS (
            SELECT 'ip_address' as dimension_name, COALESCE(CAST(ip_addr AS VARCHAR), 'Unknown') as item_value, CAST(COUNT(*) AS INTEGER) as item_count, CAST(SUM(ms_played) / 60000.0 AS DOUBLE) as total_minutes FROM spotify_plays ${whereIpAddr} GROUP BY ip_addr
        ),
        incognito_cte AS (
            SELECT 'incognito_mode' as dimension_name, CASE WHEN incognito_mode THEN 'True' ELSE 'False' END as item_value, CAST(COUNT(*) AS INTEGER) as item_count, CAST(SUM(ms_played) / 60000.0 AS DOUBLE) as total_minutes FROM spotify_plays ${whereIncognito} GROUP BY incognito_mode
        ),
        media_type_cte AS (
            SELECT 'media_type' as dimension_name, COALESCE(CAST(media_type AS VARCHAR), 'Unknown') as item_value, CAST(COUNT(*) AS INTEGER) as item_count, CAST(SUM(ms_played) / 60000.0 AS DOUBLE) as total_minutes FROM spotify_plays ${whereMediaType} GROUP BY media_type
        ),
        is_first_play_cte AS (
            SELECT 'is_first_play' as dimension_name, CASE WHEN is_first_play THEN 'True' ELSE 'False' END as item_value, CAST(COUNT(*) AS INTEGER) as item_count, CAST(SUM(ms_played) / 60000.0 AS DOUBLE) as total_minutes FROM spotify_plays ${whereIsFirstPlay} GROUP BY is_first_play
        ),
        country_cte AS (
            SELECT 'country' as dimension_name, COALESCE(CAST(country AS VARCHAR), 'Unknown') as item_value, CAST(COUNT(*) AS INTEGER) as item_count, CAST(SUM(ms_played) / 60000.0 AS DOUBLE) as total_minutes FROM spotify_plays ${whereCountry} GROUP BY country
        ),
        dow_cte AS (
            SELECT 'dayofweek' as dimension_name, CAST(DAYOFWEEK(timestamp) AS VARCHAR) as item_value, CAST(COUNT(*) AS INTEGER) as item_count, CAST(SUM(ms_played) / 60000.0 AS DOUBLE) as total_minutes FROM spotify_plays ${whereDow} GROUP BY DAYOFWEEK(timestamp)
        ),
        base_aggregations AS (
            SELECT * FROM artist
            UNION ALL SELECT * FROM album
            UNION ALL SELECT * FROM track
            UNION ALL SELECT * FROM platform
            UNION ALL SELECT * FROM shuffle_cte
            UNION ALL SELECT * FROM skipped_cte
            UNION ALL SELECT * FROM reason_start_cte
            UNION ALL SELECT * FROM reason_end_cte
            UNION ALL SELECT * FROM ip_addr_cte
            UNION ALL SELECT * FROM incognito_cte
            UNION ALL SELECT * FROM media_type_cte
            UNION ALL SELECT * FROM is_first_play_cte
            UNION ALL SELECT * FROM country_cte
            UNION ALL SELECT * FROM dow_cte
        )
        SELECT *
        FROM (
            SELECT 
                dimension_name,
                item_value,
                item_count,
                total_minutes,
                ROW_NUMBER() OVER(PARTITION BY dimension_name ORDER BY total_minutes DESC) as rn
            FROM base_aggregations
            WHERE dimension_name IS NOT NULL
        ) ranked
        WHERE rn <= 30
        ORDER BY dimension_name, rn ASC
    `;

    try {
        const result = await query<any>(sql);
        // db.ts transforms all column names to camelCase automatically.
        // So `dimension_name` → `dimensionName`, `item_value` → `itemValue`, etc.
        return result.map((row) => ({
            dimension_name: row.dimensionName,
            item_value: row.itemValue,
            item_count: Number(row.itemCount) || 0,
            total_minutes: Number(row.totalMinutes) || 0,
        }));
    } catch (error) {
        console.error('Error fetching aggregations by dimensions:', error);
        return [];
    }
}

// Colonnes autorisées pour un breakdown (interpolées en SQL ⇒ whitelist stricte).
const ALLOWED_BREAKDOWN_COLUMNS = new Set([
    'ip_addr',
    'country',
    'platform_clean',
    'reason_start',
    'reason_end',
    'media_type'
]);

export interface DimensionSlice {
    value: string;
    minutes: number;
    plays: number;
}
