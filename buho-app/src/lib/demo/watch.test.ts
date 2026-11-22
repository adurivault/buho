import { describe, expect, it } from 'vitest';
import { generateWatchFiles } from './watch';
import { buildAgenda } from './agenda';
import { stepPacketsFromFiles } from '#lib/data/sources/garmin/stepPackets.ts';
import { healthReadingsFromFiles } from '#lib/data/sources/garmin/healthReadings.ts';
import { moduleById } from '#lib/data/modules.ts';

/**
 * The watch sample, read through the same builders as a Garmin export.
 *
 * These assert the shape the steps and health explorers look for — days that
 * differ by what they held, a heart that answers the running — with
 * thresholds well clear of what uniform noise would produce.
 */

const UNTIL = new Date('2026-06-30');
const agenda = buildAgenda({ until: UNTIL });
const files = generateWatchFiles({ until: UNTIL, months: 12, agenda });
const packets = stepPacketsFromFiles(files);
const readings = healthReadingsFromFiles(files);
const days = new Map(agenda.days.map((day) => [day.date, day]));

const stepsPerDay = new Map<string, number>();
for (const packet of packets) {
    stepsPerDay.set(packet.date, (stepsPerDay.get(packet.date) ?? 0) + packet.steps);
}

const median = (values: number[]) => {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)] ?? 0;
};
const stepsWhere = (keep: (date: string) => boolean) =>
    median([...stepsPerDay].filter(([date]) => keep(date)).map(([, steps]) => steps));
const stepsOn = (kind: string) => stepsWhere((date) => days.get(date)?.kind === kind);

describe('the watch sample goes through the Garmin builders', () => {
    it('yields step packets and all three health metrics', () => {
        expect(packets.length).toBeGreaterThan(5_000);
        const metrics = new Set(readings.map((r) => r.metric));
        expect(metrics).toEqual(new Set(['heart_rate', 'stress', 'respiration']));
    });

    it('leaves the sentinels behind, as for a real export', () => {
        expect(readings.every((r) => r.value >= 0)).toBe(true);
    });

    it('has a gap where the watch was lost', () => {
        const dates = files.map((f) => (f.monitoringInfoMesgs[0].timestamp as Date).getTime());
        let longest = 0;
        for (let i = 1; i < dates.length; i += 1) {
            longest = Math.max(longest, (dates[i] - dates[i - 1]) / 86_400_000);
        }
        expect(longest).toBeGreaterThan(14);
    });

    it('declares the modules it fills', () => {
        expect(moduleById('steps').hasDemo).toBe(true);
        expect(moduleById('health').hasDemo).toBe(true);
    });
});

describe('the days differ by what they held', () => {
    it('walks a believable amount on an office day', () => {
        expect(stepsOn('work')).toBeGreaterThan(3_500);
        expect(stepsOn('work')).toBeLessThan(12_000);
    });

    it('walks less at home and when ill, more on holiday and far more on a hike', () => {
        expect(stepsOn('remote')).toBeLessThan(stepsOn('work'));
        expect(stepsOn('sick')).toBeLessThan(stepsOn('work') * 0.7);
        expect(stepsOn('holiday')).toBeGreaterThan(stepsOn('work') * 1.5);
        expect(stepsWhere((date) => days.get(date)!.outings.includes('hike'))).toBeGreaterThan(
            15_000
        );
    });

    it('counts the runs on the running counter, on run days only', () => {
        const running = packets.filter((p) => p.runningSteps > 0);
        expect(running.length).toBeGreaterThan(50);
        for (const packet of running) expect(days.get(packet.date)?.run).not.toBe('none');
    });

    it('moves at night only after a night out', () => {
        const night = packets.filter((p) => {
            const hour = Number(p.timestamp.slice(11, 13));
            return hour >= 3 && hour < 5;
        });
        expect(night.length).toBeLessThan(packets.length * 0.02);
    });
});

describe('the heart answers the day', () => {
    const heart = readings.filter((r) => r.metric === 'heart_rate');
    const nightHeart = (keep: (date: string) => boolean) =>
        median(
            heart
                .filter((r) => {
                    const hour = Number(r.timestamp.slice(11, 13));
                    return hour >= 3 && hour < 5 && keep(r.date);
                })
                .map((r) => r.value)
        );

    it('stays within what a wrist reads', () => {
        const values = heart.map((r) => r.value);
        expect(values.reduce((a, b) => Math.min(a, b))).toBeGreaterThan(35);
        expect(values.reduce((a, b) => Math.max(a, b))).toBeLessThan(200);
    });

    it('climbs during a run', () => {
        // The heart lags, so only the second half of each running window counts.
        const windows = packets
            .filter((p) => p.runningSteps > 0 && p.runningSteps === p.steps)
            .map((p) => [p.timestamp.slice(0, 11) + p.timestamp.slice(11, 13), p] as const);
        const byHour = new Map(windows);
        const duringRuns = heart.filter((r) => {
            const packet = byHour.get(r.timestamp.slice(0, 13));
            return packet && r.timestamp > packet.startTimestamp && r.timestamp <= packet.timestamp;
        });
        expect(duringRuns.length).toBeGreaterThan(100);
        expect(median(duringRuns.map((r) => r.value))).toBeGreaterThan(130);
    });

    it('rests lower once the running habit has built up', () => {
        const dates = [...stepsPerDay.keys()].sort();
        const before = new Set(dates.slice(0, 40));
        const after = new Set(dates.slice(-40));
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
