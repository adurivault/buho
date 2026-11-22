import type { DecodedFit } from '#lib/data/formats/fit/decode.ts';
import {
    fitSecondsToMs,
    localOffsetMinutes,
    makeTimestamp16Resolver,
} from '#lib/data/formats/fit/units.ts';
import type { StepPacket } from '#lib/types/steps.ts';
import { STEP_ACTIVITY_TYPES, type StepSample } from './types';
import { wallClock, wallClockDate } from '#lib/utils/wallClock.ts';

const DAY_SECONDS = 86_400;

/**
 * Move a day's closing reading back inside the day it closes.
 *
 * The profile requires the daily summary message to be stamped at 00:00:00, so
 * a watch writes the totals for a day at the instant the *next* one begins.
 * Taken literally, every day therefore opens with the previous day's finished
 * counter and closes with its own — which doubles every step count in the
 * export. One second earlier puts the reading back where it belongs.
 */
function closingReadingsBelongToTheDayTheyClose(sample: StepSample): StepSample {
    const localSeconds = sample.fitSeconds + sample.offsetMinutes * 60;
    if (localSeconds % DAY_SECONDS !== 0) return sample;
    return { ...sample, fitSeconds: sample.fitSeconds - 1 };
}

const num = (value: unknown): number | null =>
    typeof value === 'number' && Number.isFinite(value) ? value : null;

/**
 * Read one monitoring file's counter readings.
 *
 * Two things the SDK leaves undone have to happen here:
 *
 * - **Timestamps.** Most messages carry only `timestamp16`, so they are resolved
 *   against the last full timestamp seen (see `makeTimestamp16Resolver`). This
 *   is why messages must be walked in file order.
 * - **Steps.** The profile exposes `steps` as a sub-field of `cycles`, but the
 *   SDK only expands it on messages that also carry a full timestamp — 2 of 143
 *   in a real daily file. `cycles × 2` is the same conversion, applied to all of
 *   them; it matches the SDK's own value wherever both exist.
 */
export function collectStepSamples(decoded: DecodedFit): StepSample[] {
    // Absent a monitoring_info message there is nothing to place the day in a
    // timezone, so the readings are taken at face value (UTC). Every file in a
    // real export carries one.
    const offsetMinutes = localOffsetMinutes(decoded.monitoringInfoMesgs[0] as never) ?? 0;

    const resolveSeconds = makeTimestamp16Resolver();
    const samples: StepSample[] = [];

    for (const mesg of decoded.monitoringMesgs) {
        // Called for every message, not just the ones kept: the resolver is a
        // running counter and skipping messages would desynchronise it.
        const fitSeconds = resolveSeconds(mesg as never);

        const cycles = num(mesg.cycles);
        const activityType = typeof mesg.activityType === 'string' ? mesg.activityType : null;
        if (fitSeconds == null || cycles == null || !activityType) continue;
        if (!STEP_ACTIVITY_TYPES.has(activityType)) continue;

        samples.push({
            fitSeconds,
            offsetMinutes,
            activityType,
            cycles,
            activeTime: num(mesg.activeTime) ?? 0,
            distance: num(mesg.distance) ?? 0,
            calories: num(mesg.activeCalories) ?? 0,
            intensity: num(mesg.intensity),
        });
    }

    return samples;
}

/** The instant the sample's local day began, in FIT seconds. */
function localMidnightSeconds(sample: StepSample): number {
    const offsetSeconds = sample.offsetMinutes * 60;
    const localSeconds = sample.fitSeconds + offsetSeconds;
    return Math.floor(localSeconds / DAY_SECONDS) * DAY_SECONDS - offsetSeconds;
}

/** How much each counter advanced between two readings. */
interface CounterDelta {
    cycles: number;
    activeTime: number;
    distance: number;
    calories: number;
}

function since(sample: StepSample, previous: StepSample | null): CounterDelta {
    return {
        cycles: sample.cycles - (previous?.cycles ?? 0),
        activeTime: sample.activeTime - (previous?.activeTime ?? 0),
        distance: sample.distance - (previous?.distance ?? 0),
        calories: sample.calories - (previous?.calories ?? 0),
    };
}

/**
 * Turn cumulative counter readings into step packets.
 *
 * The counters run from local midnight and reset per activity type, so a series
 * is one (local day, activity type) pair and a packet is the difference between
 * two consecutive readings in it. The day's first reading is differenced against
 * midnight, since that is what it accumulated from.
 *
 * Readings are deduplicated on their instant first: a Garmin export writes
 * roughly three monitoring files per day with overlapping windows, so the same
 * reading arrives several times over. Where two disagree the higher counter
 * wins — a counter only climbs within a day, so the lower one is a snapshot
 * taken mid-write.
 */
