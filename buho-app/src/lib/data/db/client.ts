import { resolve } from '$app/paths';
// Type-only: the package's Node entry point reads `workerData` as it loads and
// throws outside a worker, so importing it for real breaks any server render of
// a page that merely links to a dataset. The module is pulled in at
// `initDuckDB`, which is browser-only by nature.
import type * as duckdb from '@duckdb/duckdb-wasm';
import { stageAndMerge, type StagedTable } from './staging';
import duckdb_wasm from '@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url';
import mvp_worker from '@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url';
import duckdb_wasm_eh from '@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url';
import eh_worker from '@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url';

const MANUAL_BUNDLES: duckdb.DuckDBBundles = {
    mvp: { mainModule: duckdb_wasm, mainWorker: mvp_worker },
    eh: { mainModule: duckdb_wasm_eh, mainWorker: eh_worker },
};

let db: duckdb.AsyncDuckDB | null = null;
let conn: duckdb.AsyncDuckDBConnection | null = null;

// Validation: SQL identifier (table/column names) to prevent SQL injection
const VALID_IDENTIFIER = /^[a-z_][a-z0-9_]*$/i;
export function validateIdentifier(name: string, context: string): void {
    if (!VALID_IDENTIFIER.test(name)) {
        throw new Error(
            `Invalid ${context} name: "${name}". Only alphanumeric characters and underscores allowed.`
        );
    }
}

// Helper: Snake -> Camel
function toCamelCase(str: string): string {
    return str.replace(/_([a-z])/g, (_, char) => char.toUpperCase());
}

// Helper: Camel -> Snake
function toSnakeCase(str: string): string {
    return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

// Helper: Transform object keys
function transformKeys(obj: unknown, transformer: (key: string) => string): unknown {
    if (obj instanceof Date) {
        return obj;
    }
    if (Array.isArray(obj)) {
        return obj.map((v) => transformKeys(v, transformer));
    }
    if (obj !== null && typeof obj === 'object') {
        const out: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(obj)) {
            out[transformer(key)] = transformKeys(value, transformer);
        }
        return out;
    }
    return obj;
}

/**
 * The one boot every caller shares, from the first request onwards.
 *
 * The engine is ~33 MB of WebAssembly, so it starts when something is about to
 * need it — an import, the sample, a file dragged over the page — rather than
 * with the page: a visitor reading a how-to, or on a phone, never pays for it.
 * Callers that need it await this; callers that only expect it soon use
 * {@link warmUpDuckDB}. Both land on the same promise, so however many ask, and
 * whenever, the engine boots once and nobody proceeds before it is ready.
 */
let boot: Promise<void> | null = null;

export function initDuckDB(): Promise<void> {
    boot ??= startDuckDB().catch((error: unknown) => {
        // Forgotten, so the next caller tries again rather than inheriting it.
        boot = null;
        throw error;
    });
    return boot;
}

/**
 * Start the engine without waiting for it, on a sign that it will be needed.
 *
 * A failure here is left for later: whoever awaits {@link initDuckDB} next
 * retries, and reports the error where the visitor is looking.
 */
export function warmUpDuckDB(): void {
    initDuckDB().catch(() => {});
}

async function startDuckDB(): Promise<void> {
    const { selectBundle, ConsoleLogger, AsyncDuckDB } = await import('@duckdb/duckdb-wasm');
    const bundle = await selectBundle(MANUAL_BUNDLES);
    const instance = new AsyncDuckDB(new ConsoleLogger(), new Worker(bundle.mainWorker!));
    await instance.instantiate(bundle.mainModule, bundle.pthreadWorker);
    const connection = await instance.connect();
    await connection.query(`SET custom_extension_repository='${extensionRepository()}'`);

    // Published only once usable: `isReady()` and every query read these two.
    db = instance;
    conn = connection;
}

