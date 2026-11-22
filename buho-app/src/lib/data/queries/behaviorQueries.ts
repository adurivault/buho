import { query } from '../db';
import { trackKeySql } from '../sql/trackKey';
import { searchSql } from '../sql/search';
import { parseSearch, SEARCH_KEY, type SearchablePoint } from '#lib/explorer/search.ts';
import { type DateRange, whereClause, type SqlNumber, type SqlText } from './common';
import type {
    DateRangeFilterValue,
    FilterScalar,
    FilterState,
    NumericRangeFilterValue,
} from '#lib/types/filters.ts';

export interface MacroStats {
    /** NULL where no loaded play carries a duration — a scrobbled history. */
    totalMinutes: number | null;
    uniqueArtists: number;
    uniqueTracks: number;
    /** NULL where no loaded play records why it ended. */
    skipRate: number | null;
}

export interface MacroStatsFilters {
    dateRange?: {
        start: string;
        end: string;
    };
    // Add other filters as needed
}

export async function getMacroStats(
    filters?: MacroStatsFilters,
    dateRange?: DateRange
): Promise<MacroStats> {
    const sql = `
        SELECT
            CAST(SUM(ms_played) / 60000.0 AS INTEGER) as totalMinutes,
            CAST(COUNT(DISTINCT artist_name) AS INTEGER) as uniqueArtists,
            CAST(COUNT(DISTINCT ${trackKeySql()}) AS INTEGER) as uniqueTracks,
            -- Deezer records no reason a track ended, so its rows are NULL here
            -- and AVG skips them: the rate is Spotify's, over Spotify's plays.
            CAST(AVG(CASE WHEN skipped THEN 1.0 WHEN skipped IS NULL THEN NULL ELSE 0.0 END) AS DOUBLE) as skipRate
        FROM plays
        ${whereClause(['track_name IS NOT NULL'], 'timestamp', dateRange)}
    `;

    const EMPTY: MacroStats = {
        totalMinutes: null,
        uniqueArtists: 0,
        uniqueTracks: 0,
        skipRate: null,
    };

    try {
        const result = await query<{
            totalMinutes: number | null;
            uniqueArtists: number | null;
            uniqueTracks: number | null;
            skipRate: number | null;
        }>(sql);
        if (!result || result.length === 0) return EMPTY;

        const row = result[0];

        // Both aggregates come back NULL when no row could answer them: a
        // history of Last.fm scrobbles has neither a duration nor a reason a
        // track ended. That is "not recorded", not "zero", and a headline
        // figure reading "0 minutes" or "0% ended early" would be a claim the
        // export never made — so it is passed through as null and the page
        // leaves the tile out.
        return {
            totalMinutes: row.totalMinutes == null ? null : Math.round(row.totalMinutes),
            uniqueArtists: Math.round(row.uniqueArtists || 0),
            uniqueTracks: Math.round(row.uniqueTracks || 0),
            skipRate: row.skipRate == null ? null : Math.round(row.skipRate * 100),
        };
    } catch (error) {
        console.error('Error fetching macro stats:', error);
        return EMPTY;
    }
}

export interface ExplorerMacroStats {
    totalMinutes: number;
    totalPlays: number;
    uniqueArtists: number;
    uniqueAlbums: number;
    uniqueTracks: number;
}

const EMPTY_EXPLORER_MACRO_STATS: ExplorerMacroStats = {
    totalMinutes: 0,
    totalPlays: 0,
    uniqueArtists: 0,
    uniqueAlbums: 0,
    uniqueTracks: 0,
};

/**
 * Global indicators for the Explorer mode, recomputed from ALL active filters
 * (including artist/album/track): they reflect the final selection.
 */
