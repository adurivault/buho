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
// every event below adds the page context (source + mode) so a single event
// name stays readable across the four surfaces.
//
// Budget: the Umami Cloud free tier counts every pageview *and* every custom
// event against 100k/month. Continuous interactions must therefore go through
// `trackThrottled` / `trackOnce`, and a hard per-page cap guards against a
// runaway loop burning the quota.

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
	// import funnel
	| "import-open"
	| "import-step"
	| "import-file-picked"
	| "upload"
	| "upload-error"
	| "geo-enrich"
	| "demo-load"
	// navigation & reading
	| "source-nav"
	| "section-view"
	// exploration
	| "filter-set"
	| "filter-remove"
	| "filter-clear"
	| "filter-combo"
	| "viz-control"
	// health
	| "js-error"
	| "promise-rejection";

/** Data source a page belongs to, derived from the route. */
export type SourceKey = "spotify" | "google-maps" | "messages" | "home" | "none";

/** Guide narration vs. Explorer, derived from the route. */
export type ModeKey = "guide" | "explore" | "home" | "none";

interface PageContext {
	source: SourceKey;
	mode: ModeKey;
}

/**
 * Where the page context comes from: the URL, not the caller. Every call site
 * would otherwise have to thread "am I on the maps explorer?" through props.
 */
export function pageContext(): PageContext {
	if (typeof window === "undefined") return { source: "none", mode: "none" };
	const path = window.location.pathname;

	const source: SourceKey = path.includes("/spotify")
		? "spotify"
		: path.includes("/google-maps")
			? "google-maps"
			: path.includes("/messages")
				? "messages"
				: path === "/" || path === ""
					? "home"
					: "none";

	const mode: ModeKey = path.includes("/guide")
		? "guide"
		: path.includes("/explore")
			? "explore"
			: source === "home"
				? "home"
				: "none";

	return { source, mode };
}

// A single page-load never legitimately needs hundreds of events; past the cap
// something is looping and we stop rather than eat the monthly quota.
const MAX_EVENTS_PER_PAGE = 300;
let sent = 0;

/** Fire a custom Umami event. Safe no-op when the tracker is unavailable. */
export function trackEvent(name: EventName, data?: EventData): void {
	if (typeof window === "undefined") return;
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
	windowMs = 3000,
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
export function trackControl(
	viz: string,
	control: string,
	value: string | number | boolean,
): void {
	// `vizControl` pre-composes viz × control into one value: Umami breaks each
	// property down on its own, so this is what makes "which control, on which
	// chart" readable without cross-tabbing two properties (it can't).
	trackThrottled(
		"viz-control",
		`${viz}:${control}`,
		{ viz, control, vizControl: `${viz}@${control}`, value },
		1500,
	);
}

// Lightweight crash visibility. Umami is not an error tracker (no stack traces,
// no grouping, no source maps — use Sentry if you need that), but a coarse
// "things are breaking" signal is cheap. We send only the error *name* and the
// script *file* (basename), never the message, which could carry user data.
export function initErrorTracking(): void {
	if (typeof window === "undefined") return;

	window.addEventListener("error", (event) => {
		const name = event.error?.name ?? "Error";
		const file = event.filename ? event.filename.split("/").pop() : "unknown";
		trackThrottled("js-error", `${name}:${file}`, { name, file: file ?? "unknown" });
	});

	window.addEventListener("unhandledrejection", (event) => {
		const reason = event.reason;
		const name = reason instanceof Error ? reason.name : "UnhandledRejection";
		trackThrottled("promise-rejection", name, { name });
	});
}

/** Coarse size bucket so we never report an exact, fingerprintable count. */
export function bucket(n: number): string {
	if (n <= 0) return "0";
	if (n < 1_000) return "<1k";
	if (n < 10_000) return "1k-10k";
	if (n < 50_000) return "10k-50k";
	if (n < 100_000) return "50k-100k";
	return ">100k";
}

/** Small-count bucket, for things like "how many files / filters at once". */
export function smallBucket(n: number): string {
	if (n <= 0) return "0";
	if (n <= 3) return String(n);
	if (n <= 10) return "4-10";
	return ">10";
}

/** Wall-clock bucket for import / enrichment durations. */
export function durationBucket(ms: number): string {
	if (ms < 1_000) return "<1s";
	if (ms < 5_000) return "1-5s";
	if (ms < 15_000) return "5-15s";
	if (ms < 60_000) return "15-60s";
	return ">60s";
}

/**
 * Import failures classified into a closed set of codes.
 *
 * Error *messages* are unsafe to send: they interpolate file names, counts and
 * parser output, i.e. the user's own data. The reason code says what broke
 * without saying anything about whose data broke it.
 */
export type FailureReason =
	| "empty-selection"
	| "no-valid-data"
	| "invalid-json"
	| "zip-error"
	| "db-error"
	| "out-of-memory"
	| "unknown";

export function failureReason(e: unknown): FailureReason {
	const message = e instanceof Error ? e.message.toLowerCase() : String(e ?? "").toLowerCase();
	const name = e instanceof Error ? e.name : "";

	if (name === "RangeError" || message.includes("out of memory") || message.includes("allocation"))
		return "out-of-memory";
	if (message.includes("invalid json") || name === "SyntaxError") return "invalid-json";
	if (message.includes("zip")) return "zip-error";
	if (message.includes("no valid")) return "no-valid-data";
	if (message.includes("no files") || message.includes("empty")) return "empty-selection";
	if (message.includes("duckdb") || message.includes("table") || message.includes("query"))
		return "db-error";
	return "unknown";
}

/**
 * Signature of the filters currently applied, e.g. "artist+year". Answers
 * "which filters do people combine?" using only dimension keys — never the
 * selected values, which are user data.
 */
export function filterCombo(keys: Iterable<string>): string {
	const sorted = [...keys].sort();
	return sorted.length ? sorted.join("+") : "none";
}

export {};
