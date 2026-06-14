
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { dataStore } from './dataStore.svelte';

// Mocks
vi.mock('$lib/data/parseSpotify', () => ({
    parseSpotifyData: vi.fn().mockReturnValue([{ timestamp: new Date(), trackName: 'Test' }])
}));

vi.mock('$lib/data/db', () => ({
    initDuckDB: vi.fn().mockResolvedValue(undefined),
    dropTable: vi.fn().mockResolvedValue(undefined),
    insertSpotifyPlays: vi.fn().mockResolvedValue(undefined)
}));

describe('dataStore', () => {
    beforeEach(() => {
        dataStore.reset();
    });

    it('should initialize with default values', () => {
        expect(dataStore.isDemo).toBe(false);
        expect(dataStore.source).toBe(null);
    });

    it('should set demo mode correctly', () => {
        dataStore.loadDemoData('spotify');
        expect(dataStore.isDemo).toBe(true);
        expect(dataStore.source).toBe('spotify');
    });

    it('should set user data mode correctly', () => {
        dataStore.loadUserData('google-maps');
        expect(dataStore.isDemo).toBe(false);
        expect(dataStore.source).toBe('google-maps');
    });

    it('should reset state', () => {
        dataStore.loadDemoData();
        expect(dataStore.isDemo).toBe(true);

        dataStore.reset();
        expect(dataStore.isDemo).toBe(false);
        expect(dataStore.source).toBe(null);
    });

    it('should manage complex loading state', () => {
        const loadingState = { status: 'reading', message: 'Reading file...' };
        dataStore.setLoading(loadingState);
        expect(dataStore.loading).toEqual(loadingState);

        dataStore.setLoading(null);
        expect(dataStore.loading).toBeNull();
    });

    it('should manage complex error state', () => {
        const errorObj = { message: 'Failed to parse', link: 'http://help.com' };
        dataStore.setError(errorObj);
        expect(dataStore.error).toEqual(errorObj);
    });

    it('handleFileUpload should process file correctly', async () => {
        const file = {
            text: async () => JSON.stringify([{ ts: '2023-01-01' }]),
            name: 'test.json'
        } as unknown as File;

        await dataStore.handleFileUpload(file);

        if (dataStore.error) {
            console.log('Test Error:', dataStore.error);
        }
        expect(dataStore.error).toBeNull();
        expect(dataStore.isDemo).toBe(false);
        expect(dataStore.source).toBe('spotify');
        expect(dataStore.loading).toBeNull();
    });

    it('handleFilesUpload should process multiple JSON files', async () => {
        const file1 = {
            text: async () => JSON.stringify([{ ts: '2023-01-01' }]),
            name: 'history_0.json'
        } as unknown as File;
        const file2 = {
            text: async () => JSON.stringify([{ ts: '2023-01-02' }]),
            name: 'history_1.json'
        } as unknown as File;

        const fileList = {
            length: 2,
            item: (i: number) => [file1, file2][i],
            [Symbol.iterator]: function* () { yield file1; yield file2; },
            0: file1,
            1: file2
        } as unknown as FileList;

        await dataStore.handleFilesUpload(fileList);

        expect(dataStore.error).toBeNull();
        expect(dataStore.isDemo).toBe(false);
        expect(dataStore.source).toBe('spotify');
        expect(dataStore.loading).toBeNull();
    });

    it('handleFilesUpload should show error for empty/invalid files', async () => {
        const file = {
            text: async () => JSON.stringify({}), // Not an array
            name: 'invalid.json'
        } as unknown as File;

        const fileList = {
            length: 1,
            item: (i: number) => [file][i],
            [Symbol.iterator]: function* () { yield file; },
            0: file
        } as unknown as FileList;

        await dataStore.handleFilesUpload(fileList);

        expect(dataStore.error).not.toBeNull();
        expect(dataStore.error?.message).toContain('No valid Spotify data');
    });
});
