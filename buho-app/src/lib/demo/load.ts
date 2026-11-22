import {
    dropTable,
    initDuckDB,
    insertGoogleActivity,
    insertHealthReadings,
    insertLocationSegments,
    insertMessages,
    insertPlays,
    insertStepPackets,
} from '#lib/data/db/index.ts';
import { buildMessageRows } from '#lib/data/import/buildRows.ts';
import { parseSpotifyData } from '#lib/data/sources/spotify/parse.ts';
import { parseTimelineData } from '#lib/data/sources/googleTimeline/parse.ts';
import { parseActivityEntry } from '#lib/data/sources/googleActivity/parser.ts';
import { stepPacketsFromFiles } from '#lib/data/sources/garmin/stepPackets.ts';
import { healthReadingsFromFiles } from '#lib/data/sources/garmin/healthReadings.ts';
import { dataStore } from '#lib/stores/dataStore.svelte.ts';
import type { ModuleId } from '#lib/data/modules.ts';

/**
 * Builds invented data and loads it, on request.
 *
 * This used to happen on its own, in `onMount` of the listening layout: anybody
 * who opened /listening/explore was shown a hundred thousand plays that were not
 * theirs, with nothing but a small pill to say so. For recruited participants
 * that is worse than unhelpful — it is a page of somebody else's habits
 * presented as the thing they came to look at.
 *
 * Each generator is imported dynamically so that the models, the catalogs and
 * the vocabularies stay out of the main bundle. Nobody who came here with their
 * own export should be downloading a fake one.
 *
 * Every sample takes the same road as a real import — through the parser, the
 * Garmin builders, or `buildMessageRows` — rather than writing rows straight to
 * DuckDB. If the sample skipped a step the import performs, it would be a
 * sample of something the app never actually shows.
 *
 * The watch, location and activity samples are one person (`life.ts`), so
 * loading them together lines their days up on the calendar.
 */

/**
 * Which modules have a sample, and how to build it. Must agree with the
 * `hasDemo` flags in `data/modules.ts` — the flag is what puts the button on
 * screen, this is what happens when it is pressed.
 */
const BUILDERS: Partial<Record<ModuleId, () => Promise<void>>> = {
    listening: async () => {
        const { generateListening } = await import('./listening');
        await insertPlays(parseSpotifyData(generateListening()));
        dataStore.loadDemoData('listening');
    },
    messages: async () => {
        const { generateConversations } = await import('./messages');
        const { rows } = buildMessageRows(generateConversations());
        await insertMessages(rows);
        dataStore.loadDemoData('messages');
        await dataStore.refreshSummaries();
    },
    positions: async () => {
        const { generateTimeline } = await import('./places');
        // Derived from the segments, like after any import of positions.
        await dropTable('position_days');
        await insertLocationSegments(parseTimelineData(generateTimeline()));
        dataStore.loadDemoData('positions');
        dataStore.rederivePositions();
    },
    activity: async () => {
        const { generateMyActivity } = await import('./activity');
        const rows = generateMyActivity().map(parseActivityEntry);
        await insertGoogleActivity(rows.filter((row) => row !== null));
        dataStore.loadDemoData('activity');
    },
    steps: async () => {
        const { generateWatchFiles } = await import('./watch');
        await insertStepPackets(stepPacketsFromFiles(generateWatchFiles()));
        dataStore.loadDemoData('steps');
    },
    health: async () => {
        const { generateWatchFiles } = await import('./watch');
        await insertHealthReadings(healthReadingsFromFiles(generateWatchFiles()));
        dataStore.loadDemoData('health');
    },
};

/**
 * Build and load the sample for one module.
 *
 * A no-op for a module with no sample, and while any import is already running:
 * a second one landing mid-flight would report progress over the first.
 */
export async function loadDemo(module: ModuleId): Promise<void> {
    const build = BUILDERS[module];
    if (!build || dataStore.loading) return;

    dataStore.setLoading({ status: 'loading', message: 'Building the sample…' });

    try {
        await initDuckDB();
        await build();
    } catch (error) {
        dataStore.setError(
            error instanceof Error ? error.message : 'Could not build the sample data'
        );
    } finally {
        dataStore.setLoading(null);
    }
}
