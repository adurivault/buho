import { describe, it, expect } from 'vitest';
import { parseGoogleMapsData } from './parseGoogleMaps';
import type { RawGoogleMapsEntry } from '$lib/types/googleMaps';

describe('parseGoogleMapsData', () => {
    it('parses a visit into one stationary segment', () => {
        const data: RawGoogleMapsEntry[] = [
            {
                startTime: '2016-07-11T21:19:45.501+02:00',
                endTime: '2016-07-12T08:16:44.999+02:00',
                visit: {
                    topCandidate: {
                        placeLocation: 'geo:45.753686,4.832201',
                        placeID: 'place-abc',
                        semanticType: 'Home',
                    },
                },
            },
        ];

        const [seg] = parseGoogleMapsData(data);
        expect(seg.segmentType).toBe('stationary');
        expect(seg.semanticType).toBe('Home');
        expect(seg.placeId).toBe('place-abc');
        expect(seg.activityType).toBeNull();
        expect(seg.distanceMeters).toBeNull();
        expect(seg.lat).toBeCloseTo(45.753686);
        expect(seg.lon).toBeCloseTo(4.832201);
        // 21:19:45 → 08:16:44 next day = 10h56m59s ≈ 39419s
        expect(seg.durationSeconds).toBeCloseTo(39419.498, 0);
    });

    it('parses an activity into one moving segment (routed distance dropped)', () => {
        const data: RawGoogleMapsEntry[] = [
            {
                startTime: '2016-07-12T08:16:44.999+02:00',
                endTime: '2016-07-12T08:45:00.000+02:00',
                activity: {
                    start: 'geo:45.753686,4.832201',
                    end: 'geo:45.748796,4.743922',
                    distanceMeters: '6871.015625',
                    topCandidate: { type: 'in passenger vehicle' },
                },
            },
        ];

        const [seg] = parseGoogleMapsData(data);
        expect(seg.segmentType).toBe('moving');
        expect(seg.activityType).toBe('in passenger vehicle');
        expect(seg.semanticType).toBeNull();
        expect(seg.placeId).toBeNull();
        // The routed activity distance (semantic layer) is not used: distance
        // comes from the raw path only, so a lone activity carries none.
        expect(seg.distanceMeters).toBeNull();
        expect(seg.lat).toBeCloseTo(45.753686);
        // Speed still uses the routed distance / duration (~6871 m over ~28m15s).
        expect(seg.speedKmh).toBeCloseTo(14.6, 0);
        // Heading start→end points roughly west (0..360).
        expect(seg.azimuthDegrees).toBeGreaterThanOrEqual(0);
        expect(seg.azimuthDegrees).toBeLessThan(360);
    });

    it('expands a timelinePath into one moving segment per point', () => {
        const data: RawGoogleMapsEntry[] = [
            {
                startTime: '2016-07-12T06:00:00.000Z',
                endTime: '2016-07-12T08:00:00.000Z',
                timelinePath: [
                    { point: 'geo:45.753197,4.833245', durationMinutesOffsetFromStartTime: '17' },
                    { point: 'geo:45.749030,4.830651', durationMinutesOffsetFromStartTime: '18' },
                    { point: 'geo:45.767011,4.792801', durationMinutesOffsetFromStartTime: '25' },
                ],
            },
        ];

        const segs = parseGoogleMapsData(data);
        expect(segs).toHaveLength(3);
        expect(segs.every((s) => s.segmentType === 'moving')).toBe(true);
        // Distance is the raw haversine leg to the next path point; the last
        // point has no successor, so its distance is null.
        expect(segs[0].distanceMeters).toBeGreaterThan(0);
        expect(segs[1].distanceMeters).toBeGreaterThan(0);
        expect(segs[2].distanceMeters).toBeNull();
        // Speed + azimuth derive from the leg to the next point. The last point
        // has no leg, so it's a standstill: speed 0, no heading.
        expect(segs[0].speedKmh).toBeGreaterThan(0);
        expect(segs[0].azimuthDegrees).toBeGreaterThanOrEqual(0);
        expect(segs[1].speedKmh).toBeGreaterThan(0);
        expect(segs[2].speedKmh).toBe(0);
        expect(segs[2].azimuthDegrees).toBeNull();
    });

    it('ignores timelineMemory and unrecognized entries', () => {
        const data: RawGoogleMapsEntry[] = [
            {
                startTime: '2016-07-13T17:59:28.139+02:00',
                endTime: '2016-07-18T02:03:31.999+02:00',
                timelineMemory: { distanceFromOriginKms: '317' },
            },
            { startTime: '2016-07-13T18:00:00.000+02:00', endTime: '2016-07-13T18:00:00.000+02:00', somethingElse: true },
        ];
        expect(parseGoogleMapsData(data)).toHaveLength(0);
    });

    it('skips entries with malformed geo or timestamps', () => {
        const data = [
            { startTime: 'not-a-date', endTime: 'x', visit: { topCandidate: { placeLocation: 'geo:1,2' } } },
            { startTime: '2016-07-12T06:00:00.000Z', endTime: '2016-07-12T06:00:00.000Z', visit: { topCandidate: { placeLocation: 'not-geo' } } },
        ] as RawGoogleMapsEntry[];
        expect(parseGoogleMapsData(data)).toHaveLength(0);
    });

    describe('timezone handling', () => {
        // These assertions hold regardless of the test runner's local timezone:
        // wall-clock is derived from the event offset, never from the browser.
        it('stores the wall-clock from the event offset, not the runner timezone', () => {
            const data: RawGoogleMapsEntry[] = [
                {
                    startTime: '2020-01-01T20:30:00.000+07:00', // Bangkok evening
                    endTime: '2020-01-01T21:00:00.000+07:00',
                    visit: { topCandidate: { placeLocation: 'geo:13.7563,100.5018', semanticType: 'Unknown' } },
                },
            ];
            const [seg] = parseGoogleMapsData(data);
            expect(seg.timestamp).toBe('2020-01-01 20:30:00');
            expect(seg.date).toBe('2020-01-01');
        });

        it('propagates the neighbouring offset to UTC-only timelinePath points', () => {
            // A visit at +02:00 establishes the local offset; the following
            // timelinePath is in UTC and must inherit +02:00 — so 06:17Z → 08:17.
            const data: RawGoogleMapsEntry[] = [
                {
                    startTime: '2016-07-12T05:00:00.000+02:00',
                    endTime: '2016-07-12T05:30:00.000+02:00',
                    visit: { topCandidate: { placeLocation: 'geo:45.75,4.83', semanticType: 'Home' } },
                },
                {
                    startTime: '2016-07-12T06:00:00.000Z',
                    endTime: '2016-07-12T07:00:00.000Z',
                    timelinePath: [
                        { point: 'geo:45.753197,4.833245', durationMinutesOffsetFromStartTime: '17' },
                    ],
                },
            ];
            const segs = parseGoogleMapsData(data);
            const pathSeg = segs.find((s) => s.segmentType === 'moving')!;
            // 06:00Z + 17min = 06:17Z, +02:00 carried = 08:17 local
            expect(pathSeg.timestamp).toBe('2016-07-12 08:17:00');
        });
    });

    it('throws for null / undefined / non-array input', () => {
        expect(() => parseGoogleMapsData(null as never)).toThrow('cannot be null or undefined');
        expect(() => parseGoogleMapsData(undefined as never)).toThrow('cannot be null or undefined');
        expect(() => parseGoogleMapsData('nope' as never)).toThrow('must be an array');
    });

    it('handles empty input', () => {
        expect(parseGoogleMapsData([])).toHaveLength(0);
    });
});