export function buildStepPackets(samples: StepSample[]): StepPacket[] {
    const series = new Map<string, Map<number, StepSample>>();

    for (const raw of samples) {
        const sample = closingReadingsBelongToTheDayTheyClose(raw);
        const date = wallClockDate(fitSecondsToMs(sample.fitSeconds), sample.offsetMinutes);
        const key = `${date} ${sample.activityType}`;

        let readings = series.get(key);
        if (!readings) series.set(key, (readings = new Map()));

        const seen = readings.get(sample.fitSeconds);
        if (!seen || sample.cycles > seen.cycles) readings.set(sample.fitSeconds, sample);
    }

    // Keyed by the instant the window closes, so the walking and running
    // counters — differenced apart, since only their own history means anything
    // — land back on one packet whenever they were written together.
    const merged = new Map<number, Merged>();

    for (const readings of series.values()) {
        const ordered = [...readings.values()].sort((a, b) => a.fitSeconds - b.fitSeconds);
        let previous: StepSample | null = null;

        for (const sample of ordered) {
            const startSeconds = previous?.fitSeconds ?? localMidnightSeconds(sample);

            // A counter that went backwards means the previous reading belonged
            // to a different baseline — a firmware quirk, or a day boundary the
            // watch drew elsewhere. Take the reading at face value rather than
            // emitting a negative packet.
            const advanced = since(sample, previous);
            const d = advanced.cycles < 0 ? since(sample, null) : advanced;

            previous = sample;
            const steps = Math.round(d.cycles * 2);
            if (steps <= 0) continue;

            const activeSeconds = Math.max(0, d.activeTime);
            const running = sample.activityType === 'running';

            add(merged, {
                fitSeconds: sample.fitSeconds,
                startSeconds,
                offsetMinutes: sample.offsetMinutes,
                steps,
                activeSeconds,
                distanceMeters: Math.max(0, d.distance),
                calories: Math.max(0, d.calories),
                intensity: sample.intensity,
                // Which counter this series came off, kept as a share of the
                // totals so the merge below can stay a plain sum.
                runningSteps: running ? steps : 0,
                runningActiveSeconds: running ? activeSeconds : 0,
            });
        }
    }

    const packets = [...merged.values()]
        .sort((a, b) => a.fitSeconds - b.fitSeconds)
        .map((m) => {
            const endMs = fitSecondsToMs(m.fitSeconds);
            return {
                timestamp: wallClock(endMs, m.offsetMinutes),
                date: wallClockDate(endMs, m.offsetMinutes),
                startTimestamp: wallClock(fitSecondsToMs(m.startSeconds), m.offsetMinutes),
                steps: m.steps,
                activeSeconds: m.activeSeconds,
                spanSeconds: Math.max(0, m.fitSeconds - m.startSeconds),
                distanceMeters: m.distanceMeters,
                calories: m.calories,
                // Recomputed after the fold rather than averaged: a window that
                // held a walk and a run has one pace, over all of its movement.
                cadenceSpm: m.activeSeconds > 0 ? (m.steps / m.activeSeconds) * 60 : null,
                intensity: m.intensity,
                runningSteps: m.runningSteps,
                runningActiveSeconds: m.runningActiveSeconds,
            } satisfies StepPacket;
        });

    return packets;
}

/** A packet still being folded together, before it is rendered as wall-clock. */
interface Merged {
    fitSeconds: number;
    startSeconds: number;
    offsetMinutes: number;
    steps: number;
    activeSeconds: number;
    distanceMeters: number;
    calories: number;
    intensity: number | null;
    /** The share of the totals that came off the running counter. */
    runningSteps: number;
    runningActiveSeconds: number;
}

function add(into: Map<number, Merged>, part: Merged): void {
    const seen = into.get(part.fitSeconds);
    if (!seen) {
        into.set(part.fitSeconds, part);
        return;
    }
    seen.steps += part.steps;
    seen.activeSeconds += part.activeSeconds;
    seen.distanceMeters += part.distanceMeters;
    seen.calories += part.calories;
    seen.runningSteps += part.runningSteps;
    seen.runningActiveSeconds += part.runningActiveSeconds;
    // The widest window the parts covered, so `startTimestamp` and `spanSeconds`
    // keep describing the same stretch of time.
    seen.startSeconds = Math.min(seen.startSeconds, part.startSeconds);
    // The harder of the two, and -1 only survives if neither reported one — an
    // intensity of 0 is a real reading, not a missing one.
    const hardest = Math.max(seen.intensity ?? -1, part.intensity ?? -1);
    seen.intensity = hardest < 0 ? null : hardest;
}

/** Every packet a set of monitoring files yielded. */
export function stepPacketsFromFiles(files: DecodedFit[]): StepPacket[] {
    const samples: StepSample[] = [];
    for (const file of files) {
        for (const sample of collectStepSamples(file)) samples.push(sample);
    }
    return buildStepPackets(samples);
}
