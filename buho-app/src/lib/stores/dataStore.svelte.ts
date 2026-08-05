
// src/lib/stores/dataStore.svelte.ts
import JSZip from 'jszip';
import { parseSpotifyData } from '$lib/data/parseSpotify';
import { parseGoogleMapsData } from '$lib/data/parseGoogleMaps';
import { entriesFromFileList } from '$lib/data/import/entries';
import { buildMessageRows, type SelfByNetwork } from '$lib/data/import/buildRows';
import { readThreads } from '$lib/data/sources/registry';
import type { ImportEntry } from '$lib/data/sources/types';
import { getNetworkSummary, type NetworkSummary } from '$lib/data/queries/messageQueries';
import type { Network, ParsedThread } from '$lib/types/messages';
import * as db from '$lib/data/db';
import { loadGeoAssets } from '$lib/data/geo/loadGeoAssets';
import { attributeZones } from '$lib/data/geo/attributeZones';
import { buildDays } from '$lib/data/geo/buildDays';
import { spotifyFilterStore } from '$lib/stores/spotifyFilterStore.svelte';
import { trackEvent, bucket, smallBucket, durationBucket, failureReason } from '$lib/analytics';

/**
 * Entries of a parsed export file. Spotify exports and older (or iOS) Timeline
 * exports are arrays at the root; the phone Timeline export is an object whose
 * entries sit under `semanticSegments`, next to signals we don't consume.
 * Anything else yields nothing.
 */
function toEntryArray(data: unknown): unknown[] {
    if (Array.isArray(data)) return data;
    if (data && typeof data === 'object') {
        const segments = (data as { semanticSegments?: unknown }).semanticSegments;
        if (Array.isArray(segments)) return segments;
    }
    return [];
}

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
                for (const item of toEntryArray(JSON.parse(content))) {
                    jsonArrays.push(item);
                }
            } catch {
                // Skip invalid JSON files silently
            }
        }
    }
    return jsonArrays;
}

/** Threads and messages recognised per service, for the post-import summary. */
function countByNetwork(threads: ParsedThread[]): NetworkImportCount[] {
    const counts = new Map<Network, NetworkImportCount>();
    for (const thread of threads) {
        const existing = counts.get(thread.network);
        if (existing) {
            existing.threads += 1;
            existing.messages += thread.messages.length;
        } else {
            counts.set(thread.network, {
                network: thread.network,
                threads: 1,
                messages: thread.messages.length
            });
        }
    }
    return [...counts.values()].sort((a, b) => b.messages - a.messages);
}

