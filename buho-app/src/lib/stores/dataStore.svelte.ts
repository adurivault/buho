import { entriesFromFileList } from '#lib/data/import/entries.ts';
import {
    runImport,
    uploadEventProps,
    type ImportContext,
    type ImportReport,
} from '#lib/data/import/runImport.ts';
import type { ImportEntry } from '#lib/data/sources/types.ts';
import { DATA_MODULES, moduleById, type ModuleId } from '#lib/data/modules.ts';
import {
    getInventory,
    removeSource as removeSourceRows,
    type LoadedSource,
} from '#lib/data/queries/inventory.ts';
import { getNetworkSummary, type NetworkSummary } from '#lib/data/queries/messageQueries.ts';
import { getListeningDateBounds as getDateBounds } from '#lib/data/queries/common.ts';
import * as db from '#lib/data/db/index.ts';
import { loadGeoAssets } from '#lib/data/geo/loadGeoAssets.ts';
import { attributeZones } from '#lib/data/geo/attributeZones.ts';
import { buildDays } from '#lib/data/geo/buildDays.ts';
import { listeningFilterStore } from '#lib/stores/listeningFilterStore.svelte.ts';
import { listeningMeasure } from '#lib/stores/listeningMeasure.svelte.ts';
import { trackEvent, fileBucket, durationBucket, failureReason } from '#lib/analytics.ts';
import type { ImportStage } from '#lib/data/import/errors.ts';

export type { ImportReport, ModuleImportCount } from '#lib/data/import/runImport.ts';

/**
 * How the files were handed over, for the import analytics.
 *
 * `pick` and `surface` are two questions, not one: dropping onto the window and
 * dropping into the dialog are the same gesture in different places, and which
 * of the two is failing is only answerable if they are told apart.
 */
export type ImportPick = 'drop' | 'file' | 'folder';
export type ImportSurface =
    'window' | 'dialog' | 'onboarding' | 'source-page' | 'module' | 'unknown';

export interface ImportOrigin {
    pick?: ImportPick;
    surface?: ImportSurface;
    /**
     * The export the user said they were about to drop, where they were asked —
     * only the onboarding funnel asks. Everywhere else the format is sniffed and
     * nothing is declared, so this is the one place "what they meant to import"
     * can be compared with what actually arrived.
     */
    expected?: string;
}

