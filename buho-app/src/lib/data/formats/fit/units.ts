/**
 * The parts of the FIT format the SDK leaves to the caller.
 *
 * `@garmin/fitsdk` decodes messages and applies each field's scale, but three
 * things stay raw, and every one of them is load-bearing here. Kept free of any
 * SDK import so they can be unit-tested on plain objects.
 */

/** FIT counts seconds from 1989-12-31T00:00:00Z, not from the Unix epoch. */
export const FIT_EPOCH_UNIX_SECONDS = 631_065_600;

/** Coordinates are stored as semicircles: a full turn spans 2^32. */
export const SEMICIRCLES_TO_DEGREES = 180 / 2 ** 31;

/** A decoded message carrying both a UTC timestamp and its local counterpart. */
interface LocalTimestamped {
    timestamp?: Date | number | null;
    localTimestamp?: number | null;
}

/** Seconds since the FIT epoch for an instant the SDK turned into a `Date`. */
export function fitSeconds(timestamp: Date | number): number {
    const ms = timestamp instanceof Date ? timestamp.getTime() : timestamp * 1000;
    return Math.round(ms / 1000) - FIT_EPOCH_UNIX_SECONDS;
}

/** The instant a FIT timestamp denotes, in Unix milliseconds. */
export function fitSecondsToMs(seconds: number): number {
    return (seconds + FIT_EPOCH_UNIX_SECONDS) * 1000;
}

/**
 * The device's UTC offset, in minutes, from a message that carries both clocks.
 *
 * This has to be read per file rather than assumed: a watch records wherever
 * its owner is, and a single export routinely spans several offsets — the
 * fixture export used to build this feature sits at −5h in May 2024 and at +2h
 * in July 2026. Returns null when either clock is missing, leaving the caller
 * to decide on a fallback.
 */
export function localOffsetMinutes(mesg: LocalTimestamped | undefined | null): number | null {
    if (!mesg?.timestamp || mesg.localTimestamp == null) return null;
    return Math.round((mesg.localTimestamp - fitSeconds(mesg.timestamp)) / 60);
}

/** A monitoring message as far as timestamp resolution is concerned. */
interface Timestamped {
    timestamp?: Date | number | null;
    timestamp16?: number | null;
}

/**
 * Resolve the compressed timestamps monitoring files are mostly made of.
 *
 * A monitoring file states a full timestamp once, then emits `timestamp16` — the
 * low 16 bits of the running second count — for everything that follows, so a
 * message on its own has no date at all. The SDK reports the field but does not
 * expand it, and in a real daily file 140 of the 143 messages carrying a step
 * counter arrive this way; without this they would all collapse onto one
 * instant.
 *
 * Returns FIT seconds, or null before the first full timestamp has been seen.
 * Stateful by construction — create one resolver per file and feed it every
 * message in file order.
 */
export function makeTimestamp16Resolver(): (mesg: Timestamped) => number | null {
    let last: number | null = null;

    return (mesg) => {
        if (mesg.timestamp) {
            last = fitSeconds(mesg.timestamp);
        } else if (mesg.timestamp16 != null && last != null) {
            // Advance by the unsigned 16-bit distance, so a counter wrapping past
            // 65535 moves forward instead of jumping back a day.
            last += (mesg.timestamp16 - (last & 0xffff)) & 0xffff;
        }
        return last;
    };
}
