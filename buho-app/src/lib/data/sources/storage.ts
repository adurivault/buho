import type { ModuleId } from '../modules';

/**
 * Where each source's rows end up, so they can be counted and taken back out.
 *
 * The tables are shared: three music services write to `plays`, a phone and a
 * watch both to `location_segments`, three services to `messages`. That is what
 * makes the app work — one history, whatever recorded it — and it is also why
 * removing a source can't be a `DROP TABLE`. This map is the missing half of the
 * import: `catalog.ts` says what a source contributes, this says where it went.
 *
 * `catalog.test.ts` fails if a source is added to one and not the other.
 */

/** Where one source's rows land, for one of the modules it feeds. */
export interface SourceStore {
    module: ModuleId;
    table: string;
    /**
     * The provenance column, and the value this source writes into it. Absent
     * when the whole table belongs to this source and nothing shares it.
     */
    scope?: { column: string; value: string };
    /**
     * Rows a module carries beside what it counts — Apple Health's gait readings
     * next to its step packets. Taken out with the source like any other, but
     * left out of the tallies, which count a module in one unit.
     */
    beside?: true;
}

const bySource = (value: string) => ({ column: 'source', value });
const byNetwork = (value: string) => ({ column: 'network', value });

export const SOURCE_STORAGE: Record<string, SourceStore[]> = {
    spotify: [{ module: 'listening', table: 'plays', scope: bySource('spotify') }],
    deezer: [{ module: 'listening', table: 'plays', scope: bySource('deezer') }],
    lastfm: [{ module: 'listening', table: 'plays', scope: bySource('lastfm') }],
    'google-timeline': [
        { module: 'positions', table: 'location_segments', scope: bySource('google-timeline') },
    ],
    'google-activity': [{ module: 'activity', table: 'google_activity' }],
    messenger: [{ module: 'messages', table: 'messages', scope: byNetwork('messenger') }],
    instagram: [{ module: 'messages', table: 'messages', scope: byNetwork('instagram') }],
    whatsapp: [{ module: 'messages', table: 'messages', scope: byNetwork('whatsapp') }],
    // The one export feeding three modules, and so the one removal that has to
    // reach three tables.
    garmin: [
        { module: 'positions', table: 'location_segments', scope: bySource('garmin') },
        { module: 'steps', table: 'step_packets', scope: bySource('garmin') },
        { module: 'health', table: 'health_readings' },
    ],
    'apple-health': [
        { module: 'steps', table: 'step_packets', scope: bySource('apple-health') },
        { module: 'steps', table: 'gait_readings', beside: true },
    ],
    strava: [{ module: 'positions', table: 'location_segments', scope: bySource('strava') }],
};

/**
 * Where this source's rows live.
 *
 * Throws rather than returning nothing: a source with no storage can be imported
 * and then never removed, and silently un-removable data is worse than a loud
 * failure at startup.
 */
export function storesFor(id: string): SourceStore[] {
    const stores = SOURCE_STORAGE[id];
    if (!stores) throw new Error(`No storage declared for source "${id}"`);
    return stores;
}
