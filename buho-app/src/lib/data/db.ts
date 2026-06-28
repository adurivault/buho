import type { SpotifyPlay } from '$lib/types/spotify';
import type { LocationSegment } from '$lib/types/googleMaps';
import * as duckdb from '@duckdb/duckdb-wasm';
import duckdb_wasm from '@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url';
import mvp_worker from '@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url';
import duckdb_wasm_eh from '@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url';
import eh_worker from '@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url';

const MANUAL_BUNDLES: duckdb.DuckDBBundles = {
    mvp: { mainModule: duckdb_wasm, mainWorker: mvp_worker },
    eh: { mainModule: duckdb_wasm_eh, mainWorker: eh_worker }
};

let db: duckdb.AsyncDuckDB | null = null;
let conn: duckdb.AsyncDuckDBConnection | null = null;

// Validation: SQL identifier (table/column names) to prevent SQL injection
const VALID_IDENTIFIER = /^[a-z_][a-z0-9_]*$/i;
function validateIdentifier(name: string, context: string): void {
    if (!VALID_IDENTIFIER.test(name)) {
        throw new Error(`Invalid ${context} name: "${name}". Only alphanumeric characters and underscores allowed.`);
    }
}

// Helper: Snake -> Camel
function toCamelCase(str: string): string {
    return str.replace(/_([a-z])/g, (_, char) => char.toUpperCase());
}

// Helper: Camel -> Snake
function toSnakeCase(str: string): string {
    return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
}

// DuckDB stores TIMESTAMP/DATE values as naive (no tz). We must serialize using
// LOCAL wall-clock fields (not toISOString, which converts to UTC) so that SQL
// functions like hour()/DATE()/dayofweek() on these columns match the time the
// user actually saw the track played at — including across DST transitions,
// since Date's local getters resolve the correct historical DST offset.
export function formatLocalTimestamp(d: Date): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function formatLocalDate(d: Date): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Helper: Transform object keys
function transformKeys(obj: any, transformer: (key: string) => string): any {
    if (obj instanceof Date) {
        return obj;
    }
    if (Array.isArray(obj)) {
        return obj.map(v => transformKeys(v, transformer));
    }
    if (obj !== null && typeof obj === 'object') {
        return Object.keys(obj).reduce((acc, key) => {
            acc[transformer(key)] = transformKeys(obj[key], transformer);
            return acc;
        }, {} as any);
    }
    return obj;
}

export async function initDuckDB(): Promise<void> {
    if (db) return; // Already initialized

    const bundle = await duckdb.selectBundle(MANUAL_BUNDLES);
    const logger = new duckdb.ConsoleLogger();
    const worker = new Worker(bundle.mainWorker!);

    db = new duckdb.AsyncDuckDB(logger, worker);
    await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
    conn = await db.connect();
}

export function isReady(): boolean {
    return !!db && !!conn;
}

export async function getConnection(): Promise<duckdb.AsyncDuckDBConnection> {
    if (!conn) {
        throw new Error('Database not initialized. Call initDuckDB() first.');
    }
    return conn;
}

export async function query<T>(sql: string, params?: any[]): Promise<T[]> {
    const connection = await getConnection();

    let result;
    if (params && params.length > 0) {
        // Prepared statement: values are bound, never interpolated into the SQL.
        const stmt = await connection.prepare(sql);
        try {
            result = await stmt.query(...params);
        } finally {
            await stmt.close();
        }
    } else {
        result = await connection.query(sql);
    }

    const rows = result.toArray().map((row: any) => row.toJSON());

    // Columns are snake_case in DuckDB; the app works in camelCase.
    return transformKeys(rows, toCamelCase) as T[];
}

export async function createTable(name: string, schema: string): Promise<void> {
    validateIdentifier(name, 'table');
    const connection = await getConnection();
    await connection.query(`CREATE TABLE IF NOT EXISTS ${name} (${schema})`);
}

