import { describe, expect, it } from 'vitest';
import type { DecodedFit } from '#lib/data/formats/fit/decode.ts';
import { fitSecondsToMs } from '#lib/data/formats/fit/units.ts';
import type { StepSample } from './types';
import type { HealthReading } from '#lib/types/health.ts';
import {
    buildStepPackets,
    collectStepSamples,
    markWorn,
    type WatchStepPacket,
} from './stepPackets';

/** FIT seconds for a UTC wall-clock, so fixtures read as dates. */
function at(iso: string): number {
    return Math.round((Date.parse(iso) - Date.parse('1989-12-31T00:00:00Z')) / 1000);
}

function sample(iso: string, cycles: number, extra: Partial<StepSample> = {}): StepSample {
    return {
        fitSeconds: at(iso),
        offsetMinutes: 0,
        activityType: 'walking',
        cycles,
        activeTime: 0,
        distance: 0,
        calories: 0,
        intensity: null,
        ...extra,
    };
}

function monitoringFile(
    mesgs: Record<string, unknown>[],
    info?: Record<string, unknown>
): DecodedFit {
    return {
        fileType: 'monitoringB',
        recordMesgs: [],
        sessionMesgs: [],
        activityMesgs: [],
        monitoringMesgs: mesgs,
        monitoringInfoMesgs: info ? [info] : [],
        stressLevelMesgs: [],
        respirationRateMesgs: [],
        monitoringHrDataMesgs: [],
    };
}

describe('collectStepSamples', () => {
    it('resolves the compressed timestamps most readings arrive with', () => {
        const start = at('2024-03-31T05:00:00Z');
        const samples = collectStepSamples(
            monitoringFile([
                {
                    timestamp: new Date(fitSecondsToMs(start)),
                    cycles: 100,
                    activityType: 'walking',
                },
                // A reading 15 minutes later, carrying only the low 16 bits.
                { timestamp16: (start + 900) & 0xffff, cycles: 260, activityType: 'walking' },
            ])
        );

        expect(samples.map((s) => s.fitSeconds)).toEqual([start, start + 900]);
    });

    /**
     * The SDK only expands the `steps` sub-field on readings that also carry a
     * full timestamp, which in a real daily file is 2 of 143. Everything else
     * would be lost if `cycles` weren't converted here.
     */
    it('keeps readings the SDK left without an expanded step count', () => {
        const start = at('2024-03-31T05:00:00Z');
        const samples = collectStepSamples(
            monitoringFile([
                {
                    timestamp: new Date(fitSecondsToMs(start)),
                    cycles: 100,
                    steps: 200,
                    activityType: 'walking',
                },
                { timestamp16: (start + 60) & 0xffff, cycles: 150, activityType: 'walking' },
            ])
        );

        expect(samples).toHaveLength(2);
        expect(samples.map((s) => s.cycles)).toEqual([100, 150]);
    });

    it('reads the watch’s own timezone rather than assuming one', () => {
        const start = at('2024-05-31T14:58:00Z');
        const [reading] = collectStepSamples(
            monitoringFile(
                [
                    {
                        timestamp: new Date(fitSecondsToMs(start)),
                        cycles: 10,
                        activityType: 'walking',
                    },
                ],
                { timestamp: new Date(fitSecondsToMs(start)), localTimestamp: start - 5 * 3600 }
            )
        );

        expect(reading.offsetMinutes).toBe(-300);
    });

    it('ignores counters that do not count steps', () => {
        const start = at('2024-03-31T05:00:00Z');
        const samples = collectStepSamples(
            monitoringFile([
                { timestamp: new Date(fitSecondsToMs(start)), cycles: 0, activityType: 'generic' },
                {
                    timestamp: new Date(fitSecondsToMs(start)),
                    cycles: 500,
                    activityType: 'cycling',
                },
                {
                    timestamp: new Date(fitSecondsToMs(start)),
                    cycles: 100,
                    activityType: 'walking',
                },
            ])
        );

        expect(samples.map((s) => s.activityType)).toEqual(['walking']);
    });

    it('advances the timestamp resolver over readings it discards', () => {
        const start = at('2024-03-31T05:00:00Z');
        // The full timestamp sits on a heart-rate reading with no counter at all;
        // dropping it before resolving would strand everything after it.
        const samples = collectStepSamples(
            monitoringFile([
                { timestamp: new Date(fitSecondsToMs(start)), heartRate: 78 },
                { timestamp16: (start + 120) & 0xffff, cycles: 90, activityType: 'walking' },
            ])
        );

        expect(samples.map((s) => s.fitSeconds)).toEqual([start + 120]);
    });
});