export async function getExplorerMacroStats(
    filters: FilterState = {}
): Promise<ExplorerMacroStats> {
    const where = buildExplorerWhereClause(filters);
    const sql = `
        SELECT
            CAST(SUM(ms_played) / 60000.0 AS INTEGER) as totalMinutes,
            CAST(COUNT(*) AS INTEGER) as totalPlays,
            CAST(COUNT(DISTINCT artist_name) AS INTEGER) as uniqueArtists,
            CAST(COUNT(DISTINCT album_name) AS INTEGER) as uniqueAlbums,
            CAST(COUNT(DISTINCT ${trackKeySql()}) AS INTEGER) as uniqueTracks
        FROM plays
        ${where}
    `;

    try {
        const result = await query<{
            totalMinutes: number | null;
            totalPlays: number | null;
            uniqueArtists: number | null;
            uniqueAlbums: number | null;
            uniqueTracks: number | null;
        }>(sql);
        if (!result || result.length === 0) {
            return { ...EMPTY_EXPLORER_MACRO_STATS };
        }
        const row = result[0];
        return {
            totalMinutes: Math.round(row.totalMinutes || 0),
            totalPlays: Math.round(row.totalPlays || 0),
            uniqueArtists: Math.round(row.uniqueArtists || 0),
            uniqueAlbums: Math.round(row.uniqueAlbums || 0),
            uniqueTracks: Math.round(row.uniqueTracks || 0),
        };
    } catch (error) {
        console.error('Error fetching explorer macro stats:', error);
        return { ...EMPTY_EXPLORER_MACRO_STATS };
    }
}

// Connectable points are a visual abstraction of behavior/timeline.
// `metadata` is opaque to the chart: each caller fills it with whatever its
// tooltip/click callbacks read (Spotify: track/artist/playedAt/trackUri).
export interface ConnectablePoint {
    x: number; // timestamp
    y: number; // hour of day, fractional (hour + minute/60 + second/3600)
    matched: boolean; // true when the point satisfies the active dimension filters
    metadata: Record<string, unknown>;
}

const VALID_SQL_IDENTIFIER = /^[a-z_][a-z0-9_]*$/i;

function escapeSqlString(value: string): string {
    return value.replace(/'/g, "''");
}

function toSqlLiteral(value: FilterScalar): string | null {
    if (value === null) return 'NULL';
    if (typeof value === 'string') return `'${escapeSqlString(value)}'`;
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) return null;
        return String(value);
    }
    if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
    return null;
}

function isDateRangeFilterValue(value: unknown): value is DateRangeFilterValue {
    if (!value || typeof value !== 'object') return false;
    if (value instanceof Set || Array.isArray(value)) return false;
    const maybe = value as DateRangeFilterValue;
    return 'start' in maybe || 'end' in maybe;
}

function isNumericRangeFilterValue(value: unknown): value is NumericRangeFilterValue {
    if (!value || typeof value !== 'object') return false;
    if (value instanceof Set || Array.isArray(value)) return false;
    const maybe = value as NumericRangeFilterValue;
    return 'min' in maybe || 'max' in maybe;
}

function buildFilterCondition(column: string, value: unknown): string | null {
    if (!VALID_SQL_IDENTIFIER.test(column)) return null;

    // Not a column: the Explorer's search box, matched over the play's text.
    if (column === SEARCH_KEY) {
        return typeof value === 'string'
            ? searchSql(parseSearch(value), PLAY_SEARCH_TEXT_SQL)
            : null;
    }

    let sqlCol = column;
    if (column === 'dayofweek') sqlCol = 'DAYOFWEEK(timestamp)';
    else if (column === 'hour_of_day') sqlCol = '(hour(timestamp) + (minute(timestamp) / 60.0))';

    if (value instanceof Set) {
        const literals = Array.from(value)
            .map((item) => toSqlLiteral(item as FilterScalar))
            .filter((item): item is string => item !== null && item !== 'NULL');
        if (literals.length === 0) return null;
        return `${sqlCol} IN (${literals.join(', ')})`;
    }

    if (Array.isArray(value)) {
        const literals = value
            .map((item) => toSqlLiteral(item as FilterScalar))
            .filter((item): item is string => item !== null && item !== 'NULL');
        if (literals.length === 0) return null;
        return `${sqlCol} IN (${literals.join(', ')})`;
    }

    if (isDateRangeFilterValue(value)) {
        const start = value.start;
        const end = value.end;
        if (
            typeof start === 'string' &&
            typeof end === 'string' &&
            /^\d{4}-\d{2}-\d{2}$/.test(start) &&
            /^\d{4}-\d{2}-\d{2}$/.test(end)
        ) {
            return `DATE(${sqlCol}) BETWEEN DATE '${start}' AND DATE '${end}'`;
        }
        return null;
    }

    if (isNumericRangeFilterValue(value)) {
        const conditions: string[] = [];
        if (typeof value.min === 'number' && Number.isFinite(value.min)) {
            if (column === 'timestamp') {
                conditions.push(`${sqlCol} >= epoch_ms(${Math.floor(value.min)})`);
            } else {
                conditions.push(`${sqlCol} >= ${value.min}`);
            }
        }
        if (typeof value.max === 'number' && Number.isFinite(value.max)) {
            if (column === 'timestamp') {
                conditions.push(`${sqlCol} <= epoch_ms(${Math.ceil(value.max)})`);
            } else {
                conditions.push(`${sqlCol} <= ${value.max}`);
            }
        }
        if (conditions.length === 0) return null;
        return conditions.length === 1 ? conditions[0] : `(${conditions.join(' AND ')})`;
    }

    const literal = toSqlLiteral(value as FilterScalar);
    if (literal === null) return null;
    if (literal === 'NULL') return `${sqlCol} IS NULL`;
    return `${sqlCol} = ${literal}`;
}

