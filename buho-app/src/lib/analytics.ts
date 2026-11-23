// Privacy-first analytics — thin wrapper over Umami's cookieless tracker.
//
// Rules (respect the product's "no user data leaves the browser" promise):
//  - Never pass PII. Only counts, buckets and categorical *dimension keys*
//    (e.g. "artist", "album") — never user *values* (an artist name, a date,
//    a file name, an error message). The keys tell us what people do, not who
//    they are.
//  - Always a safe no-op when Umami is absent: dev, ad-blockers, DNT, etc.
//    Analytics must never throw into app code.
//
// Umami is cookieless and stores no personal data, so this needs no consent
// banner. Page views and time on page are tracked automatically by the script;
// every event below adds the page context (page + mode) so a single event name
// stays readable wherever it was fired from.
//
// One vocabulary, used the same way by every event — Umami breaks properties
// down one at a time, so a name meaning two things is a breakdown that answers
// neither question:
//
//   page     where it happened: the dataset's route ("listening", "steps"), or
//            "home" / "sources" / "other". Added automatically.
//   mode     "guide" | "explore" on a dataset route. Added automatically.
//   module   a dataset acted on: "listening", "positions", "messages"…
//   service  an *export* the rows came from: "spotify", "lastfm", "deezer",
//            "garmin", "google-timeline", "whatsapp"… This is the one an import
//            is about; the module it fills follows from it.
//
// `source` is deliberately not a property name any more: it used to mean the
// page's dataset on some events and the export id on others, which made the
// upload breakdown unreadable (and "none" on every route the page list had
// never been extended to).
//
// Budget: the Umami Cloud free tier counts every pageview *and* every custom
// event against 100k/month. Continuous interactions must therefore go through
// `trackThrottled` / `trackOnce`, and a hard per-page cap guards against a
// runaway loop burning the quota.

import { IMPORT_FAILURES, type ImportFailure } from '#lib/data/import/errors.ts';

declare global {
    interface Window {
        umami?: {
            track: (event: string, data?: Record<string, unknown>) => void;
        };
    }
}

type EventData = Record<string, string | number | boolean>;

/**
 * The full event catalog. Keeping it as a union means a typo is a type error
 * and the dashboard never grows a near-duplicate name.
 */
export type EventName =
    // The import funnel, one event per step so each one breaks down by
    // `service` on its own: howto-open → export-open → import-start → upload.
    //
    // An export's guide was shown — onboarding, import dialog or /sources, which
    // the page context tells apart.
    | 'howto-open'
    // Left Buho for the provider's own export page — the step nothing after it
    // can observe, and the one the whole funnel waits on.
    | 'export-open'
    // A drop, or a click on a file / folder button (the picker may still be
    // cancelled). Starts and outcomes apart are the imports that killed the tab.
    | 'import-start'
    | 'upload'
    | 'upload-error'
    // One service failed inside a drop the others may have survived — invisible
    // to `upload` / `upload-error`, which only see the drop's overall verdict.
    | 'parse-error'
    // The import dialog opened from inside a module.
    | 'import-open'
    | 'geo-enrich'
    | 'demo-load'
    // reading
    | 'section-view'
    // exploration
    | 'filter-set'
    | 'filter-remove'
    | 'filter-clear'
    | 'filter-combo'
    | 'viz-control'
    // A chart was exported as a file (still, clip or GIF). The format and the
    // verdict, never what was in the picture.
    | 'viz-share'
    // Someone sent the app's own address on — the channel it went to, nothing
    // about what they had been looking at when they did.
    | 'app-share'
    // On a phone, someone sent the page to themselves to open on a computer —
    // which screen they did it from and which route it took (share sheet,
    // clipboard, mail app), never the address or where it went.
    | 'send-to-computer'
    // On a phone, someone asked for the full app rather than the phone version —
    // from the landing page or from an Explorer's poster.
    | 'explore-anyway'
    // health
    | 'js-error'
    | 'third-party-error';

/**
 * Which page an event was fired from, derived from the route.
 *
 * The dataset routes are named after the data — /listening, /steps — so these
 * are the module ids, and the list has to hold every one of them: it used to
 * name three exports and answered "none" everywhere else, which is why a Garmin
 * or Google Activity import looked like it came from nowhere.
 *
 * Kept as a literal list rather than derived from `DATA_MODULES`: analytics is
 * a leaf that the store imports, and reading the module catalogue here would
 * close the cycle. `analytics.test.ts` fails if a module is ever missing from
 * it.
 */
export type PageKey =
    | 'listening'
    | 'positions'
    | 'messages'
    | 'activity'
    | 'steps'
    | 'health'
    | 'calendar'
    | 'sources'
    | 'home'
    | 'other';

