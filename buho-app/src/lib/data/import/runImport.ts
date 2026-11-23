import * as db from '#lib/data/db/index.ts';
import type { ModuleId } from '#lib/data/modules.ts';
import { readDrop } from '#lib/data/sources/registry.ts';
import type { ImportEntry } from '#lib/data/sources/types.ts';
import { bucket, durationBucket, fileBucket } from '#lib/analytics.ts';
import { buildMessageRows } from './buildRows';
import { ImportError, type ImportStage } from './errors';

/** What one drop put into one module. */
export interface ModuleImportCount {
    module: ModuleId;
    /** Rows stored, in whatever the module counts in — plays, points, messages. */
    rows: number;
    /** The catalog ids of the exports recognised, e.g. `['deezer', 'spotify']`. */
    services: string[];
}

/**
 * What the last import actually recognised.
 *
 * The user never declares a format, and since one drop can fill several modules
 * at once — a Garmin export always fills two — the app has to say what it found
 * and where it went. Including the files it made nothing of.
 */
export interface ImportReport {
    modules: ModuleImportCount[];
    unrecognisedFiles: number;
}

/**
 * How an import talks back to whoever runs it. The pipeline itself holds no
 * state: the store owns the progress bar, the sample flags and the geo
 * enrichment, and is told when each of them has to move.
 */
export interface ImportHooks {
    progress(state: { status: string; message: string; progress: number }): void;
    /** Where the import is, so a failure can say where it broke. */
    stage(stage: ImportStage): void;
    /** A parser threw; the rest of the drop carries on without its service. */
    parserFailed(parser: string): void;
    /** Whether this module currently holds the sample. */
    isSample(module: ModuleId): boolean;
    /** The sample in this module was dropped to make room for real rows. */
    sampleReplaced(module: ModuleId): void;
    /** Positions are about to be written — any enrichment running is now stale. */
    positionsIncoming(): void;
}

export interface ImportOutcome {
    report: ImportReport;
    /** Rows per catalog id of the export they came from. */
    rowsByService: Map<string, number>;
    failedParsers: string[];
    files: number;
}

/**
 * Which services are behind a set of rows.
 *
 * Every table that several exports share carries the catalog id of whichever
 * one wrote each row — `plays.source`, `location_segments.source`,
 * `messages.network` — so the same helper names the services in all of them.
 */
function servicesIn<T>(rows: T[], of: (row: T) => string): string[] {
    return [...new Set(rows.map(of))].sort();
}

/**
 * Rows per *export*, so an import can say which service it was mostly about.
 *
 * The row-level `source` column is what makes this possible without a second
 * pass: every shared table already records which export wrote each row.
 */
function tally(totals: Map<string, number>, service: string, rows: number): void {
    if (rows > 0) totals.set(service, (totals.get(service) ?? 0) + rows);
}

/** Same, for the tables several exports write to at once. */
function tallyBy<T>(totals: Map<string, number>, rows: T[], of: (row: T) => string): void {
    for (const row of rows) tally(totals, of(row), 1);
}

/** The export a drop was mostly about — the one line that names an import. */
function dominant(totals: Map<string, number>): string {
    let best = 'none';
    let most = -1;
    for (const [service, rows] of totals) {
        if (rows > most) {
            best = service;
            most = rows;
        }
    }
    return best;
}

/**
 * Read → parse → store one drop, whatever it turns out to hold.
 *
 * There is one importer because there is one router: `readDrop` sniffs every
 * file and hands it to the parser that claims it, so a drop is never declared —
 * neither its format nor which dataset it belongs to. One folder can carry a
 * Spotify export next to a WhatsApp chat and a Garmin archive, and all three
 * land where they belong.
 *
 * Imports **accumulate**, always: re-importing the same file is a no-op thanks
 * to the dedupe in each `db.insert*`. Sample data is the one exception and is
 * dropped on the way in: it sits in the same tables as real rows, and
 * accumulating onto it would blend someone else's history into the user's own
 * with no way to tell them apart.
 *
 * @throws {ImportError} When the drop holds nothing Buho can store.
 */