export function buildExplorerWhereClause(filters: FilterState): string {
    const conditions = ['timestamp IS NOT NULL'];

    for (const [column, value] of Object.entries(filters)) {
        const condition = buildFilterCondition(column, value);
        if (condition) {
            conditions.push(condition);
        }
    }

    return `WHERE ${conditions.join('\n          AND ')}`;
}

export function buildWhereExceptMultiple(filters: FilterState, keysToExclude: string[]): string {
    const newFilters = { ...filters };
    for (const key of keysToExclude) {
        delete newFilters[key];
    }
    return buildExplorerWhereClause(newFilters);
}

export async function getAllConnectablePoints(dateRange?: DateRange): Promise<ConnectablePoint[]> {
    const sql = `
        SELECT
            CAST(epoch(timestamp) * 1000 AS BIGINT) as x,
            CAST(hour(timestamp) + (minute(timestamp) / 60.0) + (second(timestamp) / 3600.0) AS DOUBLE) as y,
            track_name as track,
            artist_name as artist,
            CAST(timestamp AS VARCHAR) as playedAt,
            track_uri as trackUri
        FROM plays
        ${whereClause(['timestamp IS NOT NULL'], 'timestamp', dateRange)}
        ORDER BY x ASC
    `;

    try {
        const result = await query<{
            x: SqlNumber;
            y: SqlNumber;
            track: SqlText;
            artist: SqlText;
            playedAt: string;
            trackUri: SqlText;
        }>(sql);

        const mapped = result.map((row) => ({
            x: Number(row.x),
            y: Number(row.y),
            matched: true,
            metadata: {
                track: row.track,
                artist: row.artist,
                playedAt: row.playedAt,
                trackUri: row.trackUri ?? null,
            },
        }));

        return mapped;
    } catch (error) {
        console.error('Error fetching connectable points:', error);
        return [];
    }
}

export interface ConstellationTimeDomain {
    minX: number;
    maxX: number;
}

export async function getConstellationTimeDomain(
    filters: FilterState = {}
): Promise<ConstellationTimeDomain | null> {
    const sql = `
        SELECT
            CAST(epoch(MIN(timestamp)) * 1000 AS BIGINT) as minX,
            CAST(epoch(MAX(timestamp)) * 1000 AS BIGINT) as maxX
        FROM plays
        ${buildWhereExceptMultiple(filters, ['timestamp', 'hour_of_day'])}
    `;

    try {
        const result = await query<{ minX: SqlNumber; maxX: SqlNumber }>(sql);
        if (!result.length) return null;
        const minX = Number(result[0].minX);
        const maxX = Number(result[0].maxX);
        if (!Number.isFinite(minX) || !Number.isFinite(maxX)) return null;
        return { minX, maxX };
    } catch (error) {
        console.error('Error fetching constellation time domain:', error);
        return null;
    }
}

