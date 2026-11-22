import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { dataStore } from './dataStore.svelte';
import * as db from '#lib/data/db/index.ts';
import {
    getInventory as getInventoryRows,
    removeSource as removeSourceRows,
} from '#lib/data/queries/inventory.ts';

// Mocks. parseSpotify is deliberately *not* mocked: routing now decides which
// parser claims a file from its contents, so a stubbed parser would test nothing.
vi.mock('#lib/data/queries/common.ts', () => ({
    getListeningDateBounds: vi.fn().mockResolvedValue({ minDate: null, maxDate: null }),
}));

/**
 * A stand-in for the tables. `loaded` is worked out by counting rows now, so the
 * mock has to remember what was inserted — a mock that always answers 0 would
 * make every module read as empty right after filling it.
 */
const { tables, inserter } = vi.hoisted(() => {
    const tables = new Map<string, number>();
    return {
        tables,
        inserter: (table: string) =>
            vi.fn(async (rows: unknown[]) => {
                tables.set(table, (tables.get(table) ?? 0) + rows.length);
            }),
    };
});

vi.mock('#lib/data/db/index.ts', () => ({
    initDuckDB: vi.fn().mockResolvedValue(undefined),
    warmUpDuckDB: vi.fn(),
    isReady: vi.fn(() => true),
    dropTable: vi.fn(async (name: string) => {
        tables.delete(name);
    }),
    insertPlays: inserter('plays'),
    insertLocationSegments: inserter('location_segments'),
    insertMessages: inserter('messages'),
    insertGoogleActivity: inserter('google_activity'),
    insertStepPackets: inserter('step_packets'),
    insertHealthReadings: inserter('health_readings'),
    countRows: vi.fn(async (name: string) => tables.get(name) ?? 0),
    tableExists: vi.fn(async (name: string) => tables.has(name)),
    rebuildPositionsDerived: vi.fn().mockResolvedValue(undefined),
    loadSpatial: vi.fn().mockResolvedValue(undefined),
}));

// The inventory reads and writes real SQL; it has its own headless test against
// DuckDB. Here it only has to not get in the way.
vi.mock('#lib/data/queries/inventory.ts', () => ({
    getInventory: vi.fn().mockResolvedValue([]),
    removeSource: vi.fn().mockResolvedValue([]),
}));

// The background geo phase, held open by `gate` so a test can observe the app
// while attribution is still in flight (its whole point: the import must not
// wait for it).
const geo = vi.hoisted(() => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
        release = r;
    });
    return { gate, release, buildDays: vi.fn().mockResolvedValue(undefined) };
});