/** "zip" / "json" / "mixed" — what people actually drop, with no file names. */
function fileFormats(files: FileList | File[]): string {
    let zip = false;
    let json = false;
    for (const file of Array.from(files)) {
        if (file.name.endsWith('.zip')) zip = true;
        else if (file.name.endsWith('.json')) json = true;
    }
    if (zip && json) return 'mixed';
    if (zip) return 'zip';
    if (json) return 'json';
    return 'other';
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

export type DataSource = 'spotify' | 'google-maps' | 'messages' | null;

/** One service's share of a single import. */
export interface NetworkImportCount {
    network: Network;
    threads: number;
    messages: number;
}

/**
 * What the last import actually recognised. Auto-detection means the user never
 * declares a format, so the app has to say what it found — including the files
 * it made nothing of.
 */
export interface MessagesImportReport {
    networks: NetworkImportCount[];
    unrecognisedFiles: number;
    /** Which identity was taken as "me" on each network. */
    self: SelfByNetwork;
}
export type DataMode = 'demo' | 'user';

export interface LoadingState {
    status: string;
    message: string;
    itemsFound?: number;
    /** Completion fraction in [0, 1] for a determinate progress bar. */
    progress?: number;
}

export interface ErrorState {
    message: string;
    link?: string;
}

/**
 * Progress of the background geo enrichment (zone attribution + daily summary).
 * Kept apart from `loading` on purpose: the routes gate on `loading`, so this
 * phase must never re-block them — the map and the constellation are already
 * usable while it runs, and the views that need geo columns wait on `geoVersion`.
 */
export interface GeoState {
    status: 'running' | 'done' | 'failed';
    message: string;
    progress?: number;
}

class DataStore {
    isDemo = $state(false);
    source = $state<DataSource>(null);
    files = $state<string[]>([]);

    // New complex states
    loading = $state<LoadingState | null>(null);
    error = $state<ErrorState | null>(null);

    /** What is stored per messaging service, refreshed after every import. */
    messagesSummary = $state<NetworkSummary[]>([]);
    /** Outcome of the most recent messages import, for the dialog's feedback. */
    lastMessagesImport = $state<MessagesImportReport | null>(null);

    // Background geo enrichment of the Google Maps import (see enrichGeo).
    geo = $state<GeoState | null>(null);
    /** Bumped once enrichment lands; views needing geo columns watch this. */
    geoVersion = $state(0);
    /**
     * Bumped every time `google_maps_days` is (re)built: once straight from the
     * raw segments, then again once attribution has filled the place names. The
     * day-based views watch this so they don't wait on the whole attribution.
     */
    daysVersion = $state(0);
    /** Incremented per Timeline import, so a superseded enrichment can bail out. */
    private importGeneration = 0;

    get geoReady(): boolean {
        return this.geo?.status === 'done';
    }

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
        trackEvent('demo-load', { source: source ?? 'unknown' });
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
        this.messagesSummary = [];
        this.lastMessagesImport = null;
        this.geo = null;
        this.geoVersion = 0;
        this.daysVersion = 0;
        this.importGeneration += 1;
    }

    async handleFileUpload(file: File) {
        this.setLoading({ status: 'reading', message: 'Reading file...' });
        const startedAt = Date.now();

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

            trackEvent('upload', {
                source: 'spotify',
                files: '1',
                format: fileFormats([file]),
                rows: bucket(history.length),
                ms: durationBucket(Date.now() - startedAt)
            });

        } catch (e) {
            console.error(e);
            trackEvent('upload-error', {
                source: 'spotify',
                reason: failureReason(e),
                ms: durationBucket(Date.now() - startedAt)
            });
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
        const startedAt = Date.now();

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
                        for (const item of toEntryArray(JSON.parse(text))) {
                            allData.push(item);
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

            trackEvent('upload', {
                source: 'spotify',
                files: smallBucket(files.length),
                format: fileFormats(files),
                rows: bucket(history.length),
                ms: durationBucket(Date.now() - startedAt)
            });

        } catch (e) {
            console.error(e);
            trackEvent('upload-error', {
                source: 'spotify',
                reason: failureReason(e),
                ms: durationBucket(Date.now() - startedAt)
            });
            this.setError({
                message: e instanceof Error ? e.message : 'Failed to process files',
                link: '/guide/export-tutorial'
            });
            this.loading = null;
        }
    }

    /**
     * Handles Google Maps Timeline upload (JSON or ZIP files).
     * Mirrors handleFilesUpload but parses into google_maps_segments.
     *
     * Only what the map and the constellation need is awaited here: read → parse →
     * insert. Zone attribution and the daily summary are far slower than all of
     * that, and nothing on the first screen depends on them, so they run in the
     * background (see enrichGeo) once this resolves.
     */
    async handleLocationFilesUpload(files: FileList) {
        const generation = ++this.importGeneration;
        const startedAt = Date.now();
        this.geo = null;
        this.setLoading({ status: 'reading', message: 'Reading files...', progress: 0.03 });

        try {
            const allData: unknown[] = [];

            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                // Reading files is quick, so it only spans the first ~10% of the bar.
                this.setLoading({
                    status: 'processing',
                    message: `Processing ${file.name} (${i + 1}/${files.length})...`,
                    progress: 0.03 + (i / files.length) * 0.07
                });

                if (file.name.endsWith('.zip')) {
                    const zipData = await extractJsonFromZip(file);
                    for (const item of zipData) {
                        allData.push(item);
                    }
                } else if (file.name.endsWith('.json')) {
                    const text = await file.text();
                    try {
                        for (const item of toEntryArray(JSON.parse(text))) {
                            allData.push(item);
                        }
                    } catch {
                        // Skip invalid JSON files silently
                    }
                }
            }

            if (allData.length === 0) {
                throw new Error('No valid Google Maps data found in the selected files');
            }

            this.setLoading({ status: 'parsing', message: 'Parsing location history...', progress: 0.25 });
            const segments = parseGoogleMapsData(allData as Parameters<typeof parseGoogleMapsData>[0]);

            if (segments.length === 0) {
                throw new Error('No valid location segments found');
            }

            this.setLoading({ status: 'importing', message: `Importing ${segments.length} segments...`, progress: 0.5 });
            await db.initDuckDB();
            await db.dropTable('google_maps_segments');
            await db.dropTable('google_maps_days');
            await db.insertLocationSegments(segments);

            this.loadUserData('google-maps');
            this.setLoading({ status: 'done', message: 'Done', progress: 1 });
            await new Promise((r) => setTimeout(r, 300));
            this.loading = null;

            trackEvent('upload', {
                source: 'google-maps',
                files: smallBucket(files.length),
                format: fileFormats(files),
                rows: bucket(segments.length),
                ms: durationBucket(Date.now() - startedAt)
            });

            void this.enrichGeo(generation);

        } catch (e) {
            console.error(e);
            trackEvent('upload-error', {
                source: 'google-maps',
                reason: failureReason(e),
                ms: durationBucket(Date.now() - startedAt)
            });
            this.setError({
                message: e instanceof Error ? e.message : 'Failed to process files'
            });
            this.loading = null;
        }
    }

    /**
     * Handles a messages import, whatever service it came from.
     *
     * The format is never declared by the user: entries are routed through the
     * source registry, which sniffs each file and hands it to the parser that
     * claims it. One drop can therefore carry several services at once.
     *
     * Imports **accumulate** by default — `replace` is the explicit opt-out —
     * and re-importing the same archive is a no-op thanks to the dedupe in
     * `db.insertMessages`.
     */
    async handleMessagesImport(
        source: ImportEntry[] | (() => Promise<ImportEntry[]>),
        { replace = false }: { replace?: boolean } = {}
    ) {
        this.setLoading({ status: 'reading', message: 'Reading files...', progress: 0.05 });
        const startedAt = Date.now();

        try {
            // Gathering happens inside the try: opening a zip is where an import
            // most often fails (an oversized archive can't be unpacked in a tab),
            // and that message has to reach the user.
            const entries = typeof source === 'function' ? await source() : source;

            if (entries.length === 0) {
                // Almost always the same cause: Meta splits a big export across
                // several zips, and some of them hold nothing but photos and
                // videos. Dropping that one — or the folder it was unzipped to —
                // yields no readable file at all, which is baffling without a hint.
                throw new Error(
                    'No .json or .txt file in what you selected. Big exports are split across several zips and some contain only photos — try the other ones.'
                );
            }

            this.setLoading({
                status: 'parsing',
                message: 'Looking for conversations...',
                progress: 0.25
            });
            const { threads, unrecognisedFiles } = await readThreads(entries);

            if (threads.length === 0) {
                throw new Error(
                    `No conversation recognised in ${entries.length.toLocaleString()} file${entries.length > 1 ? 's' : ''}`
                );
            }

            this.setLoading({
                status: 'parsing',
                message: `Reading ${threads.length.toLocaleString()} conversations...`,
                progress: 0.45
            });
            const { rows, self } = buildMessageRows(threads);

            if (rows.length === 0) {
                throw new Error('No messages found in the selected files');
            }

            this.setLoading({
                status: 'importing',
                message: `Importing ${rows.length.toLocaleString()} messages...`,
                progress: 0.65
            });
            await db.initDuckDB();
            if (replace) await db.dropTable('messages');
            await db.insertMessages(rows);

            this.loadUserData('messages');
            await this.refreshMessagesSummary();
            this.lastMessagesImport = {
                networks: countByNetwork(threads),
                unrecognisedFiles,
                self
            };

            this.setLoading({ status: 'done', message: 'Done', progress: 1 });
            await new Promise((r) => setTimeout(r, 300));
            this.loading = null;

            trackEvent('upload', {
                source: 'messages',
                files: smallBucket(entries.length),
                // Which services were recognised — never how many messages each held.
                networks: [...new Set(threads.map((t) => t.network))].sort().join('+'),
                replace,
                rows: bucket(rows.length),
                ms: durationBucket(Date.now() - startedAt)
            });

        } catch (e) {
            console.error(e);
            trackEvent('upload-error', {
                source: 'messages',
                reason: failureReason(e),
                ms: durationBucket(Date.now() - startedAt)
            });
            this.setError({
                message: e instanceof Error ? e.message : 'Failed to process files'
            });
            this.loading = null;
        }
    }

    /** Convenience wrapper for the file/folder inputs, which hand over a FileList. */
    async handleMessagesFilesUpload(files: FileList, options: { replace?: boolean } = {}) {
        return this.handleMessagesImport(() => entriesFromFileList(files), options);
    }

    /** What is currently stored, per network — drives the header pill. */
    async refreshMessagesSummary() {
        try {
            this.messagesSummary = await getNetworkSummary();
        } catch (error) {
            console.error('Failed to summarise imported messages:', error);
            this.messagesSummary = [];
        }
    }

    /**
     * Second, background phase of a Timeline import: derive the per-day mobility
     * table, locate every point (zone attribution), then derive it again so the
     * days carry their place names. Reports into `geo`, never into `loading`, so
     * the explorer stays interactive throughout; `daysVersion` releases the
     * day-based views up front, `geoVersion` the ones needing geo columns.
     *
     * A newer import supersedes this run (`generation`), which then stops between
     * two batches rather than writing into the freshly rebuilt tables.
     */
    private async enrichGeo(generation: number) {
        const startedAt = Date.now();
        const isStale = () => generation !== this.importGeneration;
        const signal = { get aborted() { return isStale(); } };
        this.geo = { status: 'running', message: 'Building daily summary...', progress: 0.02 };

        try {
            // First pass over the segments: everything the daily table needs
            // except the place labels, which attribution fills in below.
            await buildDays();
            if (signal.aborted) return;
            this.daysVersion += 1;

            await db.loadSpatial();
            await loadGeoAssets();
            if (signal.aborted) return;

            this.geo = { status: 'running', message: 'Locating points...', progress: 0.05 };
            const completed = await attributeZones((processed, total) => {
                const fraction = total > 0 ? processed / total : 1;
                this.geo = {
                    status: 'running',
                    message: total > 0
                        ? `Locating points... ${processed.toLocaleString()} / ${total.toLocaleString()}`
                        : 'Locating points...',
                    progress: 0.05 + fraction * 0.9
                };
            }, signal);
            if (!completed || signal.aborted) return;

            this.geo = { status: 'running', message: 'Naming your places...', progress: 0.96 };
            await buildDays();
            if (signal.aborted) return;
            this.daysVersion += 1;

            this.geo = { status: 'done', message: 'Location details ready', progress: 1 };
            this.geoVersion += 1;
            trackEvent('geo-enrich', { status: 'done', ms: durationBucket(Date.now() - startedAt) });
        } catch (geoError) {
            // Best-effort: segments stay usable even if zone attribution fails.
            console.error('Geo attribution failed:', geoError);
            if (signal.aborted) return;
            this.geo = { status: 'failed', message: 'Location details unavailable' };
            trackEvent('geo-enrich', {
                status: 'failed',
                reason: failureReason(geoError),
                ms: durationBucket(Date.now() - startedAt)
            });
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