/**
 * Where DuckDB may fetch the extensions it autoloads.
 *
 * Left alone it goes to extensions.duckdb.org, and since every ingestion path
 * below reads through `read_json_auto`, that means a third party receives a
 * request — and the user's IP — on every single import, and hands back
 * executable code. It is also why an import cannot work offline.
 *
 * `scripts/fetch-duckdb-extensions.mjs` mirrors the same signed binaries into
 * static/duckdb-extensions/ at build time; DuckDB appends
 * `/v<version>/<platform>/<name>.duckdb_extension.wasm` to what is set here.
 * Note this is the *worker's* request, which the app's content-security policy
 * does not reach (see vite.config.ts) — keeping the fetch same-origin is what
 * closes it, not the policy.
 */
function extensionRepository(): string {
    return `${location.origin}${resolve('')}duckdb-extensions`;
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

export async function query<T>(sql: string, params?: unknown[]): Promise<T[]> {
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

    const rows = result.toArray().map((row) => row.toJSON());

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
    sql: string
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
// only the location views need GIS, so Spotify-only users never pay for its
// 23 MB. Fetched from our own origin like `json` (see `extensionRepository`).
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
    buildSql: (source: string) => string
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
 * Whether a table has been created yet.
 *
 * A table only comes into existence with the first import that fills it, so
 * every read that isn't gated on a successful import has to ask first —
 * `SELECT` against a missing table throws rather than returning nothing.
 */
export async function tableExists(name: string): Promise<boolean> {
    validateIdentifier(name, 'table');
    const rows = await query<{ n: number }>(
        `SELECT count(*) AS n FROM duckdb_tables() WHERE table_name = ?`,
        [name]
    );
    return Number(rows[0]?.n ?? 0) > 0;
}

/**
 * How many rows a table holds, or 0 if it was never created.
 *
 * Cast in SQL because `count(*)` is a BIGINT, which arrives as a BigInt and
 * turns into NaN the moment it meets arithmetic.
 */
export async function countRows(
    name: string,
    where?: { column: string; value: string }
): Promise<number> {
    validateIdentifier(name, 'table');
    if (!(await tableExists(name))) return 0;

    if (!where) {
        const rows = await query<{ n: number }>(
            `SELECT CAST(count(*) AS DOUBLE) AS n FROM ${name}`
        );
        return Number(rows[0]?.n ?? 0);
    }

    validateIdentifier(where.column, 'column');
    const rows = await query<{ n: number }>(
        `SELECT CAST(count(*) AS DOUBLE) AS n FROM ${name} WHERE ${where.column} = ?`,
        [where.value]
    );
    return Number(rows[0]?.n ?? 0);
}

/**
 * Delete the rows one provider contributed, leaving the others in place.
 *
 * The tables are shared — Spotify and Deezer both live in `plays`, a watch and a
 * phone both in `location_segments` — so removing a source is a scoped DELETE,
 * never a DROP. Missing table is a no-op: there is nothing of that source to
 * remove.
 */
export async function deleteBy(table: string, column: string, value: string): Promise<void> {
    validateIdentifier(table, 'table');
    validateIdentifier(column, 'column');
    if (!(await tableExists(table))) return;
    await query(`DELETE FROM ${table} WHERE ${column} = ?`, [value]);
}

/**
 * Create `spec.table` if this is its first import, then append `rows` to it
 * through staging and dedupe (see `staging.ts`).
 *
 * @throws {Error} If the database is not initialized.
 */
export async function insertStaged<Row>(spec: StagedTable<Row>, rows: Row[]): Promise<void> {
    validateIdentifier(spec.table, 'table');
    await createTable(spec.table, spec.schema);
    if (!db || !conn) throw new Error('DB not initialized');
    const database = db;
    const connection = conn;
    await stageAndMerge(
        {
            query: (sql) => connection.query(sql),
            registerFileText: (name, text) => database.registerFileText(name, text),
        },
        spec,
        rows
    );
}
