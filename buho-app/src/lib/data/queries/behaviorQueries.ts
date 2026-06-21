import { query } from '../db';
import { type DateRange, whereClause } from './common';
import type {
    DateRangeFilterValue,
    FilterScalar,
    FilterState,
    NumericRangeFilterValue
} from '$lib/types/filters';

export interface PlatformData {
    platform: string;
    minutes: number;
}

export interface ReasonDistributionData {
    reason: string;
    minutes: number;
}

export interface ReasonFlowData {
    reasonStart: string;
    reasonEnd: string;
    minutes: number;
}

export interface MacroStats {
    totalMinutes: number;
    uniqueArtists: number;
    uniqueTracks: number;
    skipRate: number;
}

export interface MacroStatsFilters {
    dateRange?: {
        start: string;
        end: string;
    };
    // Add other filters as needed
}

export async function getMacroStats(filters?: MacroStatsFilters, dateRange?: DateRange): Promise<MacroStats> {
    const sql = `
        SELECT
            CAST(SUM(ms_played) / 60000.0 AS INTEGER) as totalMinutes,
            CAST(COUNT(DISTINCT artist_name) AS INTEGER) as uniqueArtists,
            CAST(COUNT(DISTINCT track_uri) AS INTEGER) as uniqueTracks,
            CAST(AVG(CASE WHEN skipped = true THEN 1.0 ELSE 0.0 END) AS DOUBLE) as skipRate
        FROM spotify_plays
        ${whereClause(['track_name IS NOT NULL', 'track_uri IS NOT NULL'], 'timestamp', dateRange)}
    `;

    try {
        const result = await query<any>(sql);

        if (!result || result.length === 0) {
            return {
                totalMinutes: 0,
                uniqueArtists: 0,
                uniqueTracks: 0,
                skipRate: 0
            };
        }

        const row = result[0];

        return {
            totalMinutes: Math.round(row.totalMinutes || 0),
            uniqueArtists: Math.round(row.uniqueArtists || 0),
            uniqueTracks: Math.round(row.uniqueTracks || 0),
            skipRate: Math.round((row.skipRate || 0) * 100)
        };
    } catch (error) {
        console.error('Error fetching macro stats:', error);
        return {
            totalMinutes: 0,
            uniqueArtists: 0,
            uniqueTracks: 0,
            skipRate: 0
        };
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
    uniqueTracks: 0
};

/**
 * Indicateurs globaux du mode Explorer, recalculés selon TOUS les filtres
 * actifs (y compris artist/album/track) : ils reflètent la sélection finale.
 */
export async function getExplorerMacroStats(filters: FilterState = {}): Promise<ExplorerMacroStats> {
    const where = buildExplorerWhereClause(filters);
    const sql = `
        SELECT
            CAST(SUM(ms_played) / 60000.0 AS INTEGER) as totalMinutes,
            CAST(COUNT(*) AS INTEGER) as totalPlays,
            CAST(COUNT(DISTINCT artist_name) AS INTEGER) as uniqueArtists,
            CAST(COUNT(DISTINCT album_name) AS INTEGER) as uniqueAlbums,
            CAST(COUNT(DISTINCT track_uri) AS INTEGER) as uniqueTracks
        FROM spotify_plays
        ${where}
    `;

    try {
        const result = await query<any>(sql);
        if (!result || result.length === 0) {
            return { ...EMPTY_EXPLORER_MACRO_STATS };
        }
        const row = result[0];
        return {
            totalMinutes: Math.round(row.totalMinutes || 0),
            totalPlays: Math.round(row.totalPlays || 0),
            uniqueArtists: Math.round(row.uniqueArtists || 0),
            uniqueAlbums: Math.round(row.uniqueAlbums || 0),
            uniqueTracks: Math.round(row.uniqueTracks || 0)
        };
    } catch (error) {
        console.error('Error fetching explorer macro stats:', error);
        return { ...EMPTY_EXPLORER_MACRO_STATS };
    }
}

export async function getPlatformDistribution(dateRange?: DateRange): Promise<PlatformData[]> {
    const sql = `
        SELECT
            COALESCE(platform_clean, 'Unknown') as platform,
            CAST(SUM(ms_played) / 60000.0 AS INTEGER) as minutes
        FROM spotify_plays
        ${whereClause([], 'timestamp', dateRange)}
        GROUP BY platform_clean
        ORDER BY SUM(ms_played) DESC
    `;

    try {
        const result = await query<any>(sql);
        return result.map(row => ({
            platform: row.platform || 'Unknown',
            minutes: Number(row.minutes) || 0
        }));
    } catch (error) {
        console.error('Error fetching platform distribution:', error);
        return [];
    }
}

async function getReasonDistribution(column: 'reason_start' | 'reason_end', dateRange?: DateRange): Promise<ReasonDistributionData[]> {
    const sql = `
        SELECT
            COALESCE(NULLIF(TRIM(${column}), ''), 'Unknown') as reason,
            CAST(SUM(ms_played) / 60000.0 AS INTEGER) as minutes
        FROM spotify_plays
        ${whereClause(['ms_played IS NOT NULL'], 'timestamp', dateRange)}
        GROUP BY COALESCE(NULLIF(TRIM(${column}), ''), 'Unknown')
        ORDER BY SUM(ms_played) DESC
    `;

    try {
        const result = await query<any>(sql);
        return result.map(row => ({
            reason: row.reason || 'Unknown',
            minutes: Number(row.minutes) || 0
        }));
    } catch (error) {
        console.error(`Error fetching ${column} distribution:`, error);
        return [];
    }
}

export async function getReasonStartDistribution(dateRange?: DateRange): Promise<ReasonDistributionData[]> {
    return getReasonDistribution('reason_start', dateRange);
}

export async function getReasonEndDistribution(dateRange?: DateRange): Promise<ReasonDistributionData[]> {
    return getReasonDistribution('reason_end', dateRange);
}

export async function getReasonStartEndFlow(dateRange?: DateRange): Promise<ReasonFlowData[]> {
    const sql = `
        SELECT
            COALESCE(NULLIF(TRIM(reason_start), ''), 'Unknown') as reasonStart,
            COALESCE(NULLIF(TRIM(reason_end), ''), 'Unknown') as reasonEnd,
            CAST(SUM(ms_played) / 60000.0 AS INTEGER) as minutes
        FROM spotify_plays
        ${whereClause(['ms_played IS NOT NULL'], 'timestamp', dateRange)}
        GROUP BY
            COALESCE(NULLIF(TRIM(reason_start), ''), 'Unknown'),
            COALESCE(NULLIF(TRIM(reason_end), ''), 'Unknown')
        ORDER BY SUM(ms_played) DESC
    `;

    try {
        const result = await query<any>(sql);
        return result.map(row => ({
            reasonStart: row.reasonStart || 'Unknown',
            reasonEnd: row.reasonEnd || 'Unknown',
            minutes: Number(row.minutes) || 0
        }));
    } catch (error) {
        console.error('Error fetching reason_start -> reason_end flow:', error);
        return [];
    }
}

// Connectable points are a visual abstraction of behavior/timeline
export interface ConnectablePoint {
    x: number;      // timestamp
    y: number;      // hour of day + minute/60
    matched: boolean; // true when the point satisfies the active dimension filters
    metadata: {
        track: string;
        artist: string;
        playedAt: string; // ISO date string
        trackUri: string | null; // spotify:track:<id> — pour ouvrir le titre sur Spotify
    };
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

    let sqlCol = column;
    if (column === 'dayofweek') sqlCol = 'DAYOFWEEK(timestamp)';
    else if (column === 'hour_of_day') sqlCol = '(hour + (minute / 60.0))';

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

/**
 * Boolean SQL expression that is TRUE when a row satisfies every filter
 * (excluding the given keys). Used to flag rows instead of filtering them
 * out, so charts can dim non-matching elements rather than drop them.
 */
export function buildMatchExpression(filters: FilterState, keysToExclude: string[] = []): string {
    const conditions: string[] = [];
    for (const [column, value] of Object.entries(filters)) {
        if (keysToExclude.includes(column)) continue;
        const condition = buildFilterCondition(column, value);
        if (condition) conditions.push(condition);
    }
    if (conditions.length === 0) return 'TRUE';
    // COALESCE: IN/=/range comparisons on NULL columns yield NULL, which must
    // count as "not matched" rather than poisoning the boolean.
    return `COALESCE(${conditions.join('\n          AND ')}, FALSE)`;
}

export async function getAllConnectablePoints(dateRange?: DateRange): Promise<ConnectablePoint[]> {
    const sql = `
        SELECT
            CAST(epoch(timestamp) * 1000 AS BIGINT) as x,
            CAST(hour + (minute / 60.0) AS DOUBLE) as y,
            track_name as track,
            artist_name as artist,
            CAST(timestamp AS VARCHAR) as playedAt,
            track_uri as trackUri
        FROM spotify_plays
        ${whereClause(['timestamp IS NOT NULL'], 'timestamp', dateRange)}
        ORDER BY x ASC
    `;

    try {
        const result = await query<any>(sql);

        const mapped = result.map(row => ({
            x: Number(row.x),
            y: Number(row.y),
            matched: true,
            metadata: {
                track: row.track,
                artist: row.artist,
                playedAt: row.playedAt,
                trackUri: row.trackUri ?? null
            }
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

export interface WeeklyVolumePoint {
    weekStart: string;
    weekStartMs: number;
    plays: number;
}

export async function getConstellationTimeDomain(filters: FilterState = {}): Promise<ConstellationTimeDomain | null> {
    const sql = `
        SELECT
            CAST(epoch(MIN(timestamp)) * 1000 AS BIGINT) as minX,
            CAST(epoch(MAX(timestamp)) * 1000 AS BIGINT) as maxX
        FROM spotify_plays
        ${buildWhereExceptMultiple(filters, ['timestamp', 'hour_of_day'])}
    `;

    try {
        const result = await query<any>(sql);
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

export async function getExplorerConnectablePoints(filters: FilterState = {}): Promise<ConnectablePoint[]> {
    // Dimension filters do not remove points: every play is returned with a
    // `matched` flag so the constellation can dim non-matching points instead
    // of making them disappear. Time/hour filters are view domains handled by
    // the chart itself, hence excluded from the match expression.
    const matchExpression = buildMatchExpression(filters, ['timestamp', 'hour_of_day']);
    const sql = `
        SELECT
            -- Horizontal position is day-based (no hour/minute jitter on x-axis)
            CAST(epoch(DATE(timestamp)) * 1000 AS BIGINT) as x,
            CAST(hour + (minute / 60.0) AS DOUBLE) as y,
            track_name as track,
            artist_name as artist,
            CAST(timestamp AS VARCHAR) as playedAt,
            track_uri as trackUri,
            CAST(${matchExpression} AS BOOLEAN) as matched
        FROM spotify_plays
        WHERE timestamp IS NOT NULL
        ORDER BY x ASC
    `;

    try {
        const result = await query<any>(sql);

        return result.map((row) => ({
            x: Number(row.x),
            y: Number(row.y),
            matched: Boolean(row.matched),
            metadata: {
                track: row.track,
                artist: row.artist,
                playedAt: row.playedAt,
                trackUri: row.trackUri ?? null
            }
        }));
    } catch (error) {
        console.error('Error fetching explorer connectable points:', error);
        return [];
    }
}

/**
 * Point de constellation + ses dimensions normalisées (artiste/album/titre),
 * pour recalculer le flag `matched` côté JS sans round-trip DB. Les valeurs
 * normalisées suivent exactement celles du sunburst (cf. getArtistSunburstFiltered).
 */
export interface ExplorerBasePoint extends ConnectablePoint {
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
 * Tous les points de la constellation, chargés UNE fois. Le jeu de points ne
 * change jamais selon les filtres (le `matched` est recalculé en JS), ce qui
 * évite de reconstruire le quadtree (~1,3 s) à chaque interaction.
 */
export async function getExplorerBasePoints(): Promise<ExplorerBasePoint[]> {
    const sql = `
        SELECT
            CAST(epoch(DATE(timestamp)) * 1000 AS BIGINT) as x,
            CAST(hour + (minute / 60.0) AS DOUBLE) as y,
            track_name as track,
            artist_name as artist,
            CAST(timestamp AS VARCHAR) as playedAt,
            track_uri as trackUri,
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
            CASE WHEN shuffle THEN 'True' ELSE 'False' END as shuffle,
            CASE WHEN skipped THEN 'True' ELSE 'False' END as skipped,
            CASE WHEN offline THEN 'True' ELSE 'False' END as offline
        FROM spotify_plays
        WHERE timestamp IS NOT NULL
        ORDER BY x ASC
    `;

    try {
        const result = await query<any>(sql);
        return result.map((row) => ({
            x: Number(row.x),
            y: Number(row.y),
            matched: true,
            metadata: {
                track: row.track,
                artist: row.artist,
                playedAt: row.playedAt,
                trackUri: row.trackUri ?? null
            },
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
            offline: row.offline || 'False'
        }));
    } catch (error) {
        console.error('Error fetching explorer base points:', error);
        return [];
    }
}

export async function getExplorerWeeklyVolume(filters: FilterState = {}): Promise<WeeklyVolumePoint[]> {
    const sql = `
        SELECT
            CAST(date_trunc('week', timestamp) AS VARCHAR) as weekStart,
            CAST(epoch(date_trunc('week', timestamp)) * 1000 AS BIGINT) as weekStartMs,
            CAST(COUNT(*) AS INTEGER) as plays
        FROM spotify_plays
        ${buildExplorerWhereClause(filters)}
        GROUP BY date_trunc('week', timestamp)
        ORDER BY date_trunc('week', timestamp) ASC
    `;

    try {
        const result = await query<any>(sql);
        return result.map((row) => ({
            weekStart: row.weekStart,
            weekStartMs: Number(row.weekStartMs),
            plays: Number(row.plays) || 0
        }));
    } catch (error) {
        console.error('Error fetching explorer weekly volume:', error);
        return [];
    }
}