/**
 * A constellation point + its normalized dimensions (artist/album/track), to
 * recompute the `matched` flag in JS without a DB round-trip. The normalized
 * values follow exactly those of the sunburst (cf. getArtistSunburstFiltered).
 */
export interface ExplorerBasePoint extends ConnectablePoint, SearchablePoint {
    /** Which service recorded the play — 'spotify' or 'deezer'. */
    source: string;
    fArtist: string;
    fAlbum: string;
    fTrack: string;
    ip: string;
    platform: string;
    country: string;
    dow: string;
    mediaType: string;
    reasonStart: string;
    reasonEnd: string;
    shuffle: string;
    skipped: string;
    offline: string;
    mins: number;
}

/**
 * What the Explorer's search looks through for one play: its title, its
 * artist and its album, with the names the base points give the missing ones.
 *
 * Written twice on purpose — once for the points, searched in JavaScript, and
 * once for the queries the sunburst and the totals run — and kept side by side
 * so the two never drift: both have to find exactly the same plays (see
 * `sql/search.headless.test.ts` for the rules they share).
 */
export function playSearchText(point: ExplorerBasePoint): string {
    return `${point.fTrack}\n${point.fArtist}\n${point.fAlbum}`;
}

export const PLAY_SEARCH_TEXT_SQL = `concat_ws(chr(10),
    COALESCE(NULLIF(track_name, ''), 'Unknown track'),
    COALESCE(NULLIF(artist_name, ''), 'Unknown'),
    COALESCE(NULLIF(album_name, ''), 'Unknown album'))`;

/** An explorer base point as the SQL returns it. The `f*` and label columns are COALESCEd in SQL. */
interface ExplorerBaseSqlRow {
    x: SqlNumber;
    y: SqlNumber;
    track: SqlText;
    artist: SqlText;
    playedAt: string;
    trackUri: SqlText;
    source: SqlText;
    fAlbum: SqlText;
    fTrack: SqlText;
    ip: SqlText;
    mins: SqlNumber;
    platform: SqlText;
    country: SqlText;
    dow: SqlText;
    mediaType: SqlText;
    reasonStart: SqlText;
    reasonEnd: SqlText;
    shuffle: SqlText;
    skipped: SqlText;
    offline: SqlText;
}

/**
 * All constellation points, loaded ONCE. The point set never changes with the
 * filters (`matched` is recomputed in JS), which avoids rebuilding the quadtree
 * (~1.3 s) on every interaction.
 */
export async function getExplorerBasePoints(): Promise<ExplorerBasePoint[]> {
    const sql = `
        SELECT
            CAST(epoch(DATE(timestamp)) * 1000 AS BIGINT) as x,
            CAST(hour(timestamp) + (minute(timestamp) / 60.0) + (second(timestamp) / 3600.0) AS DOUBLE) as y,
            track_name as track,
            artist_name as artist,
            CAST(timestamp AS VARCHAR) as playedAt,
            track_uri as trackUri,
            source as source,
            COALESCE(album_name, 'Unknown album') as fAlbum,
            COALESCE(track_name, 'Unknown track') as fTrack,
            COALESCE(NULLIF(TRIM(CAST(ip_addr AS VARCHAR)), ''), 'Unknown') as ip,
            CAST(ms_played / 60000.0 AS DOUBLE) as mins,
            COALESCE(NULLIF(TRIM(CAST(platform_clean AS VARCHAR)), ''), 'Unknown') as platform,
            COALESCE(NULLIF(TRIM(CAST(country AS VARCHAR)), ''), 'Unknown') as country,
            CAST(DAYOFWEEK(timestamp) AS VARCHAR) as dow,
            COALESCE(NULLIF(TRIM(CAST(media_type AS VARCHAR)), ''), 'Unknown') as mediaType,
            COALESCE(NULLIF(TRIM(CAST(reason_start AS VARCHAR)), ''), 'Unknown') as reasonStart,
            COALESCE(NULLIF(TRIM(CAST(reason_end AS VARCHAR)), ''), 'Unknown') as reasonEnd,
            -- Three-valued, like the facets: a Deezer play is not a play that
            -- wasn't shuffled, it is one whose service never recorded whether it
            -- was — so it reads 'Unknown' rather than being lumped in with False.
            CASE WHEN shuffle IS NULL THEN 'Unknown' WHEN shuffle THEN 'True' ELSE 'False' END as shuffle,
            CASE WHEN skipped IS NULL THEN 'Unknown' WHEN skipped THEN 'True' ELSE 'False' END as skipped,
            CASE WHEN offline IS NULL THEN 'Unknown' WHEN offline THEN 'True' ELSE 'False' END as offline
        FROM plays
        WHERE timestamp IS NOT NULL
        ORDER BY x ASC
    `;

    try {
        const result = await query<ExplorerBaseSqlRow>(sql);
        return result.map((row) => ({
            x: Number(row.x),
            y: Number(row.y),
            matched: true,
            metadata: {
                track: row.track,
                artist: row.artist,
                playedAt: row.playedAt,
                trackUri: row.trackUri ?? null,
            },
            source: row.source || 'Unknown',
            fArtist: row.artist || 'Unknown',
            fAlbum: row.fAlbum || 'Unknown album',
            fTrack: row.fTrack || 'Unknown track',
            ip: row.ip || 'Unknown',
            mins: Number(row.mins) || 0,
            platform: row.platform || 'Unknown',
            country: row.country || 'Unknown',
            dow: row.dow ?? 'Unknown',
            mediaType: row.mediaType || 'Unknown',
            reasonStart: row.reasonStart || 'Unknown',
            reasonEnd: row.reasonEnd || 'Unknown',
            shuffle: row.shuffle || 'False',
            skipped: row.skipped || 'False',
            offline: row.offline || 'False',
            searchTerm: '',
            searchMask: 0,
        }));
    } catch (error) {
        console.error('Error fetching explorer base points:', error);
        return [];
    }
}

