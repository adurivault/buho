/**
 * Mirrors the DuckDB extensions the app autoloads into static/, so that a query
 * never reaches for third-party code at runtime.
 *
 *   node scripts/fetch-duckdb-extensions.mjs     (runs automatically before dev/build)
 *
 * Why: every ingestion path goes through `read_json_auto`, and DuckDB answers
 * the first one by fetching `json.duckdb_extension.wasm` from
 * extensions.duckdb.org. That is executable code arriving from a third party on
 * every single import — and it tells that host the IP of every Buho user. It is
 * also why the app cannot read a file offline. Served from our own origin, the
 * fetch stays inside the tab's own site and the import works with the network
 * off. `db.ts` points DuckDB here via `custom_extension_repository`.
 *
 * Signatures live inside the binary and are checked against DuckDB's key, not
 * against the host serving it, so an untouched official file validates from
 * anywhere. We must therefore copy the bytes verbatim — hence the guard below
 * that refuses anything that is not a wasm module, which is what an error page
 * would be (and which surfaces as a confusing "signature is missing or invalid").
 *
 * Output is generated, not committed: static/duckdb-extensions/ is gitignored.
 */
import { createRequire } from 'node:module';
import { mkdir, writeFile, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';

/** Every extension the app loads. `json` is autoloaded by every import;
 *  `spatial` (23 MB per platform) is installed by `loadSpatial()` for the
 *  location views. Once DuckDB points at our origin it fetches every extension
 *  from there, so one missing from this list is a 404, not a CDN fallback. */
const EXTENSIONS = ['json', 'spatial'];

/** Both WASM targets, because `selectBundle` picks by feature detection: a
 *  browser without exception handling gets `wasm_mvp`, and mirroring only
 *  `wasm_eh` would send exactly those users back to the CDN. */
const PLATFORMS = ['wasm_eh', 'wasm_mvp'];

const UPSTREAM = 'https://extensions.duckdb.org';
const OUT_ROOT = path.resolve('static/duckdb-extensions');

/**
 * The engine version, asked of the engine itself.
 *
 * The extension URL is version-pinned and a mismatch fails at *runtime*, not at
 * build — so reading the number off the wasm that ships is the only way it
 * cannot drift when `@duckdb/duckdb-wasm` is upgraded.
 */
async function engineVersion() {
    const require = createRequire(import.meta.url);
    const dist = path.resolve('node_modules/@duckdb/duckdb-wasm/dist');
    const duckdb = require(path.join(dist, 'duckdb-node-blocking.cjs'));
    const db = await duckdb.createDuckDB(
        {
            mvp: { mainModule: path.join(dist, 'duckdb-mvp.wasm'), mainWorker: null },
            eh: { mainModule: path.join(dist, 'duckdb-eh.wasm'), mainWorker: null },
        },
        new duckdb.VoidLogger(),
        duckdb.NODE_RUNTIME
    );
    await db.instantiate(() => {});
    return db.connect().query('SELECT version() AS v').toArray()[0].toJSON().v;
}

/** Every byte of a wasm module starts with this; an error page does not. */
function assertWasm(bytes, url) {
    const magic = [0x00, 0x61, 0x73, 0x6d];
    if (bytes.length < 4 || magic.some((b, i) => bytes[i] !== b)) {
        throw new Error(`${url} did not return a wasm module (got ${bytes.length} bytes)`);
    }
}

async function exists(file) {
    try {
        return (await stat(file)).size > 0;
    } catch {
        return false;
    }
}

const version = await engineVersion();
const outDir = path.join(OUT_ROOT, version);

let fetched = 0;
for (const platform of PLATFORMS) {
    for (const name of EXTENSIONS) {
        const file = path.join(outDir, platform, `${name}.duckdb_extension.wasm`);
        if (await exists(file)) continue;

        const url = `${UPSTREAM}/${version}/${platform}/${name}.duckdb_extension.wasm`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);

        const bytes = new Uint8Array(await res.arrayBuffer());
        assertWasm(bytes, url);
        await mkdir(path.dirname(file), { recursive: true });
        await writeFile(file, bytes);
        console.log(`  ${platform}/${name}  ${(bytes.length / 1024).toFixed(0)} KB`);
        fetched++;
    }
}

// A version bump leaves the previous mirror behind, and it would be published.
for (const entry of await readdir(OUT_ROOT, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name !== version) {
        await rm(path.join(OUT_ROOT, entry.name), { recursive: true, force: true });
    }
}

console.log(
    fetched
        ? `DuckDB extensions: mirrored ${fetched} file(s) for engine ${version}.`
        : `DuckDB extensions: already mirrored for engine ${version}.`
);
