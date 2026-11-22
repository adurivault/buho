import { asset } from '$app/paths';
import type { ModuleId } from '#lib/data/modules.ts';

/**
 * The explorer captures shown before anything is loaded, and where each one
 * holds its crop.
 *
 * `npm run shots` (scripts/shots.mjs) writes them to static/shots/, one file
 * per theme, from the demo data only. Its list of what to capture and this one
 * of what to show are kept apart, the script being plain JavaScript; the test
 * beside this file holds the two together by checking every file named here
 * exists.
 */

export type Theme = 'light' | 'dark';

/**
 * Every capture there is. A union rather than a string so `asset()`, which is
 * typed against the files in static/, rejects a name with no file behind it.
 */
type Charted = Exclude<ModuleId, 'health'>;
export type ShotFile =
    | `${ModuleId}-page`
    | `${Charted}-constellation`
    | 'listening-artists'
    | 'positions-map'
    | 'messages-conversations'
    | 'activity-services'
    | 'steps-cadence'
    | 'health-heart-rate'
    | 'health-stress'
    | 'calendar-year'
    | 'calendar-clock';

export interface Shot {
    /** static/shots/<file>-<theme>.webp */
    file: ShotFile;
    /** Where the picture stays anchored when its card crops it (`object-position`). */
    focus: string;
    /**
     * A credit the picture has to carry: the map tiles' licence. `label` is
     * what fits on the picture; `full` is the whole notice, on hover, as
     * MapLibre itself compacts it on a small map.
     */
    credit?: { label: string; full: string };
}

/** A welcome's pair: the explorer's main chart, and a second one of another kind. */
export interface Preview {
    main: Shot;
    side: Shot;
}

const MAP_CREDIT = {
    label: '© OpenStreetMap',
    full: 'OpenFreeMap © OpenMapTiles, data © OpenStreetMap contributors',
};

const constellation = (module: Charted): Shot => ({
    file: `${module}-constellation`,
    focus: 'left top',
});

/** The whole explorer page, as a module's home tile shows it. */
const page = (module: ModuleId): Shot => ({ file: `${module}-page`, focus: 'left top' });

/** Per module: its welcome's pair, and its whole explorer page for the home. */
export const MODULE_SHOTS: Record<ModuleId, Preview & { page: Shot }> = {
    listening: {
        page: page('listening'),
        main: constellation('listening'),
        side: { file: 'listening-artists', focus: 'center' },
    },
    positions: {
        page: page('positions'),
        main: constellation('positions'),
        side: { file: 'positions-map', focus: 'center', credit: MAP_CREDIT },
    },
    messages: {
        page: page('messages'),
        main: constellation('messages'),
        side: { file: 'messages-conversations', focus: 'center top' },
    },
    activity: {
        page: page('activity'),
        main: constellation('activity'),
        side: { file: 'activity-services', focus: 'center' },
    },
    steps: {
        page: page('steps'),
        main: constellation('steps'),
        side: { file: 'steps-cadence', focus: 'center 70%' },
    },
    health: {
        page: page('health'),
        main: { file: 'health-heart-rate', focus: 'left top' },
        side: { file: 'health-stress', focus: 'left center' },
    },
};

/** The calendar's pair: a year's lanes, and the same year round a clock. */
export const CALENDAR_SHOTS: Preview = {
    main: { file: 'calendar-year', focus: 'left top' },
    side: { file: 'calendar-clock', focus: 'center' },
};

/** Where one theme's capture is served. */
export function shotSrc(shot: Shot, theme: Theme): string {
    return asset(`shots/${shot.file}-${theme}.webp`);
}
