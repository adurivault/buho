import type { GaitMetric, GaitReading, StepPacket } from '#lib/types/steps.ts';
import { wallClock, wallClockDate } from '#lib/utils/wallClock.ts';
import { buildZoneTimeline, offsetMinutesAt, type ZoneMarker } from './timeZones';

/**
 * Reading `export.xml`, Apple Health's one file holding everything.
 *
 * It is large — hundreds of megabytes for a few years of a phone — and too
 * large to hold as one string, let alone as a DOM. It is also regular: Apple
 * writes one element per line, every record's attributes on its opening line.
 * So it is read as lines, and only the few record types Buho keeps are looked
 * at closely; the million others are skipped on their first characters.
 */

/** The devices whose own measurements are kept. */
export type AppleDevice = 'iPhone' | 'Watch';

/**
 * A record as the export states it, before its time is resolved.
 *
 * Only Apple's own devices are read. Every app with Health access writes its
 * copy of what it recorded into the same file — Garmin Connect its heart rate,
 * Strava its runs — under no device at all. Those copies are the other exports'
 * business: read here they would land a second time under the wrong name, and
 * Buho reads the originals from those services directly.
 */
interface RawRecord {
    type: string;
    device: AppleDevice;
    start: string;
    end: string;
    unit: string;
    value: number;
}

const STEPS = 'HKQuantityTypeIdentifierStepCount';
const DISTANCE = 'HKQuantityTypeIdentifierDistanceWalkingRunning';

const METERS_PER: Record<string, number> = {
    m: 1,
    km: 1000,
    cm: 0.01,
    mm: 0.001,
    mi: 1609.344,
    yd: 0.9144,
    ft: 0.3048,
    in: 0.0254,
};
const KMH_PER: Record<string, number> = { 'km/hr': 1, 'm/s': 3.6, 'mi/hr': 1.609344 };

const meters = (value: number, unit: string) =>
    unit in METERS_PER ? value * METERS_PER[unit] : null;

/**
 * The gait readings a phone takes while you walk with it, and how each is
 * brought to the unit Buho shows it in. The export writes them in the
 * owner's preferred units — miles and inches on an American phone — and its
 * percentages as fractions.
 *
 * Walking steadiness is left out: it is one weekly verdict, not a reading.
 */
const GAIT: Record<
    string,
    { metric: GaitMetric; convert: (v: number, unit: string) => number | null }
> = {
    HKQuantityTypeIdentifierWalkingSpeed: {
        metric: 'walking_speed',
        convert: (v, unit) => (unit in KMH_PER ? v * KMH_PER[unit] : null),
    },
    HKQuantityTypeIdentifierWalkingStepLength: {
        metric: 'step_length',
        convert: (v, unit) => {
            const m = meters(v, unit);
            return m == null ? null : m * 100;
        },
    },
    HKQuantityTypeIdentifierWalkingDoubleSupportPercentage: {
        metric: 'double_support',
        convert: (v, unit) => (unit === '%' ? v * 100 : null),
    },
    HKQuantityTypeIdentifierWalkingAsymmetryPercentage: {
        metric: 'walking_asymmetry',
        convert: (v, unit) => (unit === '%' ? v * 100 : null),
    },
};

/** The value of `name` on an opening tag, or null. */
function attr(line: string, name: string): string | null {
    const key = ` ${name}="`;
    const at = line.indexOf(key);
    if (at < 0) return null;
    const from = at + key.length;
    const to = line.indexOf('"', from);
    return to < 0 ? null : line.slice(from, to);
}

function deviceOf(line: string): AppleDevice | null {
    const device = attr(line, 'device');
    if (!device) return null;
    if (device.includes('model:iPhone')) return 'iPhone';
    if (device.includes('model:Watch')) return 'Watch';
    return null;
}

/** "2024-01-15 20:23:25 +0200" as epoch ms, or NaN. */
export function parseAppleDate(text: string): number {
    const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2}) ([+-])(\d{2})(\d{2})$/.exec(text);
    if (!m) return NaN;
    const offset = (m[7] === '-' ? -1 : 1) * (Number(m[8]) * 60 + Number(m[9]));
    return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) - offset * 60_000;
}

/** What one pass over the file collects. */
export interface ScannedExport {
    steps: RawRecord[];
    /** Distance by the window it was counted over, in meters. */
    distances: Map<string, number>;
    gait: RawRecord[];
    markers: ZoneMarker[];
}

const windowKey = (r: Pick<RawRecord, 'device' | 'start' | 'end'>) =>
    `${r.device}|${r.start}|${r.end}`;

