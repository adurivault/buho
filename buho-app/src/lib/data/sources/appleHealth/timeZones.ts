/**
 * Where on Earth each Apple Health record was taken, as far as the export lets
 * anyone tell.
 *
 * The export does not keep the offset a record was written with. Every date in
 * `export.xml` is rewritten into the offset the phone had *on the day of the
 * export*: a January walk in Paris comes out as `+0200`, a morning in Lima as
 * `+0200` too. The instant survives, the local time does not — read as written,
 * winter is an hour late and a trip is seven hours off.
 *
 * What survives is a scattering of `HKTimeZone` metadata — the IANA zone the
 * phone was in — on the records Apple's own apps write with it: bedtime, and the
 * workouts some apps log. Sorted by instant they are a coarse itinerary, and
 * this module reads every other record against it.
 */

/** One point of the itinerary: the phone was in `zone` at `ms`. */
export interface ZoneMarker {
    ms: number;
    zone: string;
}

/**
 * How far a marker is trusted on its own, when the next one names another zone.
 * Bedtime markers come once a night, so a day and a half either side covers the
 * day it belongs to without stretching one trip over the weeks that follow.
 */
const MARKER_REACH_MS = 36 * 3600_000;

export interface ZoneTimeline {
    /** The IANA zone the phone was most likely in at `ms`. */
    zoneAt(ms: number): string;
    /** The zone a record falls back to when no marker is near. */
    home: string;
}

/**
 * Build the itinerary from the markers found in the export.
 *
 * For an instant between two markers: if both name the same zone, that zone —
 * nothing says the phone left. If they differ, the phone moved somewhere in
 * between, so the nearer side wins only within {@link MARKER_REACH_MS}; past
 * that, and before the first or after the last marker, the record falls back to
 * `home`. Home is the zone the markers name most often, which is the place a
 * year's bedtimes are spent; with no marker at all it is `fallbackZone`, the
 * zone the reader is in.
 */
export function buildZoneTimeline(markers: ZoneMarker[], fallbackZone: string): ZoneTimeline {
    const sorted = markers.filter((m) => isKnownZone(m.zone)).sort((a, b) => a.ms - b.ms);
    const home = mostFrequent(sorted.map((m) => m.zone)) ?? fallbackZone;

    const zoneAt = (ms: number): string => {
        if (sorted.length === 0) return home;
        // Index of the first marker after `ms`.
        let lo = 0;
        let hi = sorted.length;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (sorted[mid].ms <= ms) lo = mid + 1;
            else hi = mid;
        }
        const before = lo > 0 ? sorted[lo - 1] : null;
        const after = lo < sorted.length ? sorted[lo] : null;
        if (before && after && before.zone === after.zone) return before.zone;
        if (before && ms - before.ms <= MARKER_REACH_MS) return before.zone;
        if (after && after.ms - ms <= MARKER_REACH_MS) return after.zone;
        return home;
    };

    return { zoneAt, home };
}

function mostFrequent(values: string[]): string | null {
    const counts = new Map<string, number>();
    let best: string | null = null;
    let most = 0;
    for (const value of values) {
        const count = (counts.get(value) ?? 0) + 1;
        counts.set(value, count);
        if (count > most) {
            best = value;
            most = count;
        }
    }
    return best;
}

const formatters = new Map<string, Intl.DateTimeFormat | null>();

function formatterFor(zone: string): Intl.DateTimeFormat | null {
    if (!formatters.has(zone)) {
        try {
            formatters.set(
                zone,
                new Intl.DateTimeFormat('en-US', {
                    timeZone: zone,
                    hourCycle: 'h23',
                    year: 'numeric',
                    month: 'numeric',
                    day: 'numeric',
                    hour: 'numeric',
                    minute: 'numeric',
                    second: 'numeric',
                })
            );
        } catch {
            // A zone this engine's tz database does not know.
            formatters.set(zone, null);
        }
    }
    return formatters.get(zone) ?? null;
}

function isKnownZone(zone: string): boolean {
    return formatterFor(zone) !== null;
}

/**
 * Offsets by zone and hour. Offsets change on the hour almost everywhere, so
 * one lookup per hour is exact, and it turns a few hundred thousand calls into
 * the engine's tz database into a few thousand.
 */
const offsets = new Map<string, number>();

/** The UTC offset of `zone` at `ms`, in minutes. Unknown zones read as UTC. */
export function offsetMinutesAt(zone: string, ms: number): number {
    const hour = Math.floor(ms / 3600_000);
    const key = `${zone}|${hour}`;
    const cached = offsets.get(key);
    if (cached !== undefined) return cached;

    const formatter = formatterFor(zone);
    let offset = 0;
    if (formatter) {
        const at = hour * 3600_000;
        const parts: Record<string, number> = {};
        for (const part of formatter.formatToParts(at)) {
            if (part.type !== 'literal') parts[part.type] = Number(part.value);
        }
        const asUtc = Date.UTC(
            parts.year,
            parts.month - 1,
            parts.day,
            parts.hour,
            parts.minute,
            parts.second
        );
        offset = Math.round((asUtc - at) / 60_000);
    }
    offsets.set(key, offset);
    return offset;
}