const PAGES = new Set<string>([
    'listening',
    'positions',
    'messages',
    'activity',
    'steps',
    'health',
    'calendar',
    'sources',
]);

/** Guide narration vs. Explorer, derived from the route. */
export type ModeKey = 'guide' | 'explore' | 'home' | 'none';

interface PageContext {
    page: PageKey;
    mode: ModeKey;
}

/**
 * Where the page context comes from: the URL, not the caller. Every call site
 * would otherwise have to thread "am I on the maps explorer?" through props.
 */
export function pageContext(): PageContext {
    if (typeof window === 'undefined') return { page: 'other', mode: 'none' };
    const path = window.location.pathname;

    // Matched on any segment rather than the first, so a base path (or a deeper
    // route like /sources/lastfm) still resolves to its section.
    const segments = path.split('/').filter(Boolean);
    const section = segments.find((segment) => PAGES.has(segment));
    const page: PageKey = section ? (section as PageKey) : segments.length === 0 ? 'home' : 'other';

    const mode: ModeKey = path.includes('/guide')
        ? 'guide'
        : path.includes('/explore')
          ? 'explore'
          : page === 'home'
            ? 'home'
            : 'none';

    return { page, mode };
}

// A single page-load never legitimately needs hundreds of events; past the cap
// something is looping and we stop rather than eat the monthly quota.
const MAX_EVENTS_PER_PAGE = 300;
let sent = 0;

/** Fire a custom Umami event. Safe no-op when the tracker is unavailable. */
export function trackEvent(name: EventName, data?: EventData): void {
    if (typeof window === 'undefined') return;
    if (sent >= MAX_EVENTS_PER_PAGE) return;
    sent += 1;
    try {
        window.umami?.track(name, { ...pageContext(), ...data });
    } catch {
        // analytics must never break the app
    }
}

// Continuous interactions (brush filtering, slider drags, playback scrubbing)
// would otherwise emit hundreds of events. Collapse repeats of the same logical
// action to at most one per window so the data stays meaningful, cheap and
// non-invasive.
const lastSent = new Map<string, number>();

export function trackThrottled(
    name: EventName,
    key: string,
    data?: EventData,
    windowMs = 3000
): void {
    const id = `${name}:${key}`;
    const now = Date.now();
    if (now - (lastSent.get(id) ?? 0) < windowMs) return;
    lastSent.set(id, now);
    trackEvent(name, data);
}

// Reach-style events (a guide section scrolled into view) should count one user
// once, however many times they scroll back past it.
const seen = new Set<string>();

export function trackOnce(name: EventName, key: string, data?: EventData): void {
    const id = `${name}:${key}`;
    if (seen.has(id)) return;
    seen.add(id);
    trackEvent(name, data);
}

/**
 * A chart control was used: an axis picked, a colour mode switched, a playback
 * started. `value` must come from the control's own closed set of options
 * (an axis key, "play", a speed multiplier) — never a value out of the data.
 *
 * Throttled per (viz, control) so dragging a slider or hammering a step button
 * counts as one interaction.
 */
export function trackControl(viz: string, control: string, value: string | number | boolean): void {
    // `vizControl` pre-composes viz × control into one value: Umami breaks each
    // property down on its own, so this is what makes "which control, on which
    // chart" readable without cross-tabbing two properties (it can't).
    trackThrottled(
        'viz-control',
        `${viz}:${control}`,
        { viz, control, vizControl: `${viz}@${control}`, value },
        1500
    );
}

// Lightweight crash visibility. Umami is not an error tracker (no stack traces,
// no grouping, no source maps — use Sentry if you need that), but a coarse
// "things are breaking" signal is cheap. We send only the error *name*, the
// script *file* (basename) and the position, never the message, which could
// carry user data. A line and column are a place in our own bundle: code, not
// data.
export function initErrorTracking(): void {
    if (typeof window === 'undefined') return;

    window.addEventListener('error', (event) => {
        // A script from *another origin* throwing — a browser extension, an
        // injected tag, anything the visitor's own setup put on the page. The
        // browser censors all of it for us: no error object, no filename, and a
        // fixed "Script error." message. It reached this handler looking exactly
        // like a crash of ours ("Error", from "unknown"), which is worse than
        // useless in a crash count — nothing here is ours and nothing about it is
        // actionable. Own bucket, so the js-error figure means what it says.
        if (!event.error && !event.filename) {
            trackThrottled('third-party-error', 'cross-origin');
            return;
        }

        const name = event.error?.name ?? 'Error';
        const file = event.filename ? event.filename.split('/').pop() : 'unknown';
        trackThrottled('js-error', `${name}:${file}`, {
            kind: 'error',
            name,
            file: file ?? 'unknown',
            // Enough to find it in the deployed chunk, which is reproducible from
            // the commit it was built at.
            at: `${event.lineno ?? 0}:${event.colno ?? 0}`,
        });
    });

    // A rejected promise nobody caught is the same failure reached through an
    // `await`, so the same event: `kind` tells the two apart. A rejection
    // carries no file or position to send.
    window.addEventListener('unhandledrejection', (event) => {
        const reason = event.reason;
        const name = reason instanceof Error ? reason.name : 'UnhandledRejection';
        trackThrottled('js-error', `rejection:${name}`, { kind: 'rejection', name });
    });
}