// Load the `spatial` extension (ST_Contains, ST_Point, …). Lazy and idempotent:
// only the Google Maps path needs GIS, so Spotify-only users never pay the
// one-time extension fetch from extensions.duckdb.org.
let spatialLoaded = false;
export async function loadSpatial(): Promise<void> {
    if (spatialLoaded) return;
    const connection = await getConnection();
    await connection.query('INSTALL spatial');
    await connection.query('LOAD spatial');
    spatialLoaded = true;
}

/**
 * Register `rows` as a temporary JSON file and run a single statement that reads
 * from it. `buildSql` receives a `read_json_auto('…')` source expression. Use
 * this when the insert needs SQL-side transformation that the plain insertData
 * path can't express — e.g. building GEOMETRY via ST_GeomFromGeoJSON / ST_Point.
 */
export async function withJsonRows(
    rows: unknown[],
    buildSql: (source: string) => string,
): Promise<void> {
    if (!db || !conn) throw new Error('DB not initialized');
    if (rows.length === 0) return;

    const tempFile = `import_geo_${Date.now()}_${Math.random().toString(36).slice(2)}.json`;
    await db.registerFileText(tempFile, JSON.stringify(rows));
    try {
        await conn.query(buildSql(`read_json_auto('${tempFile}')`));
    } finally {
        await db.registerFileText(tempFile, '');
    }
}

export async function insertData<T>(table: string, data: T[]): Promise<void> {
    validateIdentifier(table, 'table');
    if (!db || !conn) throw new Error('DB not initialized');
    if (data.length === 0) return;

    // Transform data keys to snake_case for insertion
    const snakeData = transformKeys(data, toSnakeCase);
    const jsonContent = JSON.stringify(snakeData);

    const tempFile = `import_${table}_${Date.now()}.json`;

    await db.registerFileText(tempFile, jsonContent);

    // Use read_json_auto logic
    // We assume table exists
    await conn.query(`INSERT INTO ${table} SELECT * FROM read_json_auto('${tempFile}')`);

    // Clear temp file content (dropFile not available in all versions)
    await db.registerFileText(tempFile, '');
}

export async function dropTable(name: string): Promise<void> {
    validateIdentifier(name, 'table');
    const connection = await getConnection();
    await connection.query(`DROP TABLE IF EXISTS ${name}`);
}

/**
 * Insert Spotify play records into the spotify_plays table.
 * Creates the table if it doesn't exist with the appropriate schema.
 * Handles camelCase to snake_case conversion automatically.
 * 
 * @param plays - Array of SpotifyPlay objects to insert(camelCase fields).
 * @throws { Error } If database is not initialized.
 */
export async function insertSpotifyPlays(plays: SpotifyPlay[]): Promise<void> {
    const TABLE_NAME = 'spotify_plays';

    // Schema definition for SpotifyPlay (mapped to snake_case columns)
    const SCHEMA = `
        timestamp TIMESTAMP,
        date DATE,
        ms_played INTEGER,
        track_name VARCHAR,
        artist_name VARCHAR,
        album_name VARCHAR,
        track_uri VARCHAR,
        platform VARCHAR,
        platform_clean VARCHAR,
        country VARCHAR,
        ip_addr VARCHAR,
        skipped BOOLEAN,
        shuffle BOOLEAN,
        offline BOOLEAN,
        reason_start VARCHAR,
        reason_end VARCHAR,
        episode_name VARCHAR,
        episode_show_name VARCHAR,
        episode_uri VARCHAR,
        incognito_mode BOOLEAN,
        media_type VARCHAR,
        play_count INTEGER,
        is_first_play BOOLEAN
    `;

    // Ensure table exists
    await createTable(TABLE_NAME, SCHEMA);

    validateIdentifier(TABLE_NAME, 'table');
    if (!db || !conn) throw new Error('DB not initialized');
    if (plays.length === 0) return;

    // Direct mapping is faster and avoids recursive key transforms on very large imports.
    const snakeData = plays.map((play) => ({
        timestamp: formatLocalTimestamp(play.timestamp),
        date: formatLocalDate(play.date),
        ms_played: play.msPlayed,
        track_name: play.trackName,
        artist_name: play.artistName,
        album_name: play.albumName,
        track_uri: play.trackUri,
        platform: play.platform,
        platform_clean: play.platformClean,
        country: play.country,
        ip_addr: play.ipAddr,
        skipped: play.skipped,
        shuffle: play.shuffle,
        offline: play.offline,
        reason_start: play.reasonStart,
        reason_end: play.reasonEnd,
        episode_name: play.episodeName,
        episode_show_name: play.episodeShowName,
        episode_uri: play.episodeUri,
        incognito_mode: play.incognitoMode,
        media_type: play.mediaType,
        play_count: play.playCount,
        is_first_play: play.playCount === 1,
    }));
    const jsonContent = JSON.stringify(snakeData);
    const tempFile = `import_${TABLE_NAME}_${Date.now()}.json`;

    await db.registerFileText(tempFile, jsonContent);

    // DISTINCT guards against exact duplicates in the source file; the table
    // itself is dropped before each upload, so appends never accumulate.
    await conn.query(`INSERT INTO ${TABLE_NAME} SELECT DISTINCT * FROM read_json_auto('${tempFile}')`);

    // Clear temp file content
    await db.registerFileText(tempFile, '');
}

