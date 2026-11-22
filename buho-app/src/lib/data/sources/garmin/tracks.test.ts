import { describe, expect, it } from 'vitest';
import type { DecodedFit, FitMesg } from '#lib/data/formats/fit/decode.ts';
import { SEMICIRCLES_TO_DEGREES, fitSecondsToMs } from '#lib/data/formats/fit/units.ts';
import { activitySegments } from './tracks';

/** Degrees back into the semicircles a FIT record stores. */
const semi = (degrees: number) => Math.round(degrees / SEMICIRCLES_TO_DEGREES);

function record(iso: string, lat: number | null, lon: number | null, extra: FitMesg = {}): FitMesg {
    return {
        timestamp: new Date(iso),
        ...(lat == null ? {} : { positionLat: semi(lat) }),
        ...(lon == null ? {} : { positionLong: semi(lon) }),
        ...extra,
    };
}

function activityFile(
    records: FitMesg[],
    options: { sport?: string; offsetHours?: number } = {}
): DecodedFit {
    const { sport = 'running', offsetHours = 0 } = options;
    const first = records[0]?.timestamp as Date | undefined;
    const seconds = first
        ? Math.round((first.getTime() - Date.parse('1989-12-31T00:00:00Z')) / 1000)
        : 0;

    return {
        fileType: 'activity',
        recordMesgs: records,
        sessionMesgs: [{ sport }],
        activityMesgs: [
            {
                timestamp: new Date(fitSecondsToMs(seconds)),
                localTimestamp: seconds + offsetHours * 3600,
            },
        ],
        monitoringMesgs: [],
        monitoringInfoMesgs: [],
        stressLevelMesgs: [],
        respirationRateMesgs: [],
        monitoringHrDataMesgs: [],
    };
}

describe('activitySegments', () => {
    it('converts recorded positions to degrees', () => {
        const [segment] = activitySegments(
            activityFile([
                record('2025-05-14T16:29:31Z', 46.9001, 6.9301),
                record('2025-05-14T16:29:37Z', 46.9002, 6.9303),
            ])
        );

        expect(segment.lat).toBeCloseTo(46.9001, 5);
        expect(segment.lon).toBeCloseTo(6.9301, 5);
    });

    it('places the activity in the timezone the watch was set to', () => {
        const [segment] = activitySegments(
            activityFile(
                [
                    record('2025-05-14T16:29:31Z', 46.9, 6.93),
                    record('2025-05-14T16:29:37Z', 46.9001, 6.9301),
                ],
                { offsetHours: 2 }
            )
        );

        expect(segment.timestamp).toBe('2025-05-14 18:29:31');
        expect(segment.date).toBe('2025-05-14');
    });

    it('describes the leg starting at each fix', () => {
        const [segment] = activitySegments(
            activityFile([
                record('2025-05-14T16:29:31Z', 46.9, 6.93, { distance: 0, speed: 4.47 }),
                record('2025-05-14T16:29:37Z', 46.9, 6.9302, { distance: 17.4 }),
            ])
        );

        expect(segment.durationSeconds).toBe(6);
        expect(segment.distanceMeters).toBeCloseTo(17.4, 5);
        expect(segment.speedKmh).toBeCloseTo(16.09, 2);
        // Due east, so a 90° heading.
        expect(segment.azimuthDegrees).toBeCloseTo(90, 0);
        expect(segment.endTimestamp).toBe('2025-05-14 16:29:37');
    });

    it('ends the activity at a standstill, mirroring a Timeline path', () => {
        const segments = activitySegments(
            activityFile([
                record('2025-05-14T16:29:31Z', 46.9, 6.93, { speed: 4.47 }),
                record('2025-05-14T16:29:37Z', 46.9002, 6.9302, { speed: 4.2 }),
            ])
        );

        const last = segments[segments.length - 1];
        expect(last.speedKmh).toBe(0);
        expect(last.azimuthDegrees).toBeNull();
        expect(last.distanceMeters).toBeNull();
    });

    /** A watch keeps writing records on a treadmill; they belong on no map. */
    it('drops records with no position', () => {
        const segments = activitySegments(
            activityFile([
                record('2025-05-14T16:29:31Z', 46.9, 6.93),
                record('2025-05-14T16:29:33Z', null, null, { heartRate: 150 }),
                record('2025-05-14T16:29:37Z', 46.9002, 6.9302),
            ])
        );

        expect(segments).toHaveLength(2);
    });

    it('yields nothing at all for an indoor activity', () => {
        expect(
            activitySegments(
                activityFile([
                    record('2025-05-14T16:29:31Z', null, null, { heartRate: 150 }),
                    record('2025-05-14T16:29:37Z', null, null, { heartRate: 152 }),
                ])
            )
        ).toEqual([]);
    });

    it('labels every segment with the sport, alongside Timeline’s own labels', () => {
        const segments = activitySegments(
            activityFile(
                [
                    record('2025-05-14T16:29:31Z', 46.9, 6.93),
                    record('2025-05-14T16:29:37Z', 46.9002, 6.9302),
                ],
                { sport: 'cycling' }
            )
        );

        expect(segments.every((s) => s.activityType === 'cycling')).toBe(true);
        expect(segments.every((s) => s.source === 'garmin')).toBe(true);
        expect(segments.every((s) => s.segmentType === 'moving')).toBe(true);
    });

    it('carries the sensor readings only a watch has', () => {
        const [segment] = activitySegments(
            activityFile([
                record('2025-05-14T16:29:31Z', 46.9, 6.93, {
                    enhancedAltitude: 42.5,
                    heartRate: 151,
                    cadence: 81,
                }),
                record('2025-05-14T16:29:37Z', 46.9002, 6.9302),
            ])
        );

        expect(segment.altitudeMeters).toBe(42.5);
        expect(segment.heartRate).toBe(151);
        // A runner's cadence counts one foot; the displayed figure is both.
        expect(segment.cadenceSpm).toBe(162);
    });

    it('leaves a cyclist’s cadence as whole revolutions', () => {
        const [segment] = activitySegments(
            activityFile(
                [
                    record('2025-05-14T16:29:31Z', 46.9, 6.93, { cadence: 85 }),
                    record('2025-05-14T16:29:37Z', 46.9002, 6.9302),
                ],
                { sport: 'cycling' }
            )
        );

        expect(segment.cadenceSpm).toBe(85);
    });

    it('never leaves a Timeline-only column filled in', () => {
        const segments = activitySegments(
            activityFile([
                record('2025-05-14T16:29:31Z', 46.9, 6.93),
                record('2025-05-14T16:29:37Z', 46.9002, 6.9302),
            ])
        );

        expect(segments.every((s) => s.semanticType === null && s.placeId === null)).toBe(true);
    });

    it('orders fixes by time even when the file does not', () => {
        const segments = activitySegments(
            activityFile([
                record('2025-05-14T16:29:37Z', 46.9002, 6.9302),
                record('2025-05-14T16:29:31Z', 46.9, 6.93),
            ])
        );

        expect(segments.map((s) => s.timestamp)).toEqual([
            '2025-05-14 16:29:31',
            '2025-05-14 16:29:37',
        ]);
    });
});
