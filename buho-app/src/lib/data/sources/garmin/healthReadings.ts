import type { DecodedFit, FitMesg } from '#lib/data/formats/fit/decode.ts';
import {
    fitSecondsToMs,
    localOffsetMinutes,
    makeTimestamp16Resolver,
} from '#lib/data/formats/fit/units.ts';
import type { HealthMetric, HealthReading } from '#lib/types/health.ts';
import { wallClock, wallClockDate } from '#lib/utils/wallClock.ts';

/**
 * The health signals hiding in the monitoring files.
 *
 * These arrive in the very same files as the step counters, and Buho already
 * decodes every one of them to get at the steps — heart rate is read off the
 * same messages the step loop walks past. Collecting them is a copy, not a
 * second pass over the export.
 *
 * Unlike the counters, none of this is cumulative: each message is a reading
 * that stands on its own, so there is nothing to difference. What it does need
 * is the same two corrections the counters need — compressed timestamps, and
 * the watch's own UTC offset.
 */

/**
 * Garmin writes "no reading" as a small negative number, or as zero for a
 * heart rate. Kept out here rather than filtered at query time: a sentinel that
 * reaches a colour scale flattens every real value against one end of it.
 */
function isSentinel(metric: HealthMetric, value: number): boolean {
    if (!Number.isFinite(value)) return true;
    if (metric === 'heart_rate') return value <= 0;
    return value < 0;
}

const num = (value: unknown): number | null =>
    typeof value === 'number' && Number.isFinite(value) ? value : null;

/** Unix ms for a message field the SDK already resolved into a Date. */
function dateMs(value: unknown): number | null {
    if (value instanceof Date) {
        const ms = value.getTime();
        return Number.isFinite(ms) ? ms : null;
    }
    return null;
}

/** Every health reading one decoded monitoring file holds. */
export function collectHealthReadings(decoded: DecodedFit): HealthReading[] {
    // Absent a monitoring_info message there is nothing to place the file in a
    // timezone, so readings are taken at face value (UTC) — same fallback the
    // step counters use.
    const offsetMinutes = localOffsetMinutes(decoded.monitoringInfoMesgs[0] as never) ?? 0;
    const out: HealthReading[] = [];

    const push = (metric: HealthMetric, ms: number | null, value: number | null) => {
        if (ms == null || value == null || isSentinel(metric, value)) return;
        out.push({
            timestamp: wallClock(ms, offsetMinutes),
            date: wallClockDate(ms, offsetMinutes),
            metric,
            value,
        });
    };

    // Heart rate rides on the monitoring messages themselves, which are mostly
    // compressed timestamps — hence the resolver, fed every message in file
    // order whether or not it carries a reading.
    const resolveSeconds = makeTimestamp16Resolver();
    for (const mesg of decoded.monitoringMesgs) {
        const fitSeconds = resolveSeconds(mesg as never);
        const heartRate = num(mesg.heartRate);
        if (fitSeconds == null || heartRate == null) continue;
        push('heart_rate', fitSecondsToMs(fitSeconds), heartRate);
    }

    // The other three carry a full timestamp of their own, so they need no
    // resolver — only the same offset, to land on the right local hour.
    for (const mesg of decoded.stressLevelMesgs as FitMesg[]) {
        push('stress', dateMs(mesg.stressLevelTime), num(mesg.stressLevelValue));
    }

    for (const mesg of decoded.respirationRateMesgs as FitMesg[]) {
        push('respiration', dateMs(mesg.timestamp), num(mesg.respirationRate));
    }

    return out;
}

/**
 * Every reading a set of monitoring files yielded, deduplicated on the instant.
 *
 * An export writes roughly three files per day with overlapping windows, so the
 * same reading arrives several times over — the same reason the step counters
 * are deduplicated before being differenced.
 */
export function healthReadingsFromFiles(files: DecodedFit[]): HealthReading[] {
    const seen = new Map<string, HealthReading>();

    for (const file of files) {
        for (const reading of collectHealthReadings(file)) {
            seen.set(`${reading.metric}\u0000${reading.timestamp}`, reading);
        }
    }

    return [...seen.values()];
}
