import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { duckdbEngine, EXCEPTIONS_PROBE, precacheList } from './offline';

const manifest = {
    immutable: [
        '/_app/immutable/entry/start.abc.js',
        '/_app/immutable/assets/app.def.css',
        '/_app/immutable/assets/duckdb-eh.mbzKgY3l.wasm',
        '/_app/immutable/assets/duckdb-mvp.BP0pRkMH.wasm',
        '/_app/immutable/assets/duckdb-browser-eh.worker.CNNtTjPL.js',
        '/_app/immutable/assets/duckdb-browser-mvp.worker.VP7UllRY.js',
    ],
    assets: [
        '/favicon.svg',
        '/og-image.png',
        '/geo/cities5000.json',
        '/geo/geo_zones.topojson',
        '/duckdb-extensions/v1.4.3/wasm_eh/json.duckdb_extension.wasm',
        '/duckdb-extensions/v1.4.3/wasm_eh/spatial.duckdb_extension.wasm',
        '/duckdb-extensions/v1.4.3/wasm_mvp/json.duckdb_extension.wasm',
        '/duckdb-extensions/v1.4.3/wasm_mvp/spatial.duckdb_extension.wasm',
    ],
    prerendered: ['/', '/faq', '/sources', '/listening/guide'],
};

describe('what the service worker fetches on install', () => {
    test('every page, and the code', () => {
        const list = precacheList(manifest, 'eh');
        for (const page of manifest.prerendered) expect(list).toContain(page);
        expect(list).toContain('/_app/immutable/entry/start.abc.js');
        expect(list).toContain('/_app/immutable/assets/app.def.css');
    });

    test.each(['eh', 'mvp'] as const)('only the %s engine, with its json extension', (engine) => {
        const other = engine === 'eh' ? 'mvp' : 'eh';
        const list = precacheList(manifest, engine);

        expect(list.filter((path) => path.endsWith('.wasm') && path.includes('/duckdb-'))).toEqual([
            expect.stringContaining(`duckdb-${engine}.`),
            `/duckdb-extensions/v1.4.3/wasm_${engine}/json.duckdb_extension.wasm`,
        ]);
        expect(list.some((path) => path.includes(`duckdb-browser-${engine}.worker`))).toBe(true);
        expect(list.some((path) => path.includes(`duckdb-browser-${other}.worker`))).toBe(false);
    });

    // About 9 MB that only the location views need: kept on first use instead.
    test('not what only the location views need', () => {
        const list = precacheList(manifest, 'eh');
        expect(list.some((path) => path.includes('spatial'))).toBe(false);
        expect(list.some((path) => path.startsWith('/geo/'))).toBe(false);
    });
});

describe('the engine the service worker picks', () => {
    // If DuckDB's probe changes and ours does not, the worker caches one engine
    // and the tab asks for the other: an offline import that fails.
    test("uses DuckDB's own probe for wasm exceptions", () => {
        const bundle = readFileSync(
            join(__dirname, '../../node_modules/@duckdb/duckdb-wasm/dist/duckdb-browser.mjs'),
            'utf-8'
        );
        expect(bundle).toContain(`new Uint8Array([${EXCEPTIONS_PROBE.join(',')}])`);
    });

    test('picks eh where wasm exceptions are supported, as Node is', () => {
        expect(duckdbEngine()).toBe('eh');
    });
});