/** Feed it the file line by line, then read what it kept. */
export function createScanner() {
    const scan: ScannedExport = {
        steps: [],
        distances: new Map(),
        gait: [],
        markers: [],
    };
    // The opening tag metadata lines belong to, kept unparsed: only the few
    // followed by a time zone are ever read.
    let parent = '';

    function record(line: string, at: number) {
        parent = line;
        if (!line.startsWith('<Record type="HKQuantityTypeIdentifier', at)) return;
        const type = attr(line, 'type') ?? '';
        if (type !== STEPS && type !== DISTANCE && !(type in GAIT)) return;
        const device = deviceOf(line);
        const start = attr(line, 'startDate');
        const end = attr(line, 'endDate');
        const value = Number(attr(line, 'value'));
        if (!device || !start || !end || !Number.isFinite(value)) return;
        const raw: RawRecord = { type, device, start, end, unit: attr(line, 'unit') ?? '', value };

        if (type === STEPS) scan.steps.push(raw);
        else if (type === DISTANCE) {
            const m = meters(value, raw.unit);
            if (m != null) scan.distances.set(windowKey(raw), m);
        } else scan.gait.push(raw);
    }

    return {
        line(line: string) {
            const at = line.indexOf('<');
            if (at < 0) return;
            if (line.startsWith('<Record ', at)) record(line, at);
            else if (line.startsWith('<Workout ', at)) parent = line;
            else if (line.startsWith('<MetadataEntry key="HKTimeZone"', at)) {
                const zone = attr(line, 'value');
                const ms = parseAppleDate(attr(parent, 'startDate') ?? '');
                if (zone && Number.isFinite(ms)) scan.markers.push({ ms, zone });
            }
        },
        result: (): ScannedExport => scan,
    };
}

/** Bytes per decoded slice: small enough to never hold the file as a string. */
const CHUNK_BYTES = 8 * 1024 * 1024;

const yieldToBrowser = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Call `onLine` for every line of a UTF-8 file, a slice at a time. */
export async function forEachLine(
    bytes: Uint8Array,
    onLine: (line: string) => void,
    chunkBytes = CHUNK_BYTES
) {
    const decoder = new TextDecoder('utf-8');
    let carry = '';
    for (let offset = 0; offset < bytes.length; offset += chunkBytes) {
        const last = offset + chunkBytes >= bytes.length;
        const text =
            carry +
            decoder.decode(bytes.subarray(offset, offset + chunkBytes), {
                stream: !last,
            });
        let from = 0;
        for (let nl = text.indexOf('\n'); nl >= 0; nl = text.indexOf('\n', from)) {
            onLine(text.slice(from, nl));
            from = nl + 1;
        }
        carry = text.slice(from);
        // Hundreds of megabytes is seconds of work: let the progress bar paint.
        if (!last) await yieldToBrowser();
    }
    if (carry) onLine(carry);
}

/** One instant as wall-clock in a zone. */
function local(ms: number, zone: string) {
    const offset = offsetMinutesAt(zone, ms);
    return { timestamp: wallClock(ms, offset), date: wallClockDate(ms, offset) };
}

/**
 * Within one export, an iPhone and an Apple Watch both count the same walk. The
 * steps view's rule, applied here because both devices write under one source:
 * every hour the watch recorded is the watch's, and the phone fills the rest.
 */
function preferWatch(packets: { packet: StepPacket; device: AppleDevice }[]): StepPacket[] {
    const watchHours = new Set<string>();
    for (const { packet, device } of packets) {
        if (device !== 'Watch') continue;
        watchHours.add(packet.startTimestamp.slice(0, 13));
        watchHours.add(packet.timestamp.slice(0, 13));
    }
    return packets
        .filter((p) => p.device === 'Watch' || !watchHours.has(p.packet.timestamp.slice(0, 13)))
        .map((p) => p.packet);
}

/**
 * Turn what the scan kept into rows, every time resolved against the zone the
 * phone was most likely in (see `timeZones.ts`).
 *
 * @param fallbackZone the zone to read records in when the export names none.
 */
export function rowsFromScan(
    scan: ScannedExport,
    fallbackZone: string
): { steps: StepPacket[]; gait: GaitReading[] } {
    const timeline = buildZoneTimeline(scan.markers, fallbackZone);

    const packets: { packet: StepPacket; device: AppleDevice }[] = [];
    for (const raw of scan.steps) {
        const startMs = parseAppleDate(raw.start);
        const endMs = parseAppleDate(raw.end);
        const steps = Math.round(raw.value);
        if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || steps <= 0) continue;
        // Both ends in the zone of the end, so the window keeps its length.
        const zone = timeline.zoneAt(endMs);
        const end = local(endMs, zone);
        packets.push({
            device: raw.device,
            packet: {
                source: 'apple-health',
                timestamp: end.timestamp,
                date: end.date,
                startTimestamp: local(startMs, zone).timestamp,
                steps,
                activeSeconds: null,
                spanSeconds: Math.max(0, (endMs - startMs) / 1000),
                distanceMeters: scan.distances.get(windowKey(raw)) ?? null,
                calories: null,
                cadenceSpm: null,
                intensity: null,
                runningSteps: null,
                runningActiveSeconds: null,
                worn: null,
            },
        });
    }

    const gait: GaitReading[] = [];
    for (const raw of scan.gait) {
        const spec = GAIT[raw.type];
        const ms = parseAppleDate(raw.start);
        const value = spec.convert(raw.value, raw.unit);
        if (!Number.isFinite(ms) || value == null) continue;
        const at = local(ms, timeline.zoneAt(ms));
        gait.push({ source: 'apple-health', ...at, metric: spec.metric, value });
    }

    const steps = preferWatch(packets).sort((a, b) =>
        a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0
    );
    return { steps, gait };
}
