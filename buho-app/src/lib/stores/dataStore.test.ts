
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { dataStore } from './dataStore.svelte';

// Mocks
vi.mock('$lib/data/parseSpotify', () => ({
    parseSpotifyData: vi.fn().mockReturnValue([{ timestamp: new Date(), trackName: 'Test' }])
}));

vi.mock('$lib/data/db', () => ({
    initDuckDB: vi.fn().mockResolvedValue(undefined),
    dropTable: vi.fn().mockResolvedValue(undefined),
    insertSpotifyPlays: vi.fn().mockResolvedValue(undefined),
    insertLocationSegments: vi.fn().mockResolvedValue(undefined),
    loadSpatial: vi.fn().mockResolvedValue(undefined)
}));

// The background geo phase, held open by `gate` so a test can observe the app
// while attribution is still in flight (its whole point: the import must not
// wait for it).
const geo = vi.hoisted(() => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    return { gate, release, buildDays: vi.fn().mockResolvedValue(undefined) };
});

vi.mock('$lib/data/geo/loadGeoAssets', () => ({
    loadGeoAssets: vi.fn().mockResolvedValue(undefined)
}));

vi.mock('$lib/data/geo/attributeZones', () => ({
    attributeZones: vi.fn(async (
        onProgress?: (p: number, t: number) => void,
        signal?: { aborted: boolean }
    ) => {
        onProgress?.(1, 2);
        await geo.gate;
        if (signal?.aborted) return false;
        onProgress?.(2, 2);
        return true;
    })
}));

vi.mock('$lib/data/geo/buildDays', () => ({ buildDays: geo.buildDays }));

/** Let the pending microtasks (and the 300 ms "Done" pause) settle. */
const settle = () => new Promise((r) => setTimeout(r, 350));

/** One Timeline `visit` entry, the shape parseGoogleMapsData expects. */
const VISIT_ENTRY = {
    startTime: '2024-05-01T08:00:00.000+02:00',
    endTime: '2024-05-01T09:00:00.000+02:00',
    visit: { topCandidate: { placeLocation: 'geo:48.8566,2.3522', semanticType: 'HOME' } }
};

function asFileList(files: File[]): FileList {
    return {
        ...files,
        length: files.length,
        item: (i: number) => files[i],
        [Symbol.iterator]: function* () { yield* files; }
    } as unknown as FileList;
}

function jsonFile(name: string, content: unknown): File {
    return { name, text: async () => JSON.stringify(content) } as unknown as File;
}

describe('dataStore', () => {
    beforeEach(() => {
        dataStore.reset();
        geo.buildDays.mockClear();
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

    it('handleLocationFilesUpload accepts a root-level Timeline array', async () => {
        await dataStore.handleLocationFilesUpload(
            asFileList([jsonFile('location-history.json', [VISIT_ENTRY])])
        );

        expect(dataStore.error).toBeNull();
        expect(dataStore.source).toBe('google-maps');
    });

    it('handleLocationFilesUpload accepts the phone export wrapped in semanticSegments', async () => {
        await dataStore.handleLocationFilesUpload(
            asFileList([
                jsonFile('Timeline.json', {
                    semanticSegments: [VISIT_ENTRY],
                    rawSignals: [{ position: {} }],
                    userLocationProfile: {}
                })
            ])
        );

        expect(dataStore.error).toBeNull();
        expect(dataStore.source).toBe('google-maps');
    });

    it('handleLocationFilesUpload errors on an unrelated JSON object', async () => {
        await dataStore.handleLocationFilesUpload(
            asFileList([jsonFile('other.json', { somethingElse: [1, 2, 3] })])
        );

        expect(dataStore.error?.message).toContain('No valid Google Maps data');
    });

    it('handleLocationFilesUpload returns before geo attribution finishes', async () => {
        await dataStore.handleLocationFilesUpload(
            asFileList([jsonFile('Timeline.json', [VISIT_ENTRY])])
        );

        // The routes gate on `loading`/`source`: both say "ready" already, while
        // the attribution is still held open by the gate.
        expect(dataStore.source).toBe('google-maps');
        expect(dataStore.loading).toBeNull();
        expect(dataStore.isLoading).toBe(false);
        expect(dataStore.geo?.status).toBe('running');
        expect(dataStore.geoReady).toBe(false);
        expect(dataStore.geoVersion).toBe(0);
    });

    it('releases the daily table before attribution finishes', async () => {
        await dataStore.handleLocationFilesUpload(
            asFileList([jsonFile('Timeline.json', [VISIT_ENTRY])])
        );
        await new Promise((r) => setTimeout(r, 0));

        // The day-based views only need the segments, so they light up while
        // the attribution is still gated.
        expect(geo.buildDays).toHaveBeenCalledTimes(1);
        expect(dataStore.daysVersion).toBe(1);
        expect(dataStore.geoVersion).toBe(0);
    });

    it('marks geo ready and bumps geoVersion once enrichment lands', async () => {
        await dataStore.handleLocationFilesUpload(
            asFileList([jsonFile('Timeline.json', [VISIT_ENTRY])])
        );
        geo.release();
        await settle();

        // Rebuilt a second time, now that the place names are attributed.
        expect(geo.buildDays).toHaveBeenCalledTimes(2);
        expect(dataStore.daysVersion).toBe(2);
        expect(dataStore.geoReady).toBe(true);
        expect(dataStore.geoVersion).toBe(1);
    });
});
