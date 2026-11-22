/**
 * The real DuckDB engine, for `*.headless.test.ts` suites.
 *
 * DuckDB-WASM's worker bundle can't run in JSDOM, but `duckdb-node-blocking`
 * runs the same wasm core synchronously in Node, so the SQL the app ships is
 * exercised against the engine rather than a mock. Test-only: nothing in the
 * app imports this.
 */
import { createRequire } from 'node:module';
import path from 'node:path';

export interface HeadlessRow {
    toJSON(): Record<string, unknown>;
}

export interface HeadlessResult {
    toArray(): HeadlessRow[];
}

/** The part of the blocking connection the suites use. */
export interface HeadlessConnection {
    query(sql: string): HeadlessResult;
    prepare(sql: string): {
        query(...params: unknown[]): HeadlessResult;
        close(): void;
    };
    close(): void;
}

/** Mirrors db/client.ts's camelCase mapping of result columns. */
const camel = (s: string) => s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

/**
 * `query` from db/client.ts, over a headless connection: values bound through a
 * prepared statement, columns renamed to camelCase. Cells are left as the
 * engine hands them over — a BIGINT still arrives as a BigInt — so a query
 * that forgets to cast fails here as it would in the browser.
 */
export function headlessQuery(conn: HeadlessConnection) {
    return async (sql: string, params?: unknown[]): Promise<Record<string, unknown>[]> => {
        let result: HeadlessResult;
        if (params && params.length > 0) {
            const statement = conn.prepare(sql);
            try {
                result = statement.query(...params);
            } finally {
                statement.close();
            }
        } else {
            result = conn.query(sql);
        }
        return result
            .toArray()
            .map((row) =>
                Object.fromEntries(
                    Object.entries(row.toJSON()).map(([key, value]) => [camel(key), value])
                )
            );
    };
}

export interface HeadlessDuckDB {
    connect(): HeadlessConnection;
    registerFileText(name: string, text: string): void;
    terminate(): Promise<void>;
}

const DIST = path.resolve(process.cwd(), 'node_modules/@duckdb/duckdb-wasm/dist');

/** A fresh in-memory database and a connection to it. */
export async function openHeadlessDuckDB(): Promise<{
    db: HeadlessDuckDB;
    conn: HeadlessConnection;
}> {
    const require = createRequire(import.meta.url);
    const duckdb = require(path.join(DIST, 'duckdb-node-blocking.cjs'));
    const bundles = {
        mvp: { mainModule: path.join(DIST, 'duckdb-mvp.wasm'), mainWorker: null },
        eh: { mainModule: path.join(DIST, 'duckdb-eh.wasm'), mainWorker: null },
    };
    const db = await duckdb.createDuckDB(bundles, new duckdb.VoidLogger(), duckdb.NODE_RUNTIME);
    await db.instantiate(() => {});
    return { db, conn: db.connect() };
}
