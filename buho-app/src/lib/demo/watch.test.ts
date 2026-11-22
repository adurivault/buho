import { describe, expect, it } from 'vitest';
import { generateWatchFiles } from './watch';
import { lifeDays } from './life';
import { stepPacketsFromFiles } from '#lib/data/sources/garmin/stepPackets.ts';
import { healthReadingsFromFiles } from '#lib/data/sources/garmin/healthReadings.ts';
import { moduleById } from '#lib/data/modules.ts';

/**
 * The watch sample, read through the same builders as a Garmin export.
 *
 * These assert the shape the steps and health explorers look for — a daily
 * rhythm, days that differ by kind, a heart that answers the running — with
 * thresholds well clear of what uniform noise would produce.
 */

const UNTIL = new Date('2026-06-30');
const files = generateWatchFiles({ until: UNTIL, months: 12 });
const packets = stepPacketsFromFiles(files);
const readings = healthReadingsFromFiles(files);
const days = new Map(lifeDays({ until: UNTIL }).map((day) => [day.date, day]));

const stepsPerDay = new Map<string, number>();
for (const packet of packets) {
    stepsPerDay.set(packet.date, (stepsPerDay.get(packet.date) ?? 0) + packet.steps);
}

const median = (values: number[]) => {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)] ?? 0;
};
const stepsOn = (kind: string) =>
    median([...stepsPerDay].filter(([date]) => days.get(date)?.kind === kind).map(([, s]) => s));

describe('the watch sample goes through the Garmin builders', () => {
    it('yields step packets and all three health metrics', () => {
        expect(packets.length).toBeGreaterThan(5_000);
        const metrics = new Set(readings.map((r) => r.metric));
        expect(metrics).toEqual(new Set(['heart_rate', 'stress', 'respiration']));
    });

    it('covers the months asked for, a day per file', () => {
        expect(files.length).toBeGreaterThan(360);
        expect(files.length).toBeLessThan(370);
        expect(stepsPerDay.size).toBeGreaterThan(350);
    });

    it('leaves the sentinels behind, as for a real export', () => {
        expect(readings.every((r) => r.value >= 0)).toBe(true);
    });

    it('declares the modules it fills', () => {
        expect(moduleById('steps').hasDemo).toBe(true);
        expect(moduleById('health').hasDemo).toBe(true);
    });
});

describe('the days differ the way a life does', () => {
    it('walks a believable amount on a workday', () => {
        expect(stepsOn('work')).toBeGreaterThan(5_000);
        expect(stepsOn('work')).toBeLessThan(14_000);
    });

    it('walks further on holiday, and hardly at all when ill', () => {
        expect(stepsOn('holiday')).toBeGreaterThan(stepsOn('work') * 1.3);
        expect(stepsOn('sick')).toBeLessThan(stepsOn('work') * 0.5);
    });

    it('counts the runs on the running counter', () => {
        const running = packets.filter((p) => p.runningSteps > 0);
        expect(running.length).toBeGreaterThan(50);
        for (const packet of running) expect(days.get(packet.date)?.run).toBe(true);
    });

    it('moves at night only by exception', () => {
        const night = packets.filter((p) => {
            const hour = Number(p.timestamp.slice(11, 13));
            return hour >= 2 && hour < 5;
        });
        expect(night.length).toBeLessThan(packets.length * 0.01);
    });
});

describe('the heart answers the day', () => {
    const heart = readings.filter((r) => r.metric === 'heart_rate');
    const nightHeart = (keep: (date: string) => boolean) =>
        median(
            heart
                .filter((r) => {
                    const hour = Number(r.timestamp.slice(11, 13));
                    return hour >= 2 && hour < 5 && keep(r.date);
                })
                .map((r) => r.value)
        );

    it('stays within what a wrist reads', () => {
        expect(Math.min(...heart.map((r) => r.value))).toBeGreaterThan(35);
        expect(Math.max(...heart.map((r) => r.value))).toBeLessThan(200);
    });

    it('climbs during a run', () => {
        const runMinutes = new Set(
            packets.filter((p) => p.runningSteps > 0).map((p) => p.timestamp.slice(0, 13))
        );
        const duringRuns = heart.filter((r) => runMinutes.has(r.timestamp.slice(0, 13)));
        expect(median(duringRuns.map((r) => r.value))).toBeGreaterThan(120);
    });

    it('rests lower once the running habit has built up', () => {
        const dates = [...stepsPerDay.keys()].sort();
        const before = new Set(dates.slice(0, 50));
        const after = new Set(dates.slice(-50));
        expect(nightHeart((date) => after.has(date))).toBeLessThan(
            nightHeart((date) => before.has(date)) - 3
        );
    });

    it('rests higher with a cold', () => {
        const sick = nightHeart((date) => days.get(date)?.kind === 'sick');
        const well = nightHeart((date) => days.get(date)?.kind === 'work');
        expect(sick).toBeGreaterThan(well + 3);
    });
});

describe('the same life gives the same watch', () => {
    it('is deterministic for a given end day', () => {
        const again = stepPacketsFromFiles(generateWatchFiles({ until: UNTIL, months: 12 }));
        expect(again.length).toBe(packets.length);
        expect(again[100]).toEqual(packets[100]);
    });
});