vi.mock('#lib/data/geo/loadGeoAssets.ts', () => ({
    loadGeoAssets: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('#lib/data/geo/attributeZones.ts', () => ({
    attributeZones: vi.fn(
        async (onProgress?: (p: number, t: number) => void, signal?: { aborted: boolean }) => {
            onProgress?.(1, 2);
            await geo.gate;
            if (signal?.aborted) return false;
            onProgress?.(2, 2);
            return true;
        }
    ),
}));

vi.mock('#lib/data/geo/buildDays.ts', () => ({ buildDays: geo.buildDays }));

/** Let the pending microtasks (and the 300 ms "Done" pause) settle. */
const settle = () => new Promise((r) => setTimeout(r, 350));

/** One Timeline `visit` entry, the shape parseTimelineData expects. */
const VISIT_ENTRY = {
    startTime: '2024-05-01T08:00:00.000+02:00',
    endTime: '2024-05-01T09:00:00.000+02:00',
    visit: { topCandidate: { placeLocation: 'geo:48.8566,2.3522', semanticType: 'HOME' } },
};

/** One conversation file of a Meta messages export. */
const THREAD = {
    participants: ['Jules Du Marin', 'Dana Fox'],
    threadName: 'Dana Fox_0',
    messages: [
        {
            senderName: 'Jules Du Marin',
            text: 'Hello',
            timestamp: 1714550400000,
            type: 'text',
            media: [],
            reactions: [],
            isUnsent: false,
        },
    ],
};

/** One play of a Spotify extended streaming history file. */
const SPOTIFY_ENTRY = {
    ts: '2023-01-01T20:00:00Z',
    platform: 'ios',
    ms_played: 180000,
    conn_country: 'FR',
    ip_addr: '127.0.0.1',
    master_metadata_track_name: 'On A Train',
    master_metadata_album_artist_name: 'Yuksek',
    master_metadata_album_album_name: 'On A Train EP',
    spotify_track_uri: 'spotify:track:abc',
    reason_start: 'clickrow',
    reason_end: 'trackdone',
    shuffle: false,
    skipped: false,
    offline: false,
    incognito_mode: false,
};

/** One entry of a Google Takeout "My Activity" file. */
const YOUTUBE_ENTRY = {
    header: 'YouTube',
    title: 'Watched Something',
    titleUrl: 'https://www.youtube.com/watch?v=q2KCrmQz9WE',
    time: '2026-07-29T11:03:00.703Z',
    products: ['YouTube'],
};

function asFileList(files: File[]): FileList {
    return {
        ...files,
        length: files.length,
        item: (i: number) => files[i],
        [Symbol.iterator]: function* () {
            yield* files;
        },
    } as unknown as FileList;
}

/**
 * A stand-in for a picked file. jsdom implements neither `File.text()` nor
 * `Blob.slice().text()`, so both have to be faked — and both matter: the
 * importer sniffs the head with `slice` before any parser reads the whole file.
 */
function textFile(name: string, text: string): File {
    return {
        name,
        text: async () => text,
        slice: (start = 0, end = text.length) => ({ text: async () => text.slice(start, end) }),
    } as unknown as File;
}

function jsonFile(name: string, content: unknown): File {
    return textFile(name, JSON.stringify(content));
}

describe('dataStore', () => {
    beforeEach(() => {
        dataStore.reset();
        tables.clear();
        geo.buildDays.mockClear();
    });

    it('should initialize with default values', () => {
        expect(dataStore.isDemo).toBe(false);
        expect(dataStore.lastModule).toBe(null);
    });

    it('should set demo mode correctly', () => {
        dataStore.loadDemoData('listening');
        expect(dataStore.isDemo).toBe(true);
        expect(dataStore.lastModule).toBe('listening');
    });

    it('should set user data mode correctly', () => {
        dataStore.loadUserData('positions');
        expect(dataStore.isDemo).toBe(false);
        expect(dataStore.lastModule).toBe('positions');
    });

    it('should reset state', () => {
        dataStore.loadDemoData();
        expect(dataStore.isDemo).toBe(true);

        dataStore.reset();
        expect(dataStore.isDemo).toBe(false);
        expect(dataStore.lastModule).toBe(null);
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

    it('handleFilesUpload should process multiple Spotify JSON files', async () => {
        await dataStore.handleFilesUpload(
            asFileList([
                jsonFile('Streaming_History_Audio_2023_0.json', [SPOTIFY_ENTRY]),
                jsonFile('Streaming_History_Audio_2023_1.json', [SPOTIFY_ENTRY]),
            ])
        );
        await settle();

        expect(dataStore.error).toBeNull();
        expect(dataStore.isDemo).toBe(false);
        expect(dataStore.lastModule).toBe('listening');
        expect(dataStore.loading).toBeNull();
        expect(dataStore.lastImport?.modules).toEqual([
            { module: 'listening', rows: 2, services: ['spotify'] },
        ]);
    });

    it('drops the demo rows on import, though imports otherwise accumulate', async () => {
        // The demo plays live in the same table as real ones. Since imports
        // accumulate, not clearing them would blend someone else's listening
        // history into the user's with no way to tell the two apart after.
        dataStore.loadDemoData('listening');
        vi.mocked(db.dropTable).mockClear();

        await dataStore.handleFilesUpload(
            asFileList([jsonFile('Streaming_History_Audio_2023_0.json', [SPOTIFY_ENTRY])])
        );
        await settle();

        expect(db.dropTable).toHaveBeenCalledWith('plays');
        expect(dataStore.isDemo).toBe(false);
    });

    /**
     * The only exit from a sample used to be importing over it. Somebody who
     * loaded it to see what Buho does, and now wants the page to stop showing
     * invented data, had nothing to drop.
     */
    it('clears a sample on request, taking its table with it', async () => {
        dataStore.loadDemoData('listening');
        vi.mocked(db.dropTable).mockClear();

        await dataStore.clearDemo('listening');
        await settle();

        expect(db.dropTable).toHaveBeenCalledWith('plays');
        expect(dataStore.isSample('listening')).toBe(false);
        expect(dataStore.loaded.listening).toBe(false);
    });

    it('never drops a table that holds real rows', async () => {
        dataStore.loadUserData('listening');
        vi.mocked(db.dropTable).mockClear();

        await dataStore.clearDemo('listening');

        expect(db.dropTable).not.toHaveBeenCalled();
    });

    /**
     * Samples are per module, so clearing one must not touch the other — the
     * case a single global `isDemo` could not have represented at all.
     */
    it('clears one module without disturbing another sample', async () => {
        dataStore.loadDemoData('listening');
        dataStore.loadDemoData('messages');
        vi.mocked(db.dropTable).mockClear();

        await dataStore.clearDemo('messages');
        await settle();

        expect(db.dropTable).toHaveBeenCalledWith('messages');
        expect(db.dropTable).not.toHaveBeenCalledWith('plays');
        expect(dataStore.isSample('listening')).toBe(true);
        expect(dataStore.isSample('messages')).toBe(false);
    });

    it('leaves a real history in place', async () => {
        dataStore.loadUserData('listening');
        vi.mocked(db.dropTable).mockClear();

        await dataStore.handleFilesUpload(
            asFileList([jsonFile('Streaming_History_Audio_2023_0.json', [SPOTIFY_ENTRY])])
        );
        await settle();

        // Imports accumulate: a Deezer export must not erase Spotify's. Taking
        // an export back out goes through removeSource.
        expect(db.dropTable).not.toHaveBeenCalledWith('plays');
    });

    it('handleFilesUpload should report files no parser claimed', async () => {
        await dataStore.handleFilesUpload(
            asFileList([jsonFile('invalid.json', { not: 'a history' })])
        );

        expect(dataStore.error).not.toBeNull();
        expect(dataStore.error?.message).toContain('Nothing Buho reads');
    });

    it('handleFilesUpload accepts a root-level Timeline array', async () => {
        await dataStore.handleFilesUpload(
            asFileList([jsonFile('location-history.json', [VISIT_ENTRY])])
        );

        expect(dataStore.error).toBeNull();
        expect(dataStore.lastModule).toBe('positions');
    });

    it('handleFilesUpload accepts the phone export wrapped in semanticSegments', async () => {
        await dataStore.handleFilesUpload(
            asFileList([
                jsonFile('Timeline.json', {
                    semanticSegments: [VISIT_ENTRY],
                    rawSignals: [{ position: {} }],
                    userLocationProfile: {},
                }),
            ])
        );

        expect(dataStore.error).toBeNull();
        expect(dataStore.lastModule).toBe('positions');
    });

    it('handleFilesUpload errors on an unrelated JSON object', async () => {
        await dataStore.handleFilesUpload(
            asFileList([jsonFile('other.json', { somethingElse: [1, 2, 3] })])
        );

        expect(dataStore.error?.message).toContain('Nothing Buho reads');
    });

    it('handleFilesUpload returns before geo attribution finishes', async () => {
        await dataStore.handleFilesUpload(asFileList([jsonFile('Timeline.json', [VISIT_ENTRY])]));

        // The routes gate on `loading`/`source`: both say "ready" already, while
        // the attribution is still held open by the gate.
        expect(dataStore.lastModule).toBe('positions');
        expect(dataStore.loading).toBeNull();
        expect(dataStore.isLoading).toBe(false);
        expect(dataStore.geo?.status).toBe('running');
        expect(dataStore.geoReady).toBe(false);
        expect(dataStore.geoVersion).toBe(0);
    });

    it('releases the daily table before attribution finishes', async () => {
        await dataStore.handleFilesUpload(asFileList([jsonFile('Timeline.json', [VISIT_ENTRY])]));
        await new Promise((r) => setTimeout(r, 0));

        // The day-based views only need the segments, so they light up while
        // the attribution is still gated.
        expect(geo.buildDays).toHaveBeenCalledTimes(1);
        expect(dataStore.daysVersion).toBe(1);
        expect(dataStore.geoVersion).toBe(0);
    });

    it('marks geo ready and bumps geoVersion once enrichment lands', async () => {
        await dataStore.handleFilesUpload(asFileList([jsonFile('Timeline.json', [VISIT_ENTRY])]));
        geo.release();
        await settle();

        // Rebuilt a second time, now that the place names are attributed.
        expect(geo.buildDays).toHaveBeenCalledTimes(2);
        expect(dataStore.daysVersion).toBe(2);
        expect(dataStore.geoReady).toBe(true);
        expect(dataStore.geoVersion).toBe(1);
    });

    it('handleFilesUpload accepts a thread JSON file', async () => {
        await dataStore.handleFilesUpload(asFileList([jsonFile('Dana Fox_0.json', THREAD)]));

        expect(dataStore.error).toBeNull();
        expect(dataStore.lastModule).toBe('messages');
        expect(dataStore.loading).toBeNull();
        // Nothing runs in the background for this source.
        expect(dataStore.geo).toBeNull();
    });

    it('handleFilesUpload reads an unzipped folder, skipping its media', async () => {
        // What a `webkitdirectory` input hands over: every entry of the folder,
        // conversations and attachments alike.
        const media = {
            name: 'photo.jpeg',
            text: async () => {
                throw new Error('read');
            },
        } as unknown as File;

        await dataStore.handleFilesUpload(asFileList([jsonFile('Dana Fox_0.json', THREAD), media]));

        expect(dataStore.error).toBeNull();
        expect(dataStore.lastModule).toBe('messages');
    });

    it('handleFilesUpload says how many files it made nothing of', async () => {
        // Auto-detection means the user never declares a format, so a drop that
        // matches nothing has to explain itself rather than just fail.
        await dataStore.handleFilesUpload(
            asFileList([jsonFile('other.json', { somethingElse: [1, 2, 3] })])
        );

        expect(dataStore.error?.message).toContain('Nothing Buho reads');
        expect(dataStore.error?.message).toContain('1 file');
    });

    it('handleFilesUpload surfaces an oversized zip as a readable error', async () => {
        // The entries are gathered inside the import's own try/catch; if they
        // weren't, this would be an unhandled rejection and the user would see
        // nothing at all.
        const huge = new File([new Uint8Array()], 'facebook-export.zip');
        Object.defineProperty(huge, 'size', { value: 3 * 1024 ** 3 });

        await dataStore.handleFilesUpload(asFileList([huge]));

        expect(dataStore.error?.message).toContain('facebook-export.zip');
        expect(dataStore.error?.message).toContain('Choose a folder');
        expect(dataStore.loading).toBeNull();
    });

    it('handleFilesUpload explains a media-only drop instead of just failing', async () => {
        // Meta splits large exports across several zips, some holding nothing but
        // photos. That drop has zero readable files, and the reason is not
        // guessable from the folder alone.
        await dataStore.handleFilesUpload(
            asFileList([
                { name: 'photo.jpeg', text: async () => '' } as unknown as File,
                { name: 'clip.mp4', text: async () => '' } as unknown as File,
            ])
        );

        expect(dataStore.error?.message).toContain('split across several zips');
    });

    it('handleFilesUpload errors on a conversation with no messages', async () => {
        await dataStore.handleFilesUpload(
            asFileList([
                jsonFile('Empty_0.json', {
                    participants: ['Me', 'Empty'],
                    threadName: 'Empty_0',
                    messages: [],
                }),
            ])
        );

        expect(dataStore.error?.message).toContain('hold nothing to import');
    });

    it('handleFilesUpload detects the service without being told', async () => {
        await dataStore.handleFilesUpload(asFileList([jsonFile('Dana Fox_0.json', THREAD)]));

        expect(dataStore.lastImport?.modules).toEqual([
            { module: 'messages', rows: 1, services: ['messenger'] },
        ]);
        expect(dataStore.lastImport?.unrecognisedFiles).toBe(0);
    });

    it('handleFilesUpload reports the files it recognised nothing in', async () => {
        await dataStore.handleFilesUpload(
            asFileList([
                jsonFile('Dana Fox_0.json', THREAD),
                jsonFile('settings.json', { theme: 'dark' }),
            ])
        );

        expect(dataStore.error).toBeNull();
        expect(dataStore.lastImport?.unrecognisedFiles).toBe(1);
    });

    it('handleFilesUpload appends conversations rather than replacing them', async () => {
        // WhatsApp must not erase Messenger: the two share the table.
        const files = () => asFileList([jsonFile('Dana Fox_0.json', THREAD)]);

        await dataStore.handleFilesUpload(files());
        await dataStore.handleFilesUpload(files());

        expect(db.dropTable).not.toHaveBeenCalledWith('messages');
    });

    // --- Google activity ---------------------------------------------------

    it('handleFilesUpload imports a Takeout activity file', async () => {
        await dataStore.handleFilesUpload(
            asFileList([jsonFile('My Activity.json', [YOUTUBE_ENTRY])])
        );

        expect(dataStore.error).toBeNull();
        expect(dataStore.loaded.activity).toBe(true);
        expect(db.insertGoogleActivity).toHaveBeenCalled();
        expect(dataStore.lastImport?.modules).toEqual([
            { module: 'activity', rows: 1, services: ['google-activity'] },
        ]);
    });

    it('handleFilesUpload appends activity rather than replacing it', async () => {
        const files = () => asFileList([jsonFile('My Activity.json', [YOUTUBE_ENTRY])]);

        await dataStore.handleFilesUpload(files());
        await dataStore.handleFilesUpload(files());

        expect(db.dropTable).not.toHaveBeenCalledWith('google_activity');
    });

    it('handleFilesUpload points at the JSON export when it recognises nothing', async () => {
        // The commonest mistake by far: Takeout defaults to HTML, which carries
        // none of this. A bare "nothing found" would leave the user stuck.
        await dataStore.handleFilesUpload(
            asFileList([jsonFile('Settings.json', { theme: 'dark' })])
        );

        expect(dataStore.error?.message).toContain('JSON');
        expect(dataStore.loaded.activity).toBe(false);
    });

    // --- One drop, several modules ------------------------------------------

    /**
     * The reason there is one importer. Routing has always been per file, so a
     * folder holding a music export next to a Timeline one is not an edge case —
     * and until now four separate handlers each threw away the other three's
     * findings.
     */
    it('fills every module a single drop turns out to hold', async () => {
        await dataStore.handleFilesUpload(
            asFileList([
                jsonFile('Streaming_History_Audio_2023_0.json', [SPOTIFY_ENTRY]),
                jsonFile('Timeline.json', [VISIT_ENTRY]),
                jsonFile('Dana Fox_0.json', THREAD),
            ])
        );
        await settle();

        expect(dataStore.error).toBeNull();
        expect(dataStore.loaded.listening).toBe(true);
        expect(dataStore.loaded.positions).toBe(true);
        expect(dataStore.loaded.messages).toBe(true);
        expect(dataStore.lastImport?.modules.map((m) => m.module).sort()).toEqual([
            'listening',
            'messages',
            'positions',
        ]);
    });

    it('imports a module you are not looking at, whatever page you dropped from', async () => {
        // Dropping a Timeline export from the music page: the page you're on is
        // not part of the question, which is the whole point of one drop zone.
        dataStore.loadDemoData('listening');

        await dataStore.handleFilesUpload(asFileList([jsonFile('Timeline.json', [VISIT_ENTRY])]));
        await settle();

        expect(dataStore.loaded.positions).toBe(true);
        // The demo music is untouched, so it must not start claiming to be yours.
        expect(dataStore.isDemo).toBe(true);
    });

    it('clears the demo rows the drop covers, and nothing else', async () => {
        dataStore.loadDemoData('listening');
        await dataStore.handleFilesUpload(asFileList([jsonFile('Timeline.json', [VISIT_ENTRY])]));
        await settle();
        vi.mocked(db.dropTable).mockClear();

        await dataStore.handleFilesUpload(
            asFileList([jsonFile('Streaming_History_Audio_2023_0.json', [SPOTIFY_ENTRY])])
        );
        await settle();

        expect(db.dropTable).toHaveBeenCalledWith('plays');
        // A music-only drop has no business emptying the map.
        expect(db.dropTable).not.toHaveBeenCalledWith('location_segments');
        expect(dataStore.loaded.positions).toBe(true);
    });

    it('does not cancel a running enrichment for a drop with no positions in it', async () => {
        await dataStore.handleFilesUpload(asFileList([jsonFile('Timeline.json', [VISIT_ENTRY])]));
        expect(dataStore.geo?.status).toBe('running');

        await dataStore.handleFilesUpload(
            asFileList([jsonFile('Streaming_History_Audio_2023_0.json', [SPOTIFY_ENTRY])])
        );
        geo.release();
        await settle();

        // Superseding on every import would abandon attribution the music drop
        // has nothing to do with.
        expect(dataStore.geoReady).toBe(true);
    });

    it('keeps demo plays out of the list of things you can remove', async () => {
        // They sit in the same table as real plays, but you didn't import them
        // and they go on their own at the next music import.
        dataStore.loadDemoData('listening');
        vi.mocked(getInventoryRows).mockResolvedValueOnce([
            {
                id: 'spotify',
                label: 'Spotify',
                icon: 'spotify',
                rows: 3000,
                holdings: [{ module: 'listening', rows: 3000 }],
            },
            {
                id: 'google-timeline',
                label: 'Google Timeline',
                icon: 'map-pin',
                rows: 12,
                holdings: [{ module: 'positions', rows: 12 }],
            },
        ]);

        await dataStore.refreshInventory();

        expect(dataStore.inventory.map((s) => s.id)).toEqual(['google-timeline']);
    });

    // --- Removing a source --------------------------------------------------

    it('recounts what is loaded after a removal instead of trusting the flag', async () => {
        await dataStore.handleFilesUpload(
            asFileList([jsonFile('My Activity.json', [YOUTUBE_ENTRY])])
        );
        await settle();
        expect(dataStore.loaded.activity).toBe(true);

        vi.mocked(removeSourceRows).mockResolvedValueOnce(['activity']);
        tables.delete('google_activity');
        await dataStore.removeSource('google-activity');

        expect(dataStore.loaded.activity).toBe(false);
        expect(dataStore.loading).toBeNull();
        // It described an import that no longer fully stands.
        expect(dataStore.lastImport).toBeNull();
    });

    it('rebuilds the daily table when a removal touched the positions', async () => {
        vi.mocked(removeSourceRows).mockResolvedValueOnce(['positions']);
        vi.mocked(db.dropTable).mockClear();

        await dataStore.removeSource('garmin');

        expect(db.dropTable).toHaveBeenCalledWith('position_days');
        expect(dataStore.geo).toBeNull();
    });

    // --- Several sources at once -------------------------------------------

    /**
     * The tables live side by side in DuckDB, so loading one source must not make
     * the others unavailable. This used to be false: a single `source` field meant
     * the most recent import silently un-gated every other route.
     */
    it('keeps every imported source available', async () => {
        await dataStore.handleFilesUpload(asFileList([jsonFile('Dana Fox_0.json', THREAD)]));
        await dataStore.handleFilesUpload(
            asFileList([jsonFile('My Activity.json', [YOUTUBE_ENTRY])])
        );

        expect(dataStore.loaded.messages).toBe(true);
        expect(dataStore.loaded.activity).toBe(true);
        // `lastModule` still names the latest.
        expect(dataStore.lastModule).toBe('activity');
    });

    it('reset clears every source', async () => {
        await dataStore.handleFilesUpload(
            asFileList([jsonFile('My Activity.json', [YOUTUBE_ENTRY])])
        );
        dataStore.reset();

        expect(dataStore.loaded.activity).toBe(false);
        expect(dataStore.loaded.steps).toBe(false);
        expect(dataStore.lastImport).toBeNull();
        expect(dataStore.messagesSummary).toEqual([]);
        expect(dataStore.inventory).toEqual([]);
    });

    /**
     * A Timeline import used to drop the table before inserting, which would now
     * silently delete a watch's tracks — and vice versa.
     */
    it('appends positions rather than replacing them', async () => {
        await dataStore.handleFilesUpload(
            asFileList([jsonFile('location-history.json', [VISIT_ENTRY])])
        );
        await dataStore.handleFilesUpload(
            asFileList([jsonFile('location-history.json', [VISIT_ENTRY])])
        );

        expect(db.dropTable).not.toHaveBeenCalledWith('location_segments');
    });

    it('reports what a positions import recognised, per provider', async () => {
        await dataStore.handleFilesUpload(
            asFileList([jsonFile('location-history.json', [VISIT_ENTRY])])
        );

        expect(dataStore.lastImport).toEqual({
            modules: [{ module: 'positions', rows: 1, services: ['google-timeline'] }],
            unrecognisedFiles: 0,
        });
    });

    it('points at the export formats when it recognises nothing', async () => {
        await dataStore.handleFilesUpload(
            asFileList([jsonFile('other.json', { somethingElse: [1, 2, 3] })])
        );

        // One message for every format, now that one drop zone reads them all.
        expect(dataStore.error?.message).toContain('Garmin export');
        expect(dataStore.error?.message).toContain('extended');
    });

    it('leaves the steps table alone when a drop carries no steps', async () => {
        await dataStore.handleFilesUpload(
            asFileList([jsonFile('location-history.json', [VISIT_ENTRY])])
        );

        expect(db.insertStepPackets).not.toHaveBeenCalled();
        expect(dataStore.loaded.steps).toBe(false);
    });

    /**
     * One Garmin archive feeds Steps and Health, but one whose monitoring files
     * carry counters and no readings fills only one of the two tables. When
     * `loaded` was keyed by export, /health/explore opened on a page telling
     * somebody whose import had just worked to go and re-drop two gigabytes.
     */
    it('answers per module, not per export, for the pages that draw', async () => {
        tables.set('step_packets', 4_000);
        await dataStore.refreshLoaded();

        expect(dataStore.loaded.steps).toBe(true);
        expect(dataStore.loaded.health).toBe(false);

        tables.set('health_readings', 120_000);
        await dataStore.refreshLoaded();

        expect(dataStore.loaded.health).toBe(true);
    });
});

/**
 * What an import reports about itself.
 *
 * The one event whose properties are worth a test: an import is the moment
 * everything else depends on, it is unreproducible from a dashboard, and the
 * properties are exactly what makes it readable — a drop that says "source:
 * none" answers no question at all.
 */
describe('import analytics', () => {
    let track: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        dataStore.reset();
        tables.clear();
        track = vi.fn();
        (window as unknown as { umami?: unknown }).umami = { track };
    });

    afterEach(() => {
        delete (window as unknown as { umami?: unknown }).umami;
    });

    const eventNamed = (name: string) =>
        track.mock.calls.find((call) => call[0] === name)?.[1] as
            Record<string, unknown> | undefined;

    it('names the export a drop was mostly about, not the page it was made from', async () => {
        await dataStore.handleFilesUpload(
            asFileList([jsonFile('Streaming_History_Audio_2023_0.json', [SPOTIFY_ENTRY])]),
            { pick: 'folder', surface: 'dialog' }
        );
        await settle();

        expect(eventNamed('upload')).toMatchObject({
            service: 'spotify',
            services: 'spotify',
            rows: '<1k',
            files: '1',
            unread: '0',
            failed: '',
            pick: 'folder',
            surface: 'dialog',
            adding: false,
        });
    });

    it('reports every service in a drop, and which of them dominated it', async () => {
        await dataStore.handleFilesUpload(
            asFileList([
                jsonFile('Streaming_History_Audio_2023_0.json', [SPOTIFY_ENTRY, SPOTIFY_ENTRY]),
                jsonFile('location-history.json', [VISIT_ENTRY]),
            ])
        );
        await settle();

        expect(eventNamed('upload')).toMatchObject({
            service: 'spotify',
            services: 'google-timeline+spotify',
        });
    });

    it('says a second import is a second import', async () => {
        const file = () => asFileList([jsonFile('Dana Fox_0.json', THREAD)]);

        await dataStore.handleFilesUpload(file());
        await settle();
        track.mockClear();
        await dataStore.handleFilesUpload(file());
        await settle();

        expect(eventNamed('upload')).toMatchObject({ adding: true });
    });

    it('compares what the funnel promised with what arrived', async () => {
        await dataStore.handleFilesUpload(asFileList([jsonFile('Dana Fox_0.json', THREAD)]), {
            pick: 'file',
            surface: 'onboarding',
            expected: 'whatsapp',
        });
        await settle();

        // They were following the WhatsApp how-to and dropped a Messenger
        // archive: an import that worked, and a funnel that didn't.
        expect(eventNamed('upload')).toMatchObject({
            service: 'messenger',
            expected: 'whatsapp',
            asExpected: 'false',
        });
    });

    it('classifies a failure by code and by the stage it broke in', async () => {
        await dataStore.handleFilesUpload(
            asFileList([jsonFile('other.json', { somethingElse: [1, 2, 3] })])
        );

        expect(eventNamed('upload-error')).toMatchObject({
            reason: 'unrecognised',
            stage: 'parse',
            files: '1',
        });
    });

    it('tells "nothing readable in the selection" from "nothing Buho reads"', async () => {
        await dataStore.handleFilesUpload(
            asFileList([{ name: 'photo.jpeg', text: async () => '' } as unknown as File])
        );

        // Both used to be classified from their message, which mentions zips in
        // its advice — so both were filed as archive failures.
        expect(eventNamed('upload-error')).toMatchObject({
            reason: 'empty-selection',
            stage: 'read',
            files: '0',
        });
    });
});
