/**
 * Small, invented exports — one per text-based source — for tests that need a
 * real file rather than an inline object: routing, the import pipeline, and
 * eventually end-to-end runs. Each lives in `<source>/fixtures/`, laid out the
 * way the service ships it, since routing reads the path as well as the content.
 *
 * Binary formats (Deezer's .xlsx, Garmin's .fit) have none on purpose: their
 * tests build the bytes in code, so a reader can see what is being exercised.
 *
 * Test-only (Node): nothing in the app imports this.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import type { ImportEntry } from './types';

const SOURCES_DIR = path.resolve(process.cwd(), 'src/lib/data/sources');

/** The sources that ship a fixture, by folder name. */
export const FIXTURE_SOURCES = [
    'spotify',
    'lastfm',
    'googleTimeline',
    'googleActivity',
    'metaJson',
    'normalizedJson',
    'whatsappText',
    'strava',
    'appleHealth',
] as const;

export type FixtureSource = (typeof FIXTURE_SOURCES)[number];

function walk(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
        const full = path.join(dir, name);
        return statSync(full).isDirectory() ? walk(full) : [full];
    });
}

/** The fixture files of one source, as the importer would see them after a drop. */
export function fixtureEntries(source: FixtureSource): ImportEntry[] {
    const root = path.join(SOURCES_DIR, source, 'fixtures');
    return walk(root).map((file) => {
        const content = readFileSync(file, 'utf-8');
        const relative = path.relative(root, file).split(path.sep).join('/');
        return {
            path: relative,
            name: path.basename(file),
            peek: async (length: number) => content.slice(0, length),
            text: async () => content,
            bytes: async () => new TextEncoder().encode(content),
        };
    });
}