export interface PlayRecord {
    track: string | null;
    artist: string | null;
    album: string | null;
    playedAt: string;
    /** NULL where the service recorded no duration — a Last.fm scrobble. */
    msPlayed: number | null;
    platform: string | null;
    country: string | null;
    shuffle: boolean | null;
    skipped: boolean | null;
    offline: boolean | null;
    reasonStart: string | null;
    reasonEnd: string | null;
}

/**
 * Everything the export holds about one play, looked up by the exact timestamp
 * string `getAllConnectablePoints` already carries. Used by the guide to show a
 * reader what a single row of their own data actually contains.
 */
export async function getPlayRecord(playedAt: string): Promise<PlayRecord | null> {
    const sql = `
        SELECT
            track_name as track,
            artist_name as artist,
            album_name as album,
            CAST(timestamp AS VARCHAR) as playedAt,
            CAST(ms_played AS BIGINT) as msPlayed,
            platform_clean as platform,
            country,
            shuffle,
            skipped,
            offline,
            reason_start as reasonStart,
            reason_end as reasonEnd
        FROM plays
        WHERE CAST(timestamp AS VARCHAR) = '${escapeSqlString(playedAt)}'
        LIMIT 1
    `;

    try {
        const result = await query<{
            track: SqlText;
            artist: SqlText;
            album: SqlText;
            playedAt: SqlText;
            msPlayed: SqlNumber;
            platform: SqlText;
            country: SqlText;
            shuffle: boolean | null;
            skipped: boolean | null;
            offline: boolean | null;
            reasonStart: SqlText;
            reasonEnd: SqlText;
        }>(sql);
        if (!result.length) return null;
        const row = result[0];
        return {
            track: row.track ?? null,
            artist: row.artist ?? null,
            album: row.album ?? null,
            playedAt: row.playedAt ?? playedAt,
            // Kept null rather than folded to 0: the card drops the field
            // instead of claiming the play lasted no time at all.
            msPlayed: row.msPlayed == null ? null : Number(row.msPlayed),
            platform: row.platform ?? null,
            country: row.country ?? null,
            shuffle: row.shuffle ?? null,
            skipped: row.skipped ?? null,
            offline: row.offline ?? null,
            reasonStart: row.reasonStart ?? null,
            reasonEnd: row.reasonEnd ?? null,
        };
    } catch (error) {
        console.error('Error fetching play record:', error);
        return null;
    }
}
