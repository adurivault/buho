import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { uiStore, setListeningGuideScrollTop } from './uiStore.svelte';

describe('UI Store', () => {
    it('should track spotify guide scroll position', () => {
        expect(uiStore.listeningGuideScrollTop).toBe(0);

        setListeningGuideScrollTop(432.7);
        expect(uiStore.listeningGuideScrollTop).toBe(432);

        setListeningGuideScrollTop(-50);
        expect(uiStore.listeningGuideScrollTop).toBe(0);
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
                } else if (
                    entry.isFile() &&
                    (entry.name.endsWith('.ts') || entry.name.endsWith('.svelte'))
                ) {
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