/**
 * Insert Google Maps location segments into the google_maps_segments table.
 * Mirrors insertSpotifyPlays. The column named `timestamp` matches
 * spotify_plays so the generic explorer filter helpers work unchanged.
 *
 * Unlike Spotify, the timestamps are already local wall-clock strings produced
 * by parseGoogleMapsData (the per-event offset is resolved there), so they are
 * inserted as-is rather than reformatted from a Date.
 *
 * @throws {Error} If database is not initialized.
 */
export async function insertLocationSegments(segments: LocationSegment[]): Promise<void> {
    const TABLE_NAME = 'google_maps_segments';

    // Geo columns (country…city_km) are declared up front so the explorer's base
    // points query can always read them; attributeZones fills them in afterwards,
    // leaving them NULL if geo attribution is skipped or fails.
    const SCHEMA = `
        timestamp TIMESTAMP,
        date DATE,
        end_timestamp TIMESTAMP,
        duration_seconds DOUBLE,
        lat DOUBLE,
        lon DOUBLE,
        segment_type VARCHAR,
        activity_type VARCHAR,
        semantic_type VARCHAR,
        place_id VARCHAR,
        distance_meters DOUBLE,
        country VARCHAR,
        region VARCHAR,
        department VARCHAR,
        nearest_city VARCHAR,
        city_km DOUBLE,
        arrondissement VARCHAR
    `;

    await createTable(TABLE_NAME, SCHEMA);

    validateIdentifier(TABLE_NAME, 'table');
    if (!db || !conn) throw new Error('DB not initialized');
    if (segments.length === 0) return;

    // Keys ordered to match the schema columns: read_json_auto + SELECT * map
    // positionally, so order matters.
    const snakeData = segments.map((s) => ({
        timestamp: s.timestamp,
        date: s.date,
        end_timestamp: s.endTimestamp,
        duration_seconds: s.durationSeconds,
        lat: s.lat,
        lon: s.lon,
        segment_type: s.segmentType,
        activity_type: s.activityType,
        semantic_type: s.semanticType,
        place_id: s.placeId,
        distance_meters: s.distanceMeters,
    }));
    const jsonContent = JSON.stringify(snakeData);
    const tempFile = `import_${TABLE_NAME}_${Date.now()}.json`;

    await db.registerFileText(tempFile, jsonContent);

    // Explicit column list: the source JSON has only the 11 base fields; the geo
    // columns default to NULL until attributeZones populates them.
    await conn.query(`INSERT INTO ${TABLE_NAME} (
        timestamp, date, end_timestamp, duration_seconds, lat, lon,
        segment_type, activity_type, semantic_type, place_id, distance_meters
    ) SELECT DISTINCT * FROM read_json_auto('${tempFile}')`);

    await db.registerFileText(tempFile, '');
}
