
// src/lib/stores/dataStore.svelte.ts
import JSZip from 'jszip';
import { parseSpotifyData } from '$lib/data/parseSpotify';
import * as db from '$lib/data/db';
import { spotifyFilterStore } from '$lib/stores/spotifyFilterStore.svelte';
import { trackEvent, bucket } from '$lib/analytics';

/**
 * Extracts and parses all JSON files from a ZIP archive.
 * Returns a flat array of all JSON array contents combined.
 */
async function extractJsonFromZip(file: File): Promise<unknown[]> {
    const zip = await JSZip.loadAsync(file);
    const jsonArrays: unknown[] = [];

    for (const [filename, zipEntry] of Object.entries(zip.files)) {
        if (filename.endsWith('.json') && !zipEntry.dir) {
            try {
                const content = await zipEntry.async('string');
                const data = JSON.parse(content);
                if (Array.isArray(data)) {
                    for (const item of data) {
                        jsonArrays.push(item);
                    }
                }
            } catch {
                // Skip invalid JSON files silently
            }
        }
    }
    return jsonArrays;
}

function computeBoundsFromHistory(history: Array<{ date?: Date; timestamp?: Date }>) {
    if (!history.length) {
        return { minDate: null, maxDate: null };
    }

    let minTs = Number.POSITIVE_INFINITY;
    let maxTs = Number.NEGATIVE_INFINITY;

    for (const row of history) {
        const dt = row.date instanceof Date ? row.date : row.timestamp;
        if (!(dt instanceof Date)) continue;
        const ts = dt.getTime();
        if (!Number.isFinite(ts)) continue;
        if (ts < minTs) minTs = ts;
        if (ts > maxTs) maxTs = ts;
    }

    if (!Number.isFinite(minTs) || !Number.isFinite(maxTs)) {
        return { minDate: null, maxDate: null };
    }

    const minDate = new Date(minTs).toISOString().slice(0, 10);
    const maxDate = new Date(maxTs).toISOString().slice(0, 10);
    return { minDate, maxDate };
}

export type DataSource = 'spotify' | 'google-maps' | 'whatsapp' | null;
export type DataMode = 'demo' | 'user';

export interface LoadingState {
    status: string;
    message: string;
    itemsFound?: number;
}

export interface ErrorState {
    message: string;
    link?: string;
}

class DataStore {
    isDemo = $state(false);
    source = $state<DataSource>(null);
    files = $state<string[]>([]);

    // New complex states
    loading = $state<LoadingState | null>(null);
    error = $state<ErrorState | null>(null);

    // Compatibility with existing tests expecting 'mode'
    get mode(): DataMode {
        return this.isDemo ? 'demo' : 'user';
    }

    set mode(value: DataMode) {
        this.isDemo = value === 'demo';
    }

    // Compatibility for existing code using boolean isLoading check
    get isLoading(): boolean {
        return !!this.loading;
    }

    constructor() { }

    loadDemoData(source: DataSource = 'spotify') {
        this.isDemo = true;
        this.source = source;
        this.error = null;
        this.loading = null;
    }

    loadUserData(source: DataSource = 'spotify') {
        this.isDemo = false;
        this.source = source;
        this.error = null;
        this.loading = null;
    }

    setFiles(files: string[]) {
        this.files = files;
    }

    // Set loading state (handles boolean for backward compatibility or object for detailed state)
    setLoading(loading: LoadingState | null | boolean) {
        if (typeof loading === 'boolean') {
            this.loading = loading ? { status: 'loading', message: 'Loading...' } : null;
        } else {
            this.loading = loading;
        }
    }

    setError(error: ErrorState | string | null) {
        if (typeof error === 'string') {
            this.error = { message: error };
        } else {
            this.error = error;
        }
        this.loading = null;
    }

    reset() {
        this.isDemo = false;
        this.source = null;
        this.files = [];
        this.loading = null;
        this.error = null;
    }

    async handleFileUpload(file: File) {
        this.setLoading({ status: 'reading', message: 'Reading file...' });

        try {
            const text = await file.text();

            this.setLoading({ status: 'parsing', message: 'Parsing JSON...' });

            let jsonData;
            try {
                jsonData = JSON.parse(text);
            } catch (e) {
                throw new Error('Invalid JSON format');
            }

            const history = parseSpotifyData(jsonData);

            if (history.length === 0) {
                throw new Error('No valid Spotify history found');
            }

            this.setLoading({ status: 'importing', message: `Importing ${history.length} tracks...` });

            await db.initDuckDB();
            await db.dropTable('spotify_plays');
            await db.insertSpotifyPlays(history);

            this.loadUserData('spotify');
            spotifyFilterStore.setBounds(computeBoundsFromHistory(history), { resetRange: true });
            // Keep loading null at the end
            this.loading = null;

            trackEvent('upload', { source: 'spotify', files: 1, tracks: bucket(history.length) });

        } catch (e) {
            console.error(e);
            trackEvent('upload-error', { source: 'spotify', reason: e instanceof Error ? e.message : 'unknown' });
            this.setError({
                message: e instanceof Error ? e.message : 'Failed to process file',
                link: '/guide/export-tutorial'
            });
            this.loading = null;
        }
    }

    /**
     * Handles multiple file uploads (JSON or ZIP files).
     * Extracts and combines data from all files before inserting into DuckDB.
     */
    async handleFilesUpload(files: FileList) {
        this.setLoading({ status: 'reading', message: 'Reading files...' });

        try {
            const allData: unknown[] = [];

            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                this.setLoading({
                    status: 'processing',
                    message: `Processing ${file.name} (${i + 1}/${files.length})...`
                });

                if (file.name.endsWith('.zip')) {
                    const zipData = await extractJsonFromZip(file);
                    for (const item of zipData) {
                        allData.push(item);
                    }
                } else if (file.name.endsWith('.json')) {
                    const text = await file.text();
                    try {
                        const data = JSON.parse(text);
                        if (Array.isArray(data)) {
                            for (const item of data) {
                                allData.push(item);
                            }
                        }
                    } catch {
                        // Skip invalid JSON files silently
                    }
                }
            }

            if (allData.length === 0) {
                throw new Error('No valid Spotify data found in the selected files');
            }

            this.setLoading({ status: 'parsing', message: 'Parsing Spotify data...' });
            const history = parseSpotifyData(allData as Parameters<typeof parseSpotifyData>[0]);

            this.setLoading({ status: 'importing', message: `Importing ${history.length} tracks...` });
            await db.initDuckDB();
            await db.dropTable('spotify_plays');
            await db.insertSpotifyPlays(history);

            this.loadUserData('spotify');
            spotifyFilterStore.setBounds(computeBoundsFromHistory(history), { resetRange: true });
            this.loading = null;

            trackEvent('upload', { source: 'spotify', files: files.length, tracks: bucket(history.length) });

        } catch (e) {
            console.error(e);
            trackEvent('upload-error', { source: 'spotify', reason: e instanceof Error ? e.message : 'unknown' });
            this.setError({
                message: e instanceof Error ? e.message : 'Failed to process files',
                link: '/guide/export-tutorial'
            });
            this.loading = null;
        }
    }
}

export const dataStore = new DataStore();

// Export standalone functions for backward compatibility with stores.test.ts
export function setDataSource(mode: DataMode) {
    dataStore.mode = mode;
}

export function setLoadedFiles(files: string[]) {
    dataStore.files = files;
}
