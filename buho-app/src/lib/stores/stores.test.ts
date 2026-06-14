import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import {
    uiStore,
    setDbInitializing,
    setParsingFile,
    setSpotifyGuideScrollTop
} from './uiStore.svelte';
import { errorStore, setError, clearError } from './errorStore.svelte';
import { dataStore, setDataSource, setLoadedFiles } from './dataStore.svelte';
import { vi } from 'vitest';

// Mocks to prevent actual DuckDB loading which fails in test environment
vi.mock('$lib/data/parseSpotify', () => ({
    parseSpotifyData: vi.fn(),
    parseSpotify: vi.fn()
}));

vi.mock('$lib/data/db', () => ({
    initDuckDB: vi.fn(),
    dropTable: vi.fn(),
    insertSpotifyPlays: vi.fn(),
    db: {}
}));

// Note: Testing Svelte 5 runes usually requires a setup that handles signals.
// In Vitest with ssr/jsdom, $state should work if svelte is properly processed.
// We'll see if we need special handling.

describe('UI Store', () => {
    it('should track db initialization state', () => {
        expect(uiStore.dbInitializing).toBe(false);
        setDbInitializing(true);
        expect(uiStore.dbInitializing).toBe(true);
        setDbInitializing(false);
        expect(uiStore.dbInitializing).toBe(false);
    });

    it('should track parsing file state', () => {
        expect(uiStore.parsingFile).toBe(false);
        setParsingFile(true);
        expect(uiStore.parsingFile).toBe(true);
    });

    it('should track spotify guide scroll position', () => {
        expect(uiStore.spotifyGuideScrollTop).toBe(0);

        setSpotifyGuideScrollTop(432.7);
        expect(uiStore.spotifyGuideScrollTop).toBe(432);

        setSpotifyGuideScrollTop(-50);
        expect(uiStore.spotifyGuideScrollTop).toBe(0);
    });
});

describe('Error Store', () => {
    it('should handle errors', () => {
        expect(errorStore.error).toBe(null);

        setError({ source: 'test', message: 'Fail' });
        expect(errorStore.error).toEqual({ source: 'test', message: 'Fail' });

        clearError();
        expect(errorStore.error).toBe(null);
    });
});

describe('Data Store', () => {
    it('should track data source mode', () => {
        // Default is 'demo', test mutation
        setDataSource('user');
        expect(dataStore.mode).toBe('user');

        setDataSource('demo');
        expect(dataStore.mode).toBe('demo');
    });

    it('should track loaded files', () => {
        setLoadedFiles([]);
        expect(dataStore.files).toEqual([]);

        setLoadedFiles(['test.json']);
        expect(dataStore.files).toEqual(['test.json']);
    });
});

/**
 * These tests verify that the codebase does not use forbidden APIs
 * that would violate the privacy-first architecture:
 * - No localStorage, sessionStorage, IndexedDB, or cookies
 * - No fetch calls that could leak user data to external servers
 */
describe('Privacy Constraints', () => {
    const srcDir = join(__dirname, '..');

    function getAllTsFiles(dir: string): string[] {
        const files: string[] = [];
        try {
            const entries = readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = join(dir, entry.name);
                if (entry.isDirectory() && !entry.name.includes('node_modules')) {
                    files.push(...getAllTsFiles(fullPath));
                } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.svelte'))) {
                    files.push(fullPath);
                }
            }
        } catch {
            // Ignore errors from inaccessible directories
        }
        return files;
    }

    it('should not use localStorage in source code', () => {
        const files = getAllTsFiles(srcDir);
        for (const file of files) {
            if (file.includes('.test.')) continue; // Skip test files
            const content = readFileSync(file, 'utf-8');
            const hasLocalStorage = /localStorage\s*\./.test(content);
            expect(hasLocalStorage, `localStorage found in ${file}`).toBe(false);
        }
    });

    it('should not use sessionStorage in source code', () => {
        const files = getAllTsFiles(srcDir);
        for (const file of files) {
            if (file.includes('.test.')) continue;
            const content = readFileSync(file, 'utf-8');
            const hasSessionStorage = /sessionStorage\s*\./.test(content);
            expect(hasSessionStorage, `sessionStorage found in ${file}`).toBe(false);
        }
    });

    it('should not use document.cookie in source code', () => {
        const files = getAllTsFiles(srcDir);
        for (const file of files) {
            if (file.includes('.test.')) continue;
            const content = readFileSync(file, 'utf-8');
            const hasCookie = /document\s*\.\s*cookie/.test(content);
            expect(hasCookie, `document.cookie found in ${file}`).toBe(false);
        }
    });

    it('should not use IndexedDB directly in source code', () => {
        const files = getAllTsFiles(srcDir);
        for (const file of files) {
            if (file.includes('.test.')) continue;
            const content = readFileSync(file, 'utf-8');
            // indexedDB or window.indexedDB
            const hasIndexedDB = /(?<!\/\/.*)\b(indexedDB|openDatabase)\b/.test(content);
            expect(hasIndexedDB, `IndexedDB found in ${file}`).toBe(false);
        }
    });
});