export async function runImport(
    entries: ImportEntry[],
    hooks: ImportHooks
): Promise<ImportOutcome> {
    if (entries.length === 0) {
        // Almost always the same cause: a large export split across several
        // zips, some of which hold nothing but photos and videos.
        throw new ImportError(
            'empty-selection',
            'No readable file in what you selected. Big exports are split across several zips and some hold only photos — try the other ones.'
        );
    }

    hooks.stage('parse');
    hooks.progress({
        status: 'parsing',
        message: 'Working out what you dropped...',
        progress: 0.2,
    });
    const {
        plays,
        positions,
        steps,
        gait,
        health,
        threads,
        activity,
        unrecognisedFiles,
        failedParsers,
    } = await readDrop(entries);

    for (const parser of failedParsers) hooks.parserFailed(parser);

    if (
        !plays.length &&
        !positions.length &&
        !steps.length &&
        !threads.length &&
        !activity.length
    ) {
        throw new ImportError(
            // A parser blew up on everything it claimed, so the drop was
            // recognised — reporting it as unreadable would send us looking at
            // the export instead of at the bug.
            failedParsers.length ? 'recognised-empty' : 'unrecognised',
            `Nothing Buho reads in ${entries.length.toLocaleString()} file${entries.length > 1 ? 's' : ''}. Here's what it can read: Spotify's *extended* streaming history, a Deezer .xlsx, a Last.fm scrobbles .json, a Google Timeline export, Takeout's My Activity as JSON, Messenger or Instagram archives, WhatsApp .txt chats, a Garmin export, or an Apple Health export.`
        );
    }

    hooks.stage('store');
    // Only seen when parsing beat the engine's download: a small file, on a
    // first visit, dropped without warning.
    if (!db.isReady()) {
        hooks.progress({
            status: 'loading',
            message: 'Starting the data engine...',
            progress: 0.3,
        });
    }
    await db.initDuckDB();
    const report: ImportReport = { modules: [], unrecognisedFiles };
    const rowsByService = new Map<string, number>();

    if (plays.length) {
        hooks.progress({
            status: 'importing',
            message: `Importing ${plays.length.toLocaleString()} plays...`,
            progress: 0.4,
        });
        // The sample rows go, and only they — see above. Only the music sample
        // is cleared here: a drop that also carried conversations must not claim
        // the sample ones are now yours.
        if (hooks.isSample('listening')) await db.dropTable('plays');
        await db.insertPlays(plays);
        hooks.sampleReplaced('listening');
        report.modules.push({
            module: 'listening',
            rows: plays.length,
            services: servicesIn(plays, (play) => play.source),
        });
        tallyBy(rowsByService, plays, (play) => play.source);
    }

    if (threads.length) {
        hooks.progress({
            status: 'parsing',
            message: `Reading ${threads.length.toLocaleString()} conversations...`,
            progress: 0.5,
        });
        const { rows } = buildMessageRows(threads);

        if (rows.length > 0) {
            hooks.progress({
                status: 'importing',
                message: `Importing ${rows.length.toLocaleString()} messages...`,
                progress: 0.55,
            });
            /*
             * The sample goes, and this matters more here than it does for
             * plays: message imports append so that WhatsApp does not erase
             * Messenger. Left alone, invented conversations would be merged into
             * real ones with no way to tell them apart again.
             */
            if (hooks.isSample('messages')) await db.dropTable('messages');
            await db.insertMessages(rows);
            hooks.sampleReplaced('messages');
            report.modules.push({
                module: 'messages',
                rows: rows.length,
                services: servicesIn(threads, (thread) => thread.network),
            });
            for (const thread of threads) {
                tally(rowsByService, thread.network, thread.messages.length);
            }
        }
    }

    if (activity.length) {
        hooks.progress({
            status: 'importing',
            message: `Importing ${activity.length.toLocaleString()} entries...`,
            progress: 0.65,
        });
        await db.insertGoogleActivity(activity);
        report.modules.push({
            module: 'activity',
            rows: activity.length,
            services: ['google-activity'],
        });
        tally(rowsByService, 'google-activity', activity.length);
    }

    if (positions.length) {
        hooks.progress({
            status: 'importing',
            message: `Importing ${positions.length.toLocaleString()} positions...`,
            progress: 0.75,
        });
        hooks.positionsIncoming();
        // Rebuilt from the full table by the geo enrichment, so it is always
        // stale once new points land.
        await db.dropTable('position_days');
        await db.insertLocationSegments(positions);
        report.modules.push({
            module: 'positions',
            rows: positions.length,
            services: servicesIn(positions, (segment) => segment.source),
        });
        tallyBy(rowsByService, positions, (segment) => segment.source);
    }

    if (steps.length) {
        hooks.progress({
            status: 'importing',
            message: `Importing ${steps.length.toLocaleString()} step packets...`,
            progress: 0.85,
        });
        await db.insertStepPackets(steps);
        report.modules.push({
            module: 'steps',
            rows: steps.length,
            services: servicesIn(steps, (packet) => packet.source),
        });
        tallyBy(rowsByService, steps, (packet) => packet.source);
    }

    // Read beside the step counts, in the same module, and not counted with
    // them: the report and the analytics tally the module in packets.
    if (gait.length) await db.insertGaitReadings(gait);

    if (health.length) {
        hooks.progress({
            status: 'importing',
            message: `Importing ${health.length.toLocaleString()} health readings...`,
            progress: 0.92,
        });
        await db.insertHealthReadings(health);
        report.modules.push({ module: 'health', rows: health.length, services: ['garmin'] });
        tally(rowsByService, 'garmin', health.length);
    }

    if (report.modules.length === 0) {
        // Recognised, but empty: a conversation with no messages, an export
        // whose history section is blank. Silently reporting success would look
        // like the drop was ignored.
        throw new ImportError(
            'recognised-empty',
            'Those files were recognised but hold nothing to import — an empty conversation, or an export with no history in it.'
        );
    }

    return { report, rowsByService, failedParsers, files: entries.length };
}

