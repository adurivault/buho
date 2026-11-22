import type { Path } from '$app/types';
import type { IconName } from '#lib/components/icons.ts';

/**
 * The datasets Buho builds views on — one table, one route, one sidebar entry
 * each.
 *
 * This is the app's spine, not documentation: the sidebar renders from it, and
 * so do the columns of the /sources matrix. Keeping them on one list is what
 * makes the matrix a true legend for the sidebar — a source added to one shows
 * up in the other, in the same order and the same colour.
 *
 * What *feeds* each module is a separate question, answered in `catalog.ts`.
 */

export type ModuleId = 'listening' | 'messages' | 'positions' | 'activity' | 'steps' | 'health';

export interface DataModule {
    id: ModuleId;
    /**
     * The dataset's own name — matrix column header, module header, sidebar.
     *
     * There used to be a second `navLabel` beside it, "the service people know
     * it by", for the sidebar alone. It put two axes on one list: Steps was
     * "Garmin" and Positions "Google Maps" while Health and Messages were
     * themselves. One Garmin export fills Steps, Health *and* Positions, so
     * naming exactly one of the three after the watch was worse than
     * inconsistent — it was wrong, and it sent anyone arriving for Garmin to
     * the step counters as though that were all of it. Which exports feed a
     * module is a question `sourcesFilling` answers from the catalogue, where
     * it cannot drift.
     */
    label: string;
    /** What lands in it, in one line. */
    blurb: string;
    /** The DuckDB table it is stored in. */
    table: string;
    /**
     * The glyph for the dataset, in the sidebar and as a matrix column header.
     * It stands for the data, not whoever recorded it — Steps is footprints
     * everywhere, while Garmin's own triangle marks the *export* it comes from,
     * one row of the matrix.
     */
    icon: IconName;
    /** Landing route. Still needs `resolve()` — the app is served under a base path. */
    href: Path;
    /**
     * Every route whose id starts with this prefix counts as being in this
     * module's section.
     *
     * It is `/${id}`: the URL names the data, never the company the export came
     * from — /listening rather than /spotify, /steps rather than /garmin. Which
     * service filled it is the import's business (see `catalog.ts`), and one
     * module can be fed by several.
     */
    section: `/${ModuleId}`;
    /**
     * Whether this module ships sample data to explore before importing
     * anything — see `lib/demo/load.ts`, which must have a builder for exactly
     * the modules flagged here.
     *
     * A module without one is a module somebody has to spend two days waiting
     * on an export to evaluate, so the flag is worth adding wherever a
     * defensible model can be written. It is not free: an invented history that
     * does not have the structure the charts look for makes a working app look
     * broken.
     */
    hasDemo?: boolean;
    /**
     * The module's guide, the scrolling narration, when it has one.
     *
     * Read where the Explorer is not offered — on a phone, the guide is the view
     * that still works, since it is read by scrolling rather than by pointing.
     */
    guide?: Path;
}

export const DATA_MODULES: DataModule[] = [
    {
        id: 'listening',
        label: 'Listening',
        blurb: 'Every track you played, with the moment and how long it lasted.',
        table: 'plays',
        icon: 'music-note',
        href: 'listening/explore',
        section: '/listening',
        guide: 'listening/guide',
        hasDemo: true,
    },
    {
        id: 'positions',
        label: 'Positions',
        blurb: 'Timestamped points, stationary or moving, from any recorder.',
        table: 'location_segments',
        icon: 'map-pin',
        href: 'positions/explore',
        section: '/positions',
        guide: 'positions/guide',
    },
    {
        id: 'messages',
        label: 'Messages',
        blurb: 'Conversations, their participants, and every message in them.',
        table: 'messages',
        icon: 'message',
        href: 'messages/explore',
        section: '/messages',
        guide: 'messages/guide',
        hasDemo: true,
    },
    {
        id: 'activity',
        label: 'Google activity',
        blurb: 'What you watched, searched and looked up, entry by entry.',
        table: 'google_activity',
        icon: 'google-activity',
        href: 'activity/explore',
        section: '/activity',
    },
    {
        id: 'steps',
        label: 'Steps',
        blurb: 'The all-day counters a watch keeps, window by window.',
        table: 'step_packets',
        icon: 'footprints',
        href: 'steps/explore',
        section: '/steps',
    },
    {
        id: 'health',
        label: 'Health',
        blurb: 'What the watch measured of you, minute by minute, while worn.',
        table: 'health_readings',
        icon: 'heartbeat',
        href: 'health/explore',
        section: '/health',
    },
];

/**
 * The module with this id.
 *
 * Throws rather than returning undefined: every caller passes a literal, so a
 * miss is a typo, and a section header silently rendering nothing is worse than
 * a loud failure.
 */
export function moduleById(id: ModuleId): DataModule {
    const module = DATA_MODULES.find((candidate) => candidate.id === id);
    if (!module) throw new Error(`Unknown module "${id}"`);
    return module;
}
