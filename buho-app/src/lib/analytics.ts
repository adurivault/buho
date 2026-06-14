// Privacy-first analytics — thin wrapper over Umami's cookieless tracker.
//
// Rules (respect the product's "no user data leaves the browser" promise):
//  - Never pass PII. Only counts, buckets and categorical *dimension keys*
//    (e.g. "artist", "album") — never user *values* (an artist name, a date,
//    a file name). The keys tell us what people do, not who they are.
//  - Always a safe no-op when Umami is absent: dev, ad-blockers, DNT, etc.
//    Analytics must never throw into app code.
//
// Umami is cookieless and stores no personal data, so this needs no consent
// banner. Page views (source = spotify/maps, mode = guide/explore) and time
// on page are tracked automatically by the script — only custom interactions
// below need explicit calls.

declare global {
	interface Window {
		umami?: {
			track: (event: string, data?: Record<string, unknown>) => void;
		};
	}
}

type EventData = Record<string, string | number | boolean>;

/** Fire a custom Umami event. Safe no-op when the tracker is unavailable. */
export function trackEvent(name: string, data?: EventData): void {
	if (typeof window === "undefined") return;
	try {
		window.umami?.track(name, data);
	} catch {
		// analytics must never break the app
	}
}

// Continuous interactions (brush filtering, slider drags) would otherwise emit
// hundreds of events. Collapse repeats of the same logical action to at most
// one per window so the data stays meaningful and non-invasive.
const lastSent = new Map<string, number>();

export function trackThrottled(
	name: string,
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

export {};