describe('buildStepPackets', () => {
    it('differences the running counter instead of storing it', () => {
        const packets = buildStepPackets([
            sample('2024-03-31T06:00:00Z', 100),
            sample('2024-03-31T07:00:00Z', 260),
            sample('2024-03-31T08:00:00Z', 300),
        ]);

        expect(packets.map((p) => p.steps)).toEqual([200, 320, 80]);
    });

    it('measures the day’s first packet from local midnight', () => {
        const [packet] = buildStepPackets([sample('2024-03-31T06:00:00Z', 100)]);

        expect(packet.startTimestamp).toBe('2024-03-31 00:00:00');
        expect(packet.spanSeconds).toBe(6 * 3600);
    });

    it('places midnight in the watch’s timezone, not UTC', () => {
        // 06:00 UTC is 02:00 local at −4h, so the packet still belongs to the 31st
        // and runs from that day's local midnight.
        const [packet] = buildStepPackets([
            sample('2024-03-31T06:00:00Z', 100, { offsetMinutes: -240 }),
        ]);

        expect(packet.date).toBe('2024-03-31');
        expect(packet.timestamp).toBe('2024-03-31 02:00:00');
        expect(packet.startTimestamp).toBe('2024-03-31 00:00:00');
        expect(packet.spanSeconds).toBe(2 * 3600);
    });

    it('differences each counter on its own history', () => {
        const packets = buildStepPackets([
            sample('2024-03-31T06:00:00Z', 100, { activityType: 'walking' }),
            sample('2024-03-31T06:30:00Z', 40, { activityType: 'running' }),
            sample('2024-03-31T07:00:00Z', 160, { activityType: 'walking' }),
        ]);

        // The running reading does not reset the walking series — differencing a
        // mixed series would read as a 120-step loss at 06:30.
        expect(packets.map((p) => p.steps)).toEqual([200, 80, 120]);
    });

    /**
     * A window is a stretch of time, and it stays one packet even when both
     * counters were written into it — but how much came off each is kept, since
     * nothing else in the row could reconstruct it.
     */
    it('sums the counters written at the same instant into one packet', () => {
        const packets = buildStepPackets([
            sample('2024-03-31T06:00:00Z', 100, { activityType: 'walking', activeTime: 600 }),
            sample('2024-03-31T06:00:00Z', 40, { activityType: 'running', activeTime: 120 }),
        ]);

        expect(packets).toHaveLength(1);
        expect(packets[0].steps).toBe(280);
        expect(packets[0].activeSeconds).toBe(720);
    });

    it('keeps what the running counter contributed to a mixed window', () => {
        const [packet] = buildStepPackets([
            sample('2024-03-31T06:00:00Z', 100, { activityType: 'walking', activeTime: 600 }),
            sample('2024-03-31T06:00:00Z', 40, { activityType: 'running', activeTime: 120 }),
        ]);

        expect(packet.runningSteps).toBe(80);
        expect(packet.runningActiveSeconds).toBe(120);
        // Walking is read back as the remainder, so the two must add up exactly.
        expect(packet.steps - packet.runningSteps).toBe(200);
        expect(packet.activeSeconds - packet.runningActiveSeconds).toBe(600);
    });

    it('reports no running at all on a window the walker never ran in', () => {
        const [packet] = buildStepPackets([
            sample('2024-03-31T06:00:00Z', 100, { activityType: 'walking', activeTime: 600 }),
        ]);

        expect(packet.runningSteps).toBe(0);
        expect(packet.runningActiveSeconds).toBe(0);
    });

    it('gives a merged packet one pace over all of its movement', () => {
        const [packet] = buildStepPackets([
            // 200 steps in 10 minutes of walking, 400 in 2 minutes of running.
            sample('2024-03-31T06:00:00Z', 100, { activityType: 'walking', activeTime: 600 }),
            sample('2024-03-31T06:00:00Z', 200, { activityType: 'running', activeTime: 120 }),
        ]);

        expect(packet.steps).toBe(600);
        expect(packet.activeSeconds).toBe(720);
        // 600 steps over 12 active minutes, not the mean of 20 and 200.
        expect(packet.cadenceSpm).toBe(50);
    });

    it('spans the widest window the merged parts covered', () => {
        const [, merged] = buildStepPackets([
            sample('2024-03-31T05:00:00Z', 50, { activityType: 'walking' }),
            sample('2024-03-31T06:00:00Z', 100, { activityType: 'walking' }),
            // The running counter had nothing before, so its window opens at
            // midnight and is the wider of the two.
            sample('2024-03-31T06:00:00Z', 40, { activityType: 'running' }),
        ]);

        expect(merged.startTimestamp).toBe('2024-03-31 00:00:00');
        expect(merged.spanSeconds).toBe(6 * 3600);
    });

    /**
     * The profile requires the daily summary to be stamped at 00:00:00, so the
     * watch writes a day's finished totals at the instant the next one begins.
     * Read literally, every day opens with the previous day's counter and closes
     * with its own — which doubled every count in the export this was built on.
     */
    it('credits a midnight reading to the day it closes', () => {
        const packets = buildStepPackets([
            sample('2024-08-05T20:00:00Z', 4000),
            // The 5th's closing total, stamped on the 6th.
            sample('2024-08-06T00:00:00Z', 5517.5),
            // The 6th's own series, restarting from nothing.
            sample('2024-08-06T00:29:00Z', 8),
            sample('2024-08-06T09:00:00Z', 500),
        ]);

        const byDay = new Map<string, number>();
        for (const p of packets) byDay.set(p.date, (byDay.get(p.date) ?? 0) + p.steps);

        expect(Object.fromEntries(byDay)).toEqual({
            '2024-08-05': 11_035,
            '2024-08-06': 1000,
        });
    });

    it('keeps the closing packet inside its own day', () => {
        const [, closing] = buildStepPackets([
            sample('2024-08-05T20:00:00Z', 4000),
            sample('2024-08-06T00:00:00Z', 4100),
        ]);

        expect(closing.date).toBe('2024-08-05');
        expect(closing.timestamp).toBe('2024-08-05 23:59:59');
    });

    it('leaves readings that merely fall near midnight alone', () => {
        const packets = buildStepPackets([
            sample('2024-08-06T00:00:01Z', 100),
            sample('2024-08-06T00:01:00Z', 150),
        ]);

        expect(packets.every((p) => p.date === '2024-08-06')).toBe(true);
    });

    it('starts a new series at each local day', () => {
        const packets = buildStepPackets([
            sample('2024-03-31T22:00:00Z', 5000),
            // The counter restarts the next day; without per-day series this
            // would read as a 4 900-step loss.
            sample('2024-04-01T07:00:00Z', 100),
        ]);

        expect(packets.map((p) => [p.date, p.steps])).toEqual([
            ['2024-03-31', 10_000],
            ['2024-04-01', 200],
        ]);
    });

    /**
     * A Garmin export writes roughly three monitoring files per day with
     * overlapping windows, so most readings arrive two or three times. Counting
     * them once each would triple the day's step total.
     */
    it('collapses the same reading arriving from several files', () => {
        const packets = buildStepPackets([
            sample('2024-03-31T06:00:00Z', 100),
            sample('2024-03-31T07:00:00Z', 260),
            // Second file, same day, overlapping window.
            sample('2024-03-31T07:00:00Z', 260),
            sample('2024-03-31T08:00:00Z', 300),
        ]);

        expect(packets.map((p) => p.steps)).toEqual([200, 320, 80]);
    });

    it('prefers the higher counter when two readings of an instant disagree', () => {
        const packets = buildStepPackets([
            sample('2024-03-31T06:00:00Z', 100),
            sample('2024-03-31T06:00:00Z', 120),
        ]);

        expect(packets.map((p) => p.steps)).toEqual([240]);
    });

    it('takes a reading at face value when the counter went backwards', () => {
        const packets = buildStepPackets([
            sample('2024-03-31T06:00:00Z', 5000),
            sample('2024-03-31T07:00:00Z', 80),
        ]);

        expect(packets.map((p) => p.steps)).toEqual([10_000, 160]);
    });

    it('drops windows nothing happened in', () => {
        const packets = buildStepPackets([
            sample('2024-03-31T06:00:00Z', 100),
            sample('2024-03-31T07:00:00Z', 100),
            sample('2024-03-31T08:00:00Z', 150),
        ]);

        expect(packets.map((p) => p.steps)).toEqual([200, 100]);
    });

    it('keeps the active duration apart from the window it sits in', () => {
        const packets = buildStepPackets([
            sample('2024-03-31T06:00:00Z', 0, { activeTime: 0 }),
            // 4 891 steps over a 140-minute window, 72 minutes of it moving.
            sample('2024-03-31T08:20:00Z', 2445.5, { activeTime: 4320 }),
        ]);

        const [packet] = packets;
        expect(packet.steps).toBe(4891);
        expect(packet.activeSeconds).toBe(4320);
        expect(packet.spanSeconds).toBe(8400);
        expect(packet.cadenceSpm).toBeCloseTo(67.9, 1);
    });

    it('reports no cadence when nothing was counted as active', () => {
        const [packet] = buildStepPackets([sample('2024-03-31T06:00:00Z', 50, { activeTime: 0 })]);

        expect(packet.cadenceSpm).toBeNull();
    });

    it('carries the differenced distance and calories', () => {
        const packets = buildStepPackets([
            sample('2024-03-31T06:00:00Z', 100, { distance: 80, calories: 5 }),
            sample('2024-03-31T07:00:00Z', 260, { distance: 210, calories: 12 }),
        ]);

        expect(packets[1].distanceMeters).toBe(130);
        expect(packets[1].calories).toBe(7);
    });

    it('returns packets in chronological order across counters', () => {
        const packets = buildStepPackets([
            sample('2024-03-31T07:00:00Z', 100, { activityType: 'walking' }),
            sample('2024-03-31T06:00:00Z', 40, { activityType: 'running' }),
        ]);

        expect(packets.map((p) => p.timestamp)).toEqual([
            '2024-03-31 06:00:00',
            '2024-03-31 07:00:00',
        ]);
    });
});

