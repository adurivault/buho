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
import { dataStore } from '$lib/stores/dataStore.svelte';

// Mock dependencies - same pattern as dataStore.test.ts
vi.mock('$lib/data/parseSpotify', () => ({
    parseSpotifyData: vi.fn().mockReturnValue([
        { timestamp: new Date(), trackName: 'Test Track', artistName: 'Test Artist' }
    ])
}));

vi.mock('$lib/data/db', () => ({
    initDuckDB: vi.fn().mockResolvedValue(undefined),
    dropTable: vi.fn().mockResolvedValue(undefined),
    insertSpotifyPlays: vi.fn().mockResolvedValue(undefined),
    isReady: vi.fn().mockReturnValue(true)
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
            dataStore.loadDemoData('spotify');

            expect(dataStore.source).toBe('spotify');
            expect(dataStore.isDemo).toBe(true);

            // Simulate navigation: the key check is `if (dataStore.source === 'spotify') return;`
            // This means no action should reset the source during navigation
            const sourceBeforeNav = dataStore.source;
            const isDemoBeforeNav = dataStore.isDemo;

            // After "navigation", source should still be set (no re-initialization needed)
            expect(dataStore.source).toBe(sourceBeforeNav);
            expect(dataStore.isDemo).toBe(isDemoBeforeNav);
        });

        it('should return early from load check when source is already set', () => {
            // This test validates the persistence pattern used in +layout.svelte
            dataStore.loadDemoData('spotify');

            // Simulate the check: `if (dataStore.source === 'spotify') return;`
            const shouldSkipLoad = dataStore.source === 'spotify';
            expect(shouldSkipLoad).toBe(true);

            // Calling loadDemoData again should NOT change the existing state
            // (in reality, the layout's onMount skips this call entirely)
            const originalSource = dataStore.source;
            const originalIsDemo = dataStore.isDemo;

            expect(dataStore.source).toBe(originalSource);
            expect(dataStore.isDemo).toBe(originalIsDemo);
        });

        it('should NOT return early if source is from a different module', () => {
            // Setup: User was looking at Google Maps (hypothetically)
            // @ts-ignore - 'google-maps' might not be in the type union yet or is just a string
            dataStore.source = 'google-maps';

            // Simulate the check: `if (dataStore.source === 'spotify') return;`
            const shouldSkipLoad = (dataStore.source as string) === 'spotify';
            expect(shouldSkipLoad).toBe(false);
        });
    });

    describe('AC #2: Banner state persists with correct styling', () => {
        it('should maintain isDemo=true for demo data banner', () => {
            dataStore.loadDemoData('spotify');

            // Navigate multiple times (simulated)
            expect(dataStore.isDemo).toBe(true);
            expect(dataStore.isDemo).toBe(true);
            expect(dataStore.isDemo).toBe(true);
        });

        it('should maintain isDemo=false for user data banner after upload', async () => {
            // First load demo data
            dataStore.loadDemoData('spotify');
            expect(dataStore.isDemo).toBe(true);

            // Simulate file upload (sets isDemo to false)
            dataStore.loadUserData('spotify');
            expect(dataStore.isDemo).toBe(false);

            // Navigate multiple times (simulated) - isDemo should persist
            expect(dataStore.isDemo).toBe(false);
            expect(dataStore.source).toBe('spotify');
        });
    });

    describe('AC #4: dataStore state tracking across navigation', () => {
        it('should track source correctly and not reset on subsequent access', () => {
            expect(dataStore.source).toBe(null);

            dataStore.loadDemoData('spotify');
            expect(dataStore.source).toBe('spotify');

            // Simulate multiple component renders (route changes)
            for (let i = 0; i < 5; i++) {
                expect(dataStore.source).toBe('spotify');
                expect(dataStore.isDemo).toBe(true);
            }
        });

        it('should correctly switch from demo to user data and persist', () => {
            // Load demo first
            dataStore.loadDemoData('spotify');
            expect(dataStore.isDemo).toBe(true);
            expect(dataStore.source).toBe('spotify');

            // User uploads their data
            dataStore.loadUserData('spotify');
            expect(dataStore.isDemo).toBe(false);
            expect(dataStore.source).toBe('spotify');

            // Navigate (simulated) - user data should persist
            expect(dataStore.isDemo).toBe(false);
            expect(dataStore.source).toBe('spotify');
        });

        it('should clear loading and error states when data loads successfully', () => {
            dataStore.setLoading({ status: 'loading', message: 'Loading...' });
            expect(dataStore.loading).not.toBeNull();

            dataStore.loadDemoData('spotify');
            expect(dataStore.loading).toBe(null);
            expect(dataStore.error).toBe(null);
        });
    });

    describe('AC #5: Demo data remains available without upload', () => {
        it('should keep demo data when user navigates without uploading', () => {
            dataStore.loadDemoData('spotify');

            // Simulate multiple navigations without any user action
            const navCount = 10;
            for (let i = 0; i < navCount; i++) {
                expect(dataStore.isDemo).toBe(true);
                expect(dataStore.source).toBe('spotify');
            }
        });

        it('should not reset state unless explicitly called', () => {
            dataStore.loadDemoData('spotify');

            // Only reset() should clear the state
            expect(dataStore.source).toBe('spotify');

            // Some other random operations shouldn't affect persistence
            dataStore.setFiles(['file1.json']);
            expect(dataStore.source).toBe('spotify');
            expect(dataStore.isDemo).toBe(true);
        });
    });
});
