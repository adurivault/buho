import { describe, expect, it } from 'vitest';
import type { DecodedFit } from '#lib/data/formats/fit/decode.ts';
import { fitSecondsToMs } from '#lib/data/formats/fit/units.ts';
import { collectHealthReadings, healthReadingsFromFiles } from './healthReadings';

/** FIT seconds for a UTC wall-clock, so fixtures read as dates. */
function at(iso: string): number {
    return Math.round((Date.parse(iso) - Date.parse('1989-12-31T00:00:00Z')) / 1000);
}

function monitoringFile(parts: Partial<DecodedFit>, offsetMinutes = 0): DecodedFit {
    const timestamp = new Date(fitSecondsToMs(at('2024-03-31T06:00:00Z')));
    return {
        fileType: 'monitoringB',
        recordMesgs: [],
        sessionMesgs: [],
        activityMesgs: [],
        monitoringMesgs: [],
        monitoringInfoMesgs: [
            { timestamp, localTimestamp: at('2024-03-31T06:00:00Z') + offsetMinutes * 60 },
        ],
        stressLevelMesgs: [],
        respirationRateMesgs: [],
        monitoringHrDataMesgs: [],
        ...parts,
    };
}

describe('collectHealthReadings', () => {
    it('reads heart rate off the messages the step loop walks past', () => {
        const start = at('2024-03-31T06:00:00Z');
        const readings = collectHealthReadings(
            monitoringFile({
                monitoringMesgs: [
                    { timestamp: new Date(fitSecondsToMs(start)), heartRate: 61, cycles: 100 },
                    // Compressed timestamp, like 140 of every 143 real messages.
                    { timestamp16: (start + 60) & 0xffff, heartRate: 64 },
                ],
            })
        );

        expect(readings).toEqual([
            {
                timestamp: '2024-03-31 06:00:00',
                date: '2024-03-31',
                metric: 'heart_rate',
                value: 61,
            },
            {
                timestamp: '2024-03-31 06:01:00',
                date: '2024-03-31',
                metric: 'heart_rate',
                value: 64,
            },
        ]);
    });

    it('reads stress and respiration off their own messages', () => {
        const timestamp = new Date(fitSecondsToMs(at('2024-03-31T06:00:00Z')));
        const readings = collectHealthReadings(
            monitoringFile({
                stressLevelMesgs: [{ stressLevelTime: timestamp, stressLevelValue: 23 }],
                respirationRateMesgs: [{ timestamp, respirationRate: 13.5 }],
            })
        );

        expect(readings.map((r) => [r.metric, r.value])).toEqual([
            ['stress', 23],
            ['respiration', 13.5],
        ]);
    });

    it('drops the sentinels Garmin writes for "no reading"', () => {
        const timestamp = new Date(fitSecondsToMs(at('2024-03-31T06:00:00Z')));
        const readings = collectHealthReadings(
            monitoringFile({
                monitoringMesgs: [{ timestamp, heartRate: 0 }],
                stressLevelMesgs: [{ stressLevelTime: timestamp, stressLevelValue: -2 }],
                respirationRateMesgs: [{ timestamp, respirationRate: -2 }],
            })
        );

        // A sentinel that reaches a colour scale flattens every real value
        // against one end of it.
        expect(readings).toEqual([]);
    });

    it('places a reading on the watch’s local clock, not UTC', () => {
        const timestamp = new Date(fitSecondsToMs(at('2024-03-31T06:00:00Z')));
        const [reading] = collectHealthReadings(
            monitoringFile({ respirationRateMesgs: [{ timestamp, respirationRate: 12 }] }, -240)
        );

        // 06:00 UTC at −4h is the small hours of the same day: an hour-of-day
        // chart is wrong by four hours if the offset is ignored.
        expect(reading.timestamp).toBe('2024-03-31 02:00:00');
        expect(reading.date).toBe('2024-03-31');
    });

    it('ignores a message with no reading in it', () => {
        const timestamp = new Date(fitSecondsToMs(at('2024-03-31T06:00:00Z')));
        const readings = collectHealthReadings(
            monitoringFile({
                monitoringMesgs: [{ timestamp, cycles: 100, activityType: 'walking' }],
            })
        );

        expect(readings).toEqual([]);
    });
});

describe('healthReadingsFromFiles', () => {
    it('keeps one reading per instant across overlapping files', () => {
        const timestamp = new Date(fitSecondsToMs(at('2024-03-31T06:00:00Z')));
        const file = () =>
            monitoringFile({ respirationRateMesgs: [{ timestamp, respirationRate: 14 }] });

        // An export writes about three files a day over the same window, so the
        // same reading arrives several times over.
        const readings = healthReadingsFromFiles([file(), file(), file()]);

        expect(readings).toHaveLength(1);
    });

    it('keeps two metrics that share an instant', () => {
        const timestamp = new Date(fitSecondsToMs(at('2024-03-31T06:00:00Z')));
        const readings = healthReadingsFromFiles([
            monitoringFile({
                stressLevelMesgs: [{ stressLevelTime: timestamp, stressLevelValue: 20 }],
                respirationRateMesgs: [{ timestamp, respirationRate: 14 }],
            }),
        ]);

        expect(readings.map((r) => r.metric).sort()).toEqual(['respiration', 'stress']);
    });
});