describe('markWorn', () => {
    const packet = (start: string, end: string): WatchStepPacket => ({
        source: 'garmin',
        startTimestamp: start,
        timestamp: end,
        date: end.slice(0, 10),
        steps: 100,
        activeSeconds: 60,
        spanSeconds: 600,
        distanceMeters: 80,
        calories: 4,
        cadenceSpm: 100,
        intensity: 2,
        runningSteps: 0,
        runningActiveSeconds: 0,
        worn: null,
    });
    const beat = (
        timestamp: string,
        metric: HealthReading['metric'] = 'heart_rate'
    ): HealthReading => ({
        timestamp,
        date: timestamp.slice(0, 10),
        metric,
        value: 60,
    });

    it('marks worn the windows with a pulse inside, edges included', () => {
        const packets = [
            packet('2024-05-01 08:00:00', '2024-05-01 08:10:00'),
            packet('2024-05-01 08:10:00', '2024-05-01 09:00:00'),
            packet('2024-05-01 09:00:00', '2024-05-01 09:30:00'),
        ];
        const readings = [beat('2024-05-01 08:10:00'), beat('2024-05-01 09:45:00')];

        expect(markWorn(packets, readings).map((p) => p.worn)).toEqual([true, true, false]);
    });

    it('reads only the pulse, not the other signals', () => {
        const packets = [packet('2024-05-01 08:00:00', '2024-05-01 08:10:00')];
        const readings = [beat('2024-05-01 07:00:00'), beat('2024-05-01 08:05:00', 'stress')];

        expect(markWorn(packets, readings)[0].worn).toBe(false);
    });

    it('leaves the packets unknown when the watch never measured a pulse', () => {
        const packets = [packet('2024-05-01 08:00:00', '2024-05-01 08:10:00')];

        expect(markWorn(packets, [beat('2024-05-01 08:05:00', 'stress')])[0].worn).toBeNull();
    });
});