const noModules = (): Record<ModuleId, boolean> =>
    Object.fromEntries(DATA_MODULES.map((module) => [module.id, false])) as Record<
        ModuleId,
        boolean
    >;

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
    /**
     * Which modules are showing invented data right now.
     *
     * This was a single boolean for as long as Listening was the only module
     * with a sample, and a single boolean becomes a lie the moment there are
     * two: load the sample conversations, then import your own music, and one
     * flag has to choose between calling your plays invented and calling the
     * invented conversations yours.
     *
     * Keyed like `loaded`, so both answer the same question — "what is in this
     * module?" — at the same granularity.
     */
    demoModules = $state<Record<ModuleId, boolean>>(noModules());
    /**
     * Which modules hold data, counted from their own table. Several can be
     * loaded at once — the tables live side by side in DuckDB.
     *
     * Keyed by module, never by export: one Garmin archive can fill
     * `step_packets` and leave `health_readings` empty, and a page asking "can I
     * draw?" must get the answer for its own table. Which *exports* are loaded
     * is the inventory's question — see {@link inventory}.
     */
    loaded = $state<Record<ModuleId, boolean>>(noModules());
    /**
     * The module most recently filled. Answers "where did that drop go?"; it is
     * **not** an answer to "is X available?" — use `loaded[x]` for that.
     */
    lastModule = $state<ModuleId | null>(null);

    loading = $state<LoadingState | null>(null);
    error = $state<ErrorState | null>(null);

    /** Outcome of the most recent import, whatever it turned out to hold. */
    lastImport = $state<ImportReport | null>(null);

    /**
     * Every export currently loaded, with what it holds. This is what makes an
     * import undoable — see `queries/inventory.ts`.
     */
    inventory = $state<LoadedSource[]>([]);

    /**
     * What is stored per messaging service. The only per-module summary left:
     * every header reads the inventory instead, and the messages guide is the
     * one view that wants the breakdown for itself.
     */
    messagesSummary = $state<NetworkSummary[]>([]);

    // Background geo enrichment of the Google Maps import (see enrichGeo).
    geo = $state<GeoState | null>(null);
    /** Bumped once enrichment lands; views needing geo columns watch this. */
    geoVersion = $state(0);
    /**
     * Bumped every time `position_days` is (re)built: once straight from the
     * raw segments, then again once attribution has filled the place names. The
     * day-based views watch this so they don't wait on the whole attribution.
     */
    daysVersion = $state(0);
    /** Incremented per Timeline import, so a superseded enrichment can bail out. */
    private importGeneration = 0;

    get geoReady(): boolean {
        return this.geo?.status === 'done';
    }

    /**
     * Whether anything on screen is invented.
     *
     * The global question still has callers — the import dialog's warning, and
     * the guide sections that only need *a* signal to recompute on. Anything
     * deciding what to say about one module asks {@link isSample} instead.
     */
    get isDemo(): boolean {
        return Object.values(this.demoModules).some(Boolean);
    }

    /** Whether this module in particular is showing a sample. */
    isSample(module: ModuleId): boolean {
        return this.demoModules[module];
    }

    /** Whether an import or a removal is under way. */
    get isLoading(): boolean {
        return !!this.loading;
    }

    loadDemoData(module: ModuleId | null = 'listening') {
        // The sample is a dataset to look at, not an export to import — so it is
        // reported by module, like every other "which page is this about?".
        trackEvent('demo-load', { module: module ?? 'unknown' });
        if (module) this.demoModules[module] = true;
        this.markLoaded(module);
    }

    /**
     * Declare a module loaded without going through an import.
     *
     * The import path doesn't use this — it counts rows instead, see
     * `refreshLoaded` — but seeding the state directly is how the demo
     * transition and the tests set a starting point.
     */
    loadUserData(module: ModuleId | null = 'listening') {
        if (module) this.demoModules[module] = false;
        this.markLoaded(module);
    }

    private markLoaded(module: ModuleId | null) {
        if (module) this.loaded[module] = true;
        this.lastModule = module;
        this.error = null;
        this.loading = null;
    }

    setLoading(loading: LoadingState | null) {
        this.loading = loading;
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
        this.demoModules = noModules();
        this.loaded = noModules();
        this.lastModule = null;
        this.loading = null;
        this.error = null;
        this.lastImport = null;
        this.inventory = [];
        this.messagesSummary = [];
        this.geo = null;
        this.geoVersion = 0;
        this.daysVersion = 0;
        this.importGeneration += 1;
        listeningMeasure.reset();
    }

    /**
     * Handles a drop, whatever it turns out to hold — see `runImport` for the
     * pipeline itself. This is the part that belongs to the app: the progress
     * bar, the sample flags, what is loaded afterwards, the analytics.
     *
     * Only what the first screen needs is awaited: read → parse → insert. Zone
     * attribution and the daily summary are far slower than all of that and
     * nothing visible depends on them, so they run in the background afterwards
     * (see enrichGeo).
     */
    async handleImport(
        source: ImportEntry[] | (() => Promise<ImportEntry[]>),
        origin: ImportOrigin = {}
    ) {
        const startedAt = Date.now();
        // Everything the analytics needs whichever way this ends. `stage` is
        // moved along as the import advances, so a failure says *where* it
        // broke: reading an archive, parsing it, or storing what came out.
        let stage: ImportStage = 'read';
        let fileCount = 0;
        const context: ImportContext = {
            pick: origin.pick ?? 'drop',
            surface: origin.surface ?? 'unknown',
            expected: origin.expected ?? 'none',
            // Whether this drop lands on an empty app or adds to what is there:
            // the second import is the one that says people came back.
            adding: Object.values(this.loaded).some(Boolean),
        };
        // Bumped only by a drop carrying positions. The generation is what lets
        // a newer import cancel an enrichment still running over the row set it
        // was reading, and a music-only drop has nothing to cancel.
        let generation = this.importGeneration;
        let positionsImported = false;

        this.setLoading({ status: 'reading', message: 'Reading files...', progress: 0.05 });
        // Unzipping and parsing are plain JavaScript; only storing needs the
        // engine. Starting it here lets it download while they run.
        db.warmUpDuckDB();

        try {
            // Gathering happens inside the try: opening a zip is where an import
            // most often fails (an oversized archive can't be unpacked in a tab),
            // and that message has to reach the user rather than become an
            // unhandled rejection.
            const entries = typeof source === 'function' ? await source() : source;
            fileCount = entries.length;

            const outcome = await runImport(entries, {
                progress: (state) => this.setLoading(state),
                stage: (next) => (stage = next),
                // A parser that threw took its whole service down with it while
                // the rest of the drop carried on. Reported one event per
                // service, since which one broke is the entire content of the
                // signal.
                parserFailed: (parser) =>
                    trackEvent('parse-error', { parser, files: fileBucket(entries.length) }),
                isSample: (module) => this.demoModules[module],
                sampleReplaced: (module) => (this.demoModules[module] = false),
                positionsIncoming: () => {
                    generation = ++this.importGeneration;
                    positionsImported = true;
                    this.geo = null;
                },
            });
            const { report } = outcome;

            this.error = null;
            await this.refreshLoaded();
            await this.refreshSummaries();
            this.lastImport = report;

            // What the drop was mostly about, for anything asking "where did that
            // go?". `loaded` is the answer to "is X available?" — a drop can fill
            // three modules at once.
            const primary = [...report.modules].sort((a, b) => b.rows - a.rows)[0];
            if (primary) this.lastModule = primary.module;

            // Bounds come from the whole table, not this drop: a Deezer import
            // reaching back to 2011 has to widen a range Spotify's export set.
            if (report.modules.some((m) => m.module === 'listening')) {
                listeningFilterStore.setBounds(await getDateBounds(), { resetRange: true });
            }

            this.setLoading({ status: 'done', message: 'Done', progress: 1 });
            await new Promise((r) => setTimeout(r, 300));
            this.loading = null;

            trackEvent('upload', uploadEventProps(outcome, context, Date.now() - startedAt));

            if (positionsImported) void this.enrichGeo(generation);
        } catch (e) {
            console.error(e);
            trackEvent('upload-error', {
                reason: failureReason(e),
                // Reading, parsing and storing fail for different reasons and
                // are fixed in different places; the code alone doesn't say
                // which, since out-of-memory happens at all three.
                stage,
                files: fileBucket(fileCount),
                ms: durationBucket(Date.now() - startedAt),
                pick: context.pick,
                surface: context.surface,
                expected: context.expected,
                adding: context.adding,
            });
            this.setError({
                message: e instanceof Error ? e.message : 'Failed to process files',
            });
            this.loading = null;
        }
    }

    /**
     * File-picker entry point, for the two hidden inputs.
     *
     * The reader is passed unevaluated so an oversized-zip failure lands inside
     * `handleImport`'s catch rather than escaping as an unhandled rejection.
     */
    async handleFilesUpload(files: FileList | File[], origin: ImportOrigin = {}) {
        return this.handleImport(() => entriesFromFileList(files), origin);
    }

    /**
     * Throw a sample away and leave the module empty.
     *
     * Until now the only exit from the demo was to import something over it,
     * which is the wrong shape: somebody who loaded the sample to see what Buho
     * does, and then wants the page to stop lying to them, has nothing to drop.
     *
     * The whole table goes rather than a subset of its rows. That is safe
     * precisely because sample and real rows never coexist — `handleImport`
     * drops the table on the way in whenever the sample is loaded — and it is
     * why this cannot reuse `removeSource`, which deletes by the catalog id that
     * invented rows do not carry.
     */
    async clearDemo(id: ModuleId) {
        const module = moduleById(id);
        if (!this.demoModules[id]) return;

        this.setLoading({ status: 'removing', message: 'Clearing the sample...', progress: 0.3 });

        try {
            await db.initDuckDB();
            await db.dropTable(module.table);
            this.demoModules[id] = false;

            await this.refreshLoaded();
            await this.refreshSummaries();
            if (module.id === 'listening') {
                listeningFilterStore.setBounds(await getDateBounds(), { resetRange: true });
            }

            this.lastImport = null;
            this.error = null;
            this.loading = null;

            trackEvent('demo-clear', { module: module.id });
        } catch (e) {
            console.error(e);
            this.setError({
                message: e instanceof Error ? e.message : 'Failed to clear the sample',
            });
            this.loading = null;
        }
    }

    /**
     * Remove everything one export contributed.
     *
     * The counterpart to imports always accumulating: without it, a drop made by
     * mistake could only be undone by reloading the page and re-importing
     * everything else. Deletion is scoped to that source's own rows, so the
     * services sharing its table stay where they are.
     */
    async removeSource(id: string) {
        this.setLoading({ status: 'removing', message: 'Removing...', progress: 0.3 });

        try {
            await db.initDuckDB();
            const touched = await removeSourceRows(id);

            if (touched.includes('positions')) {
                // Derived from the segments, so meaningless the moment some go.
                await db.dropTable('position_days');
                this.geo = null;
                this.daysVersion += 1;
            }

            await this.refreshLoaded();
            await this.refreshSummaries();
            if (touched.includes('listening')) {
                listeningFilterStore.setBounds(await getDateBounds(), { resetRange: true });
            }

            // It described an import that no longer fully stands.
            this.lastImport = null;
            this.error = null;
            this.loading = null;

            // `id` is a catalog id — the same vocabulary `upload` reports under,
            // so an export's imports and its removals sit on one axis.
            trackEvent('source-remove', { service: id, modules: [...touched].sort().join('+') });

            // Whatever positions are left need re-enriching: the daily table has
            // just been dropped, and attribution ran over a row set that changed.
            if (touched.includes('positions') && this.loaded.positions) {
                void this.enrichGeo(++this.importGeneration);
            }
        } catch (e) {
            console.error(e);
            this.setError({
                message: e instanceof Error ? e.message : 'Failed to remove that source',
            });
            this.loading = null;
        }
    }

    /**
     * Which modules hold data, counted from the tables themselves.
     *
     * The single writer of `loaded` on the import and removal paths. Counting
     * rather than setting a flag is what makes removal work: a flag left standing
     * is a sidebar entry lighting up for an empty module. And after a drop that
     * filled three modules at once there is no one module to set anyway.
     * (`loadDemoData` is the exception — it is told what it loaded.)
     */
    async refreshLoaded() {
        try {
            const next = noModules();
            for (const module of DATA_MODULES) {
                if ((await db.countRows(module.table)) > 0) next[module.id] = true;
            }
            // Which measures the listening views can offer is a property of the
            // same rows and changes with them: a scrobbles export brings plays
            // carrying no duration, and removing the Spotify one can leave only
            // those. Settled *before* `loaded` opens the views, so none of them
            // gets to render a page of zeroes first.
            await listeningMeasure.refresh();
            this.loaded = next;
        } catch (error) {
            console.error('Failed to work out what is loaded:', error);
        }
    }

    /** Everything the headers and the inventory read, refreshed together. */
    async refreshSummaries() {
        await Promise.all([this.refreshMessagesSummary(), this.refreshInventory()]);
    }

    /** What is loaded, export by export — drives the removal list. */
    async refreshInventory() {
        try {
            const loaded = await getInventory();
            // Sample rows sit in the same tables as real ones, but they are not
            // something you imported — so they are not something to offer to
            // remove either. They go on their own, at the next import that fills
            // the same module.
            const invented = new Set(
                DATA_MODULES.filter((module) => this.demoModules[module.id]).map(
                    (module) => module.id
                )
            );
            this.inventory =
                invented.size === 0
                    ? loaded
                    : loaded.filter((source) =>
                          source.holdings.some((holding) => !invented.has(holding.module))
                      );
        } catch (error) {
            console.error('Failed to list what is loaded:', error);
            this.inventory = [];
        }
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
        const signal = {
            get aborted() {
                return isStale();
            },
        };
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
                    message:
                        total > 0
                            ? `Locating points... ${processed.toLocaleString()} / ${total.toLocaleString()}`
                            : 'Locating points...',
                    progress: 0.05 + fraction * 0.9,
                };
            }, signal);
            if (!completed || signal.aborted) return;

            this.geo = { status: 'running', message: 'Naming your places...', progress: 0.96 };
            await buildDays();
            if (signal.aborted) return;
            this.daysVersion += 1;

            this.geo = { status: 'done', message: 'Location details ready', progress: 1 };
            this.geoVersion += 1;
            trackEvent('geo-enrich', {
                status: 'done',
                ms: durationBucket(Date.now() - startedAt),
            });
        } catch (geoError) {
            // Best-effort: segments stay usable even if zone attribution fails.
            console.error('Geo attribution failed:', geoError);
            if (signal.aborted) return;
            this.geo = { status: 'failed', message: 'Location details unavailable' };
            trackEvent('geo-enrich', {
                status: 'failed',
                reason: failureReason(geoError),
                ms: durationBucket(Date.now() - startedAt),
            });
        }
    }
}

export const dataStore = new DataStore();
