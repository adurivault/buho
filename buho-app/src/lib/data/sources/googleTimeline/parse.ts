import type { LocationSegment } from '#lib/types/positions.ts';
import type {
    RawActivityEntry,
    RawTimelineEntry,
    RawTimelinePathEntry,
    RawVisitEntry,
} from './types';
import { haversineMeters, bearingDegrees } from '#lib/data/geo/haversine.ts';
import { wallClock } from '#lib/utils/wallClock.ts';

/** Parse a `"geo:lat,lon"` string. Returns null if malformed. */
function parseGeo(geo: string | undefined | null): { lat: number; lon: number } | null {
    if (!geo) return null;
    const m = /^geo:(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/.exec(geo);
    if (!m) return null;
    return { lat: parseFloat(m[1]), lon: parseFloat(m[2]) };
}

/**
 * Local UTC offset (minutes) explicitly carried by an ISO string.
 * `+02:00` → 120, `-05:00` → -300, `+00:00` → 0.
 * Returns null for `Z`: the instant is UTC but the *local* offset is unknown
 * (this is the case for every timelinePath entry — see resolution below).
 */
function parseOffsetMinutes(iso: string): number | null {
    const m = /([+-])(\d{2}):(\d{2})$/.exec(iso);
    if (!m) return null;
    const sign = m[1] === '-' ? -1 : 1;
    return sign * (parseInt(m[2], 10) * 60 + parseInt(m[3], 10));
}

interface EntryRecord {
    startMs: number;
    endMs: number;
    offsetMinutes: number | null; // explicit local offset, or null for `Z`
    entry: RawTimelineEntry;
}

function durationSeconds(startMs: number, endMs: number): number {
    return Math.max(0, (endMs - startMs) / 1000);
}

/** Sensor columns only a watch fills in. Google Timeline has none of them. */
const NO_SENSORS = { altitudeMeters: null, heartRate: null, cadenceSpm: null } as const;

/** km/h from meters over seconds; null when the duration is non-positive. */
function speedKmh(meters: number, seconds: number): number | null {
    return seconds > 0 ? (meters / seconds) * 3.6 : null;
}

/**
 * Parse a Google Timeline export into flat location segments.
 *
 * Three entry types become segments:
 *   - `visit`        → one `stationary` segment (position = placeLocation)
 *   - `activity`     → one `moving` segment (position = start; no distance)
 *   - `timelinePath` → one `moving` segment per point (position = point)
 * `timelineMemory` and anything unrecognized are ignored.
 *
 * Timezone handling — the tricky part. visit/activity timestamps carry a local
 * offset (`+02:00`) so their wall-clock comes straight from that offset. But
 * every timelinePath entry is in UTC (`Z`) with no local offset, so its points
 * would land in UTC if taken literally. We instead carry forward the most
 * recent local offset seen on a neighbouring offset-bearing entry (entries are
 * processed in chronological order) and apply it to the UTC points.
 *
 * @throws {Error} if jsonData is null, undefined, or not an array.
 */
export function parseTimelineData(jsonData: RawTimelineEntry[]): LocationSegment[] {
    if (jsonData === null || jsonData === undefined) {
        throw new Error('parseTimelineData: input cannot be null or undefined');
    }
    if (!Array.isArray(jsonData)) {
        throw new Error('parseTimelineData: input must be an array');
    }

    // Build chronological records. Every entry with a valid startTime feeds the
    // offset chain, even timelineMemory, so the carried offset stays accurate.
    const records: EntryRecord[] = [];
    for (const entry of jsonData) {
        const e = entry as { startTime?: string; endTime?: string };
        if (typeof e.startTime !== 'string') continue;
        const startMs = new Date(e.startTime).getTime();
        if (!Number.isFinite(startMs)) continue;
        const endMs = typeof e.endTime === 'string' ? new Date(e.endTime).getTime() : startMs;
        records.push({
            startMs,
            endMs: Number.isFinite(endMs) ? endMs : startMs,
            offsetMinutes: parseOffsetMinutes(e.startTime),
            entry,
        });
    }
    records.sort((a, b) => a.startMs - b.startMs);

    // Seed the carried offset with the first explicit offset in the timeline so
    // leading UTC-only entries (if any) still get a sensible local time.
    let lastOffset = records.find((r) => r.offsetMinutes !== null)?.offsetMinutes ?? 0;

    const segments: LocationSegment[] = [];

    for (const { startMs, endMs, offsetMinutes, entry } of records) {
        if (offsetMinutes !== null) lastOffset = offsetMinutes;
        const eff = offsetMinutes ?? lastOffset;

        if ('visit' in entry) {
            const tc = (entry as RawVisitEntry).visit?.topCandidate;
            const loc = parseGeo(tc?.placeLocation);
            if (!loc) continue;
            const timestamp = wallClock(startMs, eff);
            segments.push({
                source: 'google-timeline',
                timestamp,
                date: timestamp.slice(0, 10),
                endTimestamp: wallClock(endMs, eff),
                durationSeconds: durationSeconds(startMs, endMs),
                lat: loc.lat,
                lon: loc.lon,
                segmentType: 'stationary',
                activityType: null,
                semanticType: tc?.semanticType ?? null,
                placeId: tc?.placeID ?? null,
                distanceMeters: null,
                speedKmh: null,
                azimuthDegrees: null,
                ...NO_SENSORS,
            });
        } else if ('activity' in entry) {
            const activity = (entry as RawActivityEntry).activity;
            const loc = parseGeo(activity?.start);
            if (!loc) continue;
            const endLoc = parseGeo(activity?.end);
            const routed =
                activity?.distanceMeters != null ? parseFloat(activity.distanceMeters) : NaN;
            const dur = durationSeconds(startMs, endMs);
            const timestamp = wallClock(startMs, eff);
            segments.push({
                source: 'google-timeline',
                timestamp,
                date: timestamp.slice(0, 10),
                endTimestamp: wallClock(endMs, eff),
                durationSeconds: dur,
                lat: loc.lat,
                lon: loc.lon,
                segmentType: 'moving',
                activityType: activity?.topCandidate?.type ?? null,
                semanticType: null,
                placeId: null,
                // Distance is derived from the raw GPS path only; the routed
                // activity distance (semantic layer) is intentionally dropped.
                distanceMeters: null,
                // Speed still uses the routed distance (a real travelled length,
                // unlike the straight-line start→end), so it isn't double-counted
                // as distance. Azimuth is the straight start→end heading.
                speedKmh: Number.isFinite(routed) ? speedKmh(routed, dur) : null,
                azimuthDegrees: endLoc ? bearingDegrees(loc, endLoc) : null,
                ...NO_SENSORS,
            });
        } else if ('timelinePath' in entry) {
            const path = (entry as RawTimelinePathEntry).timelinePath ?? [];
            const points = path
                .map((p) => ({
                    offsetMin: parseInt(p.durationMinutesOffsetFromStartTime ?? '', 10),
                    geo: parseGeo(p.point),
                }))
                .filter((p) => Number.isFinite(p.offsetMin) && p.geo !== null)
                .sort((a, b) => a.offsetMin - b.offsetMin);

            for (let i = 0; i < points.length; i++) {
                const cur = points[i];
                const next = points[i + 1];
                const pointMs = startMs + cur.offsetMin * 60_000;
                const nextMs = next ? startMs + next.offsetMin * 60_000 : endMs;
                const legDur = durationSeconds(pointMs, nextMs);
                // Distance is the raw path leg to the next point (the last point
                // has none). The path is the single distance source, so there is
                // nothing to double-count. Speed/azimuth derive from the same leg.
                const legMeters = next ? haversineMeters(cur.geo!, next.geo!) : null;
                const timestamp = wallClock(pointMs, eff);
                segments.push({
                    source: 'google-timeline',
                    timestamp,
                    date: timestamp.slice(0, 10),
                    endTimestamp: wallClock(Math.max(pointMs, nextMs), eff),
                    durationSeconds: legDur,
                    lat: cur.geo!.lat,
                    lon: cur.geo!.lon,
                    segmentType: 'moving',
                    activityType: null,
                    semanticType: null,
                    placeId: null,
                    distanceMeters: legMeters,
                    // The terminal point (no next point → end of the movement,
                    // just before a stop/gap) is a standstill: speed 0, no heading.
                    speedKmh: legMeters !== null ? speedKmh(legMeters, legDur) : 0,
                    azimuthDegrees: next ? bearingDegrees(cur.geo!, next.geo!) : null,
                    ...NO_SENSORS,
                });
            }
        }
        // timelineMemory and unknown entries: ignored (already counted for offset).
    }

    return segments;
}