/**
 * Coarse size bucket so we never report an exact, fingerprintable count.
 *
 * The tiers run well past 100k because real imports do: a Garmin archive yields
 * a few hundred thousand track points, a decade of scrobbles the same, and a
 * top tier of ">100k" collapsed every one of them into a single bar — exactly
 * the imports whose duration and failure rate are worth watching.
 */
export function bucket(n: number): string {
    if (n <= 0) return '0';
    if (n < 1_000) return '<1k';
    if (n < 10_000) return '1k-10k';
    if (n < 50_000) return '10k-50k';
    if (n < 100_000) return '50k-100k';
    if (n < 250_000) return '100k-250k';
    if (n < 500_000) return '250k-500k';
    if (n < 1_000_000) return '500k-1M';
    if (n < 5_000_000) return '1M-5M';
    return '>5M';
}

/** Small-count bucket, for things like "how many filters at once". */
export function smallBucket(n: number): string {
    if (n <= 0) return '0';
    if (n <= 3) return String(n);
    if (n <= 10) return '4-10';
    return '>10';
}

/**
 * How many files a drop held, after zips are expanded.
 *
 * `smallBucket` topped out at ">10", which every real export clears in its
 * first folder — a Takeout is thousands of files, and the difference between
 * "one .json" and "a whole unpacked archive" is the most telling thing about
 * how people hand their data over.
 */
export function fileBucket(n: number): string {
    if (n <= 0) return '0';
    if (n <= 3) return String(n);
    if (n <= 10) return '4-10';
    if (n <= 100) return '11-100';
    if (n <= 1_000) return '100-1k';
    if (n <= 10_000) return '1k-10k';
    return '>10k';
}

/** Wall-clock bucket for import / enrichment durations. */
export function durationBucket(ms: number): string {
    if (ms < 1_000) return '<1s';
    if (ms < 5_000) return '1-5s';
    if (ms < 15_000) return '5-15s';
    if (ms < 60_000) return '15-60s';
    // Past a minute is where people start deciding the tab has hung, so the
    // tail is where the tiers have to stay legible rather than pile into ">60s".
    if (ms < 180_000) return '1-3m';
    if (ms < 600_000) return '3-10m';
    return '>10m';
}

/**
 * Import failures classified into a closed set of codes — see
 * `data/import/errors.ts`, which owns the set.
 *
 * Error *messages* are unsafe to send: they interpolate file names, counts and
 * parser output, i.e. the user's own data. The reason code says what broke
 * without saying anything about whose data broke it.
 */
export type FailureReason = ImportFailure;

const FAILURE_CODES = new Set<string>(IMPORT_FAILURES);

/**
 * A failure Buho raised itself carries its code; anything else — JSZip, DuckDB,
 * the engine — has to be recognised from what it says.
 *
 * The code is read structurally rather than with `instanceof`: an error that
 * crossed a worker boundary is a plain object by the time it lands here, and
 * `analytics.ts` stays a leaf nothing else has to import.
 */
export function failureReason(e: unknown): FailureReason {
    const code = (e as { code?: unknown } | null)?.code;
    if (typeof code === 'string' && FAILURE_CODES.has(code)) return code as FailureReason;

    const message = e instanceof Error ? e.message.toLowerCase() : String(e ?? '').toLowerCase();
    const name = e instanceof Error ? e.name : '';

    if (
        name === 'RangeError' ||
        message.includes('out of memory') ||
        message.includes('allocation')
    )
        return 'out-of-memory';
    if (message.includes('invalid json') || name === 'SyntaxError') return 'invalid-json';
    if (message.includes('zip')) return 'zip-damaged';
    if (message.includes('duckdb') || message.includes('table') || message.includes('query'))
        return 'db-error';
    return 'unknown';
}

/**
 * Signature of the filters currently applied, e.g. "artist+year". Answers
 * "which filters do people combine?" using only dimension keys — never the
 * selected values, which are user data.
 */
export function filterCombo(keys: Iterable<string>): string {
    const sorted = [...keys].sort();
    return sorted.length ? sorted.join('+') : 'none';
}

export {};
