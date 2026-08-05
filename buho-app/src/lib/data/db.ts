import type { SpotifyPlay } from '$lib/types/spotify';
import type { LocationSegment } from '$lib/types/googleMaps';
import type { MessageRow } from '$lib/types/messages';
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

/**
 * Columnar variant of `query`: returns each result column as an array (Arrow
 * vector → typed/JS array) instead of building one JS object per row. For large
 * result sets (e.g. all location segments) this skips the per-row toJSON +
 * snake→camel churn, at the cost of a struct-of-arrays shape. Column names are
 * the SQL output names verbatim (no camelCase transform), so alias them as you
 * want them. BIGINT columns arrive as BigInt64Array — coerce with Number().
 */
export async function queryColumnar(
    sql: string,
): Promise<{ numRows: number; columns: Record<string, ArrayLike<unknown>> }> {
    const connection = await getConnection();
    const result = await connection.query(sql);
    const columns: Record<string, ArrayLike<unknown>> = {};
    for (const field of result.schema.fields) {
        const child = result.getChild(field.name);
        columns[field.name] = child ? child.toArray() : [];
    }
    return { numRows: result.numRows, columns };
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
        speed_kmh DOUBLE,
        azimuth_degrees DOUBLE,
        country VARCHAR,
        region VARCHAR,
        department VARCHAR,
        nearest_city VARCHAR,
        city_km DOUBLE,
        arrondissement VARCHAR,
        seg_id INTEGER
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
        speed_kmh: s.speedKmh,
        azimuth_degrees: s.azimuthDegrees,
    }));
    const jsonContent = JSON.stringify(snakeData);
    const tempFile = `import_${TABLE_NAME}_${Date.now()}.json`;

    await db.registerFileText(tempFile, jsonContent);

    // Explicit column list: the source JSON has only the 13 base fields; the geo
    // columns default to NULL until attributeZones populates them.
    await conn.query(`INSERT INTO ${TABLE_NAME} (
        timestamp, date, end_timestamp, duration_seconds, lat, lon,
        segment_type, activity_type, semantic_type, place_id, distance_meters,
        speed_kmh, azimuth_degrees
    ) SELECT DISTINCT * FROM read_json_auto('${tempFile}')`);

    // Stable per-row key, materialised once now that DISTINCT has settled the row
    // set. Geo attribution runs in the background after the import unblocks, so
    // its results are matched back onto already-loaded points by `seg_id`; the
    // `rowid` pseudo-column itself can't be used, as the finalize UPDATE rewrites
    // rows.
    await conn.query(`UPDATE ${TABLE_NAME} SET seg_id = rowid`);

    await db.registerFileText(tempFile, '');
}

/** Rows per JSON batch when importing messages (see insertMessages). */
const MESSAGE_INSERT_BATCH = 50_000;

/** Columns of `messages`, in schema order, minus the derived `msg_index`. */
export const MESSAGE_COLUMNS = `
    network, timestamp, date, thread, contact, is_group, sender, direction,
    msg_type, media_kind, text, char_count, word_count, emoji_count,
    has_question, reaction_count, reactions, is_unsent, gap_seconds,
    reply_delay_seconds, is_double_text, session_id, is_session_start
`;

/**
 * Move staged rows into `messages`, skipping those already stored.
 *
 * Exported so the headless DuckDB test exercises this exact statement rather
 * than a paraphrase of it — the anti-join is the whole reason a second import
 * doesn't duplicate the first.
 */
export function messagesDedupeSql(target: string, staging: string): string {
    return `
        INSERT INTO ${target} (${MESSAGE_COLUMNS})
        SELECT ${MESSAGE_COLUMNS} FROM ${staging} t
        WHERE NOT EXISTS (
            SELECT 1 FROM ${target} m
            WHERE m.network = t.network
              AND m.thread = t.thread
              AND m.timestamp = t.timestamp
              AND m.sender = t.sender
              AND m.text IS NOT DISTINCT FROM t.text
        )
    `;
}

