/**
 * Rendering UTC instants as the local wall-clock the user actually experienced.
 *
 * Every table in Buho stores naive TIMESTAMP/DATE values — the digits on the
 * clock at the place, not an instant. Reading a Date with `getHours()` would
 * reinterpret it in whatever timezone the *browser* happens to be in, which
 * turns a 7am run in Paris into a 1am run for a reader in New York. So each
 * source resolves its own offset and formats through here instead.
 */

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * Render a UTC instant as a local wall-clock string, applying `offsetMinutes`.
 * We add the offset to the instant and read the UTC fields, so the digits are
 * the local time at the place.
 */
export function wallClock(instantMs: number, offsetMinutes: number): string {
    const d = new Date(instantMs + offsetMinutes * 60_000);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

/** The day part of {@link wallClock}, for the `date` column. */
export function wallClockDate(instantMs: number, offsetMinutes: number): string {
    const d = new Date(instantMs + offsetMinutes * 60_000);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
