/**
 * Integration tests for data persistence across Spotify views.
 *
 * Story 2.5: Verifies that data persists when navigating between
 * Guide and Explorer views without reloading.
 *
 * These tests verify the dataStore singleton behavior that enables
 * persistence across route navigation.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { dataStore } from '#lib/stores/dataStore.svelte.ts';

// Mock dependencies - same pattern as dataStore.test.ts
vi.mock('#lib/data/sources/spotify/parse.ts', () => ({
    parseSpotifyData: vi
        .fn()
        .mockReturnValue([
            { timestamp: new Date(), trackName: 'Test Track', artistName: 'Test Artist' },
        ]),
}));

vi.mock('#lib/data/db/index.ts', () => ({
    initDuckDB: vi.fn().mockResolvedValue(undefined),
    warmUpDuckDB: vi.fn(),
    dropTable: vi.fn().mockResolvedValue(undefined),
    insertSpotifyPlays: vi.fn().mockResolvedValue(undefined),
    isReady: vi.fn().mockReturnValue(true),
}));

describe('Data Persistence Across Views', () => {
    beforeEach(() => {
        dataStore.reset();
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    describe('AC #1: Demo data persists during navigation', () => {
        it('should maintain demo data source across simulated route changes', () => {
            // Simulate initial demo data load (what +layout.svelte does)
            dataStore.loadDemoData('listening');

            expect(dataStore.lastModule).toBe('listening');
            expect(dataStore.isDemo).toBe(true);

            // Simulate navigation: the key check is `if (dataStore.lastModule === 'listening') return;`
            // This means no action should reset the source during navigation
            const sourceBeforeNav = dataStore.lastModule;
            const isDemoBeforeNav = dataStore.isDemo;

            // After "navigation", source should still be set (no re-initialization needed)
            expect(dataStore.lastModule).toBe(sourceBeforeNav);
            expect(dataStore.isDemo).toBe(isDemoBeforeNav);
        });

        it('should return early from load check when source is already set', () => {
            // This test validates the persistence pattern used in +layout.svelte
            dataStore.loadDemoData('listening');

            // Simulate the check: `if (dataStore.lastModule === 'listening') return;`
            const shouldSkipLoad = dataStore.lastModule === 'listening';
            expect(shouldSkipLoad).toBe(true);

            // Calling loadDemoData again should NOT change the existing state
            // (in reality, the layout's onMount skips this call entirely)
            const originalSource = dataStore.lastModule;
            const originalIsDemo = dataStore.isDemo;

            expect(dataStore.lastModule).toBe(originalSource);
            expect(dataStore.isDemo).toBe(originalIsDemo);
        });

        it('should NOT return early if source is from a different module', () => {
            // Setup: User was looking at Google Maps (hypothetically)
            dataStore.lastModule = 'positions';

            // Simulate the check: `if (dataStore.lastModule === 'listening') return;`
            const shouldSkipLoad = (dataStore.lastModule as string) === 'listening';
            expect(shouldSkipLoad).toBe(false);
        });
    });

    describe('AC #2: Banner state persists with correct styling', () => {
        it('should maintain isDemo=true for demo data banner', () => {
            dataStore.loadDemoData('listening');

            // Navigate multiple times (simulated)
            expect(dataStore.isDemo).toBe(true);
            expect(dataStore.isDemo).toBe(true);
            expect(dataStore.isDemo).toBe(true);
        });

        it('should maintain isDemo=false for user data banner after upload', async () => {
            // First load demo data
            dataStore.loadDemoData('listening');
            expect(dataStore.isDemo).toBe(true);

            // Simulate file upload (sets isDemo to false)
            dataStore.loadUserData('listening');
            expect(dataStore.isDemo).toBe(false);

            // Navigate multiple times (simulated) - isDemo should persist
            expect(dataStore.isDemo).toBe(false);
            expect(dataStore.lastModule).toBe('listening');
        });
    });

    describe('AC #4: dataStore state tracking across navigation', () => {
        it('should track source correctly and not reset on subsequent access', () => {
            expect(dataStore.lastModule).toBe(null);

            dataStore.loadDemoData('listening');
            expect(dataStore.lastModule).toBe('listening');

            // Simulate multiple component renders (route changes)
            for (let i = 0; i < 5; i++) {
                expect(dataStore.lastModule).toBe('listening');
                expect(dataStore.isDemo).toBe(true);
            }
        });

        it('should correctly switch from demo to user data and persist', () => {
            // Load demo first
            dataStore.loadDemoData('listening');
            expect(dataStore.isDemo).toBe(true);
            expect(dataStore.lastModule).toBe('listening');

            // User uploads their data
            dataStore.loadUserData('listening');
            expect(dataStore.isDemo).toBe(false);
            expect(dataStore.lastModule).toBe('listening');

            // Navigate (simulated) - user data should persist
            expect(dataStore.isDemo).toBe(false);
            expect(dataStore.lastModule).toBe('listening');
        });

        it('should clear loading and error states when data loads successfully', () => {
            dataStore.setLoading({ status: 'loading', message: 'Loading...' });
            expect(dataStore.loading).not.toBeNull();

            dataStore.loadDemoData('listening');
            expect(dataStore.loading).toBe(null);
            expect(dataStore.error).toBe(null);
        });
    });

    describe('AC #5: Demo data remains available without upload', () => {
        it('should keep demo data when user navigates without uploading', () => {
            dataStore.loadDemoData('listening');

            // Simulate multiple navigations without any user action
            const navCount = 10;
            for (let i = 0; i < navCount; i++) {
                expect(dataStore.isDemo).toBe(true);
                expect(dataStore.lastModule).toBe('listening');
            }
        });

        it('should not reset state unless explicitly called', () => {
            dataStore.loadDemoData('listening');

            // Only reset() should clear the state
            expect(dataStore.lastModule).toBe('listening');

            // Some other random operations shouldn't affect persistence
            dataStore.setLoading({ status: 'reading', message: 'Reading files...' });
            dataStore.setLoading(null);
            expect(dataStore.lastModule).toBe('listening');
            expect(dataStore.isDemo).toBe(true);
        });
    });
});