/**
 * Insert parsed messages into the `messages` table, **appending** to whatever is
 * already there. The column named `timestamp` matches the two other sources so
 * the shared date-filter helpers work unchanged.
 *
 * Unlike the other two importers this one never drops the table: messages arrive
 * network by network, and importing WhatsApp must not erase Messenger. Which
 * means duplicates are now possible — re-dropping the same archive — so rows go
 * through a temp table and only those with no twin already stored are kept.
 *
 * The natural key is (network, thread, timestamp, sender, text). Its cost is
 * explicit: two byte-identical messages from the same sender in the same second
 * of the same thread collapse into one. That is rarer than a double import, and
 * much less damaging.
 *
 * Rows are serialized in batches, because message text makes the intermediate
 * JSON far heavier per row than a location segment.
 *
 * @throws {Error} If database is not initialized.
 */
export async function insertMessages(rows: MessageRow[]): Promise<void> {
    const TABLE_NAME = 'messages';
    const TEMP_TABLE = 'messages_incoming';

    const SCHEMA = `
        network VARCHAR,
        timestamp TIMESTAMP,
        date DATE,
        thread VARCHAR,
        contact VARCHAR,
        is_group BOOLEAN,
        sender VARCHAR,
        direction VARCHAR,
        msg_type VARCHAR,
        media_kind VARCHAR,
        text VARCHAR,
        char_count INTEGER,
        word_count INTEGER,
        emoji_count INTEGER,
        has_question BOOLEAN,
        reaction_count INTEGER,
        reactions VARCHAR,
        is_unsent BOOLEAN,
        gap_seconds DOUBLE,
        reply_delay_seconds DOUBLE,
        is_double_text BOOLEAN,
        session_id INTEGER,
        is_session_start BOOLEAN,
        msg_index INTEGER
    `;

    await createTable(TABLE_NAME, SCHEMA);

    validateIdentifier(TABLE_NAME, 'table');
    if (!db || !conn) throw new Error('DB not initialized');
    if (rows.length === 0) return;

    // Keys ordered to match the schema columns: read_json_auto + the explicit
    // column list map positionally, so order matters.
    const toRecord = (r: MessageRow) => ({
        network: r.network,
        timestamp: r.timestamp,
        date: r.date,
        thread: r.thread,
        contact: r.contact,
        is_group: r.isGroup,
        sender: r.sender,
        direction: r.direction,
        msg_type: r.msgType,
        media_kind: r.mediaKind,
        text: r.text,
        char_count: r.charCount,
        word_count: r.wordCount,
        emoji_count: r.emojiCount,
        has_question: r.hasQuestion,
        reaction_count: r.reactionCount,
        reactions: r.reactions,
        is_unsent: r.isUnsent,
        gap_seconds: r.gapSeconds,
        reply_delay_seconds: r.replyDelaySeconds,
        is_double_text: r.isDoubleText,
        session_id: r.sessionId,
        is_session_start: r.isSessionStart,
    });

    validateIdentifier(TEMP_TABLE, 'table');
    await conn.query(`DROP TABLE IF EXISTS ${TEMP_TABLE}`);
    await createTable(TEMP_TABLE, SCHEMA);

    try {
        for (let offset = 0; offset < rows.length; offset += MESSAGE_INSERT_BATCH) {
            const batch = rows.slice(offset, offset + MESSAGE_INSERT_BATCH).map(toRecord);
            const tempFile = `import_${TABLE_NAME}_${Date.now()}_${offset}.json`;
            await db.registerFileText(tempFile, JSON.stringify(batch));
            try {
                await conn.query(
                    `INSERT INTO ${TEMP_TABLE} (${MESSAGE_COLUMNS}) SELECT * FROM read_json_auto('${tempFile}')`,
                );
            } finally {
                await db.registerFileText(tempFile, '');
            }
        }

        // Anti-join on the natural key: only messages not already stored land in
        // the real table, so re-importing an archive is a no-op.
        await conn.query(messagesDedupeSql(TABLE_NAME, TEMP_TABLE));
    } finally {
        await conn.query(`DROP TABLE IF EXISTS ${TEMP_TABLE}`);
    }

    // Stable per-row key, mirroring seg_id: the explorer keeps its points in a
    // raw array and needs a key that survives independently of row order. It is
    // rebuilt after every import, since appending shifts nothing but adds rows.
    await conn.query(`UPDATE ${TABLE_NAME} SET msg_index = rowid`);
}
