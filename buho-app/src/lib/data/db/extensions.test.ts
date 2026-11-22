import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The third invariant the promise rests on, beside no-egress and no-persistence:
 * no third-party *code* is fetched while the app runs.
 *
 * DuckDB autoloads `json` on the first `read_json_auto`, which is every single
 * ingestion path — so left at its default this fired on every import, told
 * extensions.duckdb.org the user's IP, and made an offline import impossible.
 * The binaries are mirrored into static/ at build time and DuckDB is pointed at
 * our origin instead. This request comes from the DuckDB worker, which the
 * content-security policy cannot reach, so nothing but this setting keeps it
 * honest — hence a test rather than a comment.
 */

const dbSource = readFileSync(join(__dirname, 'client.ts'), 'utf-8');

/** Source text with comments removed, so a mention in prose is not a use. */
function withoutComments(source: string): string {
    return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

describe('DuckDB extension loading', () => {
    it('points DuckDB at our own origin for extensions', () => {
        expect(dbSource).toMatch(/SET custom_extension_repository=/);
        expect(dbSource).toMatch(/\$\{location\.origin\}\$\{resolve\(''\)\}duckdb-extensions/);
    });

    it('never names the upstream CDN as a runtime URL', () => {
        expect(withoutComments(dbSource)).not.toContain('extensions.duckdb.org');
    });

    it('mirrors both wasm targets, since selectBundle picks by feature detection', () => {
        // A browser without exception handling gets `wasm_mvp`; mirroring only
        // `wasm_eh` would send exactly those users back to the CDN.
        const script = readFileSync(
            join(__dirname, '../../../../scripts/fetch-duckdb-extensions.mjs'),
            'utf-8'
        );
        expect(script).toMatch(/const PLATFORMS = \['wasm_eh', 'wasm_mvp'\]/);
        // The version is asked of the engine: a pinned literal would fail at
        // runtime, not at build, the next time duckdb-wasm is upgraded.
        expect(script).toMatch(/SELECT version\(\)/);
    });

    // With the repository pointed at our origin, an extension that is not
    // mirrored is a 404 there, and DuckDB does not fall back to the CDN.
    it('mirrors every extension the app installs, and json', () => {
        const script = readFileSync(
            join(__dirname, '../../../../scripts/fetch-duckdb-extensions.mjs'),
            'utf-8'
        );
        const mirrored = JSON.parse(
            (script.match(/const EXTENSIONS = (\[[^\]]*\])/)?.[1] ?? '[]').replace(/'/g, '"')
        ) as string[];
        const installed = [...withoutComments(dbSource).matchAll(/INSTALL (\w+)/g)].map(
            ([, name]) => name
        );

        expect(installed.length).toBeGreaterThan(0);
        for (const name of [...installed, 'json']) expect(mirrored).toContain(name);
    });
});
