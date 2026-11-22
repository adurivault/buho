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
    /**
     * The heading of the module's welcome, the screen it shows while it holds
     * nothing: `subject` in the module's colour, then `rest`.
     * Descriptive on purpose — it names the data, it does not sell it.
     */
    heading: { subject: string; rest?: string };
    /**
     * What the module's explorer answers, as a visitor would ask it. Listed on
     * the welcome, so an empty module says what loading it is for. Each one is
     * answered by a view the explorer has, or it does not belong here; two good
     * ones beat three where the third is filler.
     */
    questions: string[];
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
        blurb: 'Plays by artist, track, hour and day.',
        heading: { subject: 'Listening', rest: 'history' },
        questions: [
            'Which artists do you play the most?',
            'At what time of day do you listen?',
            'How often do you skip a track?',
        ],
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
        blurb: 'Places, trips and routes.',
        heading: { subject: 'Location', rest: 'history' },
        questions: [
            'Where in the city do you spend your time?',
            'How much time have you spent in each city?',
        ],
        table: 'location_segments',
        icon: 'map-pin',
        href: 'positions/explore',
        section: '/positions',
        hasDemo: true,
        guide: 'positions/guide',
    },
    {
        id: 'messages',
        label: 'Messages',
        blurb: 'Messages by conversation, person and hour.',
        heading: { subject: 'Conversations' },
        questions: ['Who do you write to the most?', 'Do you send more messages than you receive?'],
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
        blurb: 'YouTube, Search and Maps history.',
        heading: { subject: 'Google activity' },
        questions: [
            'Which YouTube channels do you watch the most?',
            'Do you watch more than you search?',
        ],
        table: 'google_activity',
        icon: 'google-activity',
        href: 'activity/explore',
        section: '/activity',
        hasDemo: true,
    },
    {
        id: 'steps',
        label: 'Steps',
        blurb: 'Steps per day and per hour.',
        heading: { subject: 'Step', rest: 'counts' },
        questions: [
            'At what time of day do you walk the most?',
            'Do you walk more in summer than in winter?',
            'How many of your steps are running?',
        ],
        table: 'step_packets',
        icon: 'footprints',
        href: 'steps/explore',
        section: '/steps',
        hasDemo: true,
    },
    {
        id: 'health',
        label: 'Health',
        blurb: 'Heart rate, stress and breathing.',
        heading: { subject: 'Heart rate', rest: 'and stress' },
        questions: [
            'How does your heart rate change through the day?',
            'When are you most stressed?',
        ],
        table: 'health_readings',
        icon: 'heartbeat',
        href: 'health/explore',
        section: '/health',
        hasDemo: true,
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
