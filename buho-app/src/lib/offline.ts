/**
 * What the service worker keeps, so Buho opens and reads a file with the
 * network off. Pure, so it can be tested outside a worker.
 *
 * Only the app's own files are ever stored. A dropped file never reaches the
 * service worker: reading it is not a request.
 */

/** The DuckDB build a browser will run: `eh` with wasm exceptions, else `mvp`. */
export type DuckDBEngine = 'eh' | 'mvp';

/**
 * DuckDB's own probe for wasm exception handling (a `try`/`catch_all`), from
 * `wasm-feature-detect` as bundled in `@duckdb/duckdb-wasm`. `selectBundle`
 * picks `eh` when it validates, and the service worker has to pick the same,
 * or it caches 34 MB the tab never asks for.
 */
export const EXCEPTIONS_PROBE = [
    0, 97, 115, 109, 1, 0, 0, 0, 1, 4, 1, 96, 0, 0, 3, 2, 1, 0, 10, 8, 1, 6, 0, 6, 64, 25, 11, 11,
];

export function duckdbEngine(): DuckDBEngine {
    return WebAssembly.validate(new Uint8Array(EXCEPTIONS_PROBE)) ? 'eh' : 'mvp';
}

/** `$app/manifest`, each entry resolved to the address the tab requests. */
export interface Manifest {
    /** Everything Vite emitted: chunks, styles, fonts, both DuckDB builds. */
    immutable: string[];
    /** Everything in static/. */
    assets: string[];
    /** Every prerendered page. */
    prerendered: string[];
}

/**
 * Fetched when the service worker installs: every page, all the code, and the
 * DuckDB build this browser runs with its `json` extension. About 10 MB over
 * the wire.
 *
 * Left out: the other DuckDB build, and what only the location views need
 * (`spatial`, the zone and city files, about 9 MB more). Those are kept
 * the first time the tab fetches them instead.
 */
export function precacheList(
    { immutable, assets, prerendered }: Manifest,
    engine: DuckDBEngine
): string[] {
    const other = engine === 'eh' ? 'mvp' : 'eh';
    const otherBuild = new RegExp(`/duckdb-(browser-)?${other}\\.`);
    const json = new RegExp(
        `/duckdb-extensions/[^/]+/wasm_${engine}/json\\.duckdb_extension\\.wasm$`
    );

    return [
        ...prerendered,
        ...immutable.filter((path) => !otherBuild.test(path)),
        ...assets.filter((path) => json.test(path) || path.endsWith('/favicon.svg')),
    ];
}