/** How the files were handed over, as the import analytics reports it. */
export interface ImportContext {
    pick: string;
    surface: string;
    expected: string;
    /** Whether the drop landed on an app that already held data. */
    adding: boolean;
}

/** The properties of the `upload` analytics event for a successful import. */
export function uploadEventProps(
    outcome: ImportOutcome,
    context: ImportContext,
    elapsedMs: number
): Record<string, string | boolean> {
    const { report, rowsByService, failedParsers, files } = outcome;
    return {
        // The export the drop was mostly about, on its own property: Umami breaks
        // one property down at a time, so this is what makes "which service do
        // people import?" a single readable chart. Which modules it filled
        // follows from it and is not sent — `services` says everything the drop
        // carried.
        service: dominant(rowsByService),
        services: [...rowsByService.keys()].sort().join('+'),
        rows: bucket(report.modules.reduce((total, m) => total + m.rows, 0)),
        files: fileBucket(files),
        // Files Buho opened and made nothing of. A service shipping a format we
        // stopped recognising shows up here first.
        unread: fileBucket(report.unrecognisedFiles),
        // A success that still lost a service. Empty on a clean import.
        failed: [...failedParsers].sort().join('+'),
        ms: durationBucket(elapsedMs),
        pick: context.pick,
        surface: context.surface,
        expected: context.expected,
        // Whether the drop held what the funnel led them to fetch. Only
        // meaningful when one was declared — "unknown" everywhere else.
        asExpected:
            context.expected === 'none' ? 'unknown' : String(rowsByService.has(context.expected)),
        // "First import" vs "came back with another export".
        adding: context.adding,
    };
}
