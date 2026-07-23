import { describe, it, expect } from 'vitest';
import { computeDays, type DaySegment } from './daysDataset';

const HOME = { lat: 48.85, lon: 2.35 };
const WORK = { lat: 48.9, lon: 2.4 };

/** Epoch ms of a naive local wall-clock (treated as UTC, like the DB). */
const ms = (y: number, mo: number, d: number, h: number, mi = 0) => Date.UTC(y, mo - 1, d, h, mi);

function seg(p: Partial<DaySegment> & Pick<DaySegment, 'startMs' | 'endMs' | 'segmentType'>): DaySegment {
    return {
        lat: HOME.lat, lon: HOME.lon, placeId: '', semanticType: '',
        durationSeconds: 0, distanceMeters: 0, nearestCity: 'Paris', country: 'France',
        ...p,
    };
}

function build(segs: DaySegment[]) {
    segs.sort((a, b) => a.startMs - b.startMs);
    const rows = computeDays(segs);
    return new Map(rows.map((r) => [r.day, r]));
}

describe('computeDays', () => {
    const segs: DaySegment[] = [
        // Day 03-11: a Home visit that spans the 03-11 04:00 anchor.
        seg({ startMs: ms(2024, 3, 10, 23, 0), endMs: ms(2024, 3, 11, 8, 0), segmentType: 'stationary', placeId: 'home', semanticType: 'Home', ...HOME }),
        seg({ startMs: ms(2024, 3, 11, 9, 0), endMs: ms(2024, 3, 11, 9, 30), segmentType: 'moving', distanceMeters: 5000, durationSeconds: 1800, lat: 48.87, lon: 2.37 }),

        // Day 03-12: a crack — 04:00 falls between two Home visits.
        seg({ startMs: ms(2024, 3, 11, 23, 0), endMs: ms(2024, 3, 12, 3, 48), segmentType: 'stationary', placeId: 'home', semanticType: 'Home', ...HOME }),
        seg({ startMs: ms(2024, 3, 12, 4, 7), endMs: ms(2024, 3, 12, 9, 0), segmentType: 'stationary', placeId: 'home', semanticType: 'Home', ...HOME }),
        // a Work visit that day so distinctPlaces / visitCount are exercised
        seg({ startMs: ms(2024, 3, 12, 11, 0), endMs: ms(2024, 3, 12, 18, 0), segmentType: 'stationary', placeId: 'work', semanticType: 'Work', durationSeconds: 25200, ...WORK }),

        // Day 03-14: a phone-off hole — nothing overnight, Home points either side.
        seg({ startMs: ms(2024, 3, 13, 20, 0), endMs: ms(2024, 3, 13, 22, 0), segmentType: 'stationary', placeId: 'home', semanticType: 'Home', ...HOME }),
        seg({ startMs: ms(2024, 3, 14, 10, 0), endMs: ms(2024, 3, 14, 12, 0), segmentType: 'stationary', placeId: 'home', semanticType: 'Home', ...HOME }),

        // Day 03-16: overnight travel — a moving segment straddles 04:00.
        seg({ startMs: ms(2024, 3, 15, 23, 0), endMs: ms(2024, 3, 16, 7, 0), segmentType: 'moving', distanceMeters: 40000, durationSeconds: 28800, ...HOME }),
        seg({ startMs: ms(2024, 3, 16, 8, 0), endMs: ms(2024, 3, 16, 18, 0), segmentType: 'stationary', placeId: 'work', semanticType: 'Work', ...WORK }),
    ];

    const days = build(segs);

    it('resolves a visit that spans 04:00', () => {
        const d = days.get('2024-03-11')!;
        expect(d.startFill).toBe('visit');
        expect(d.startPlaceId).toBe('home');
        expect(d.startPlaceKm).toBeCloseTo(0, 3);
        expect(d.kmTraveled).toBeCloseTo(5, 5);
    });

    it('fills a crack between two visits by interpolation → home', () => {
        const d = days.get('2024-03-12')!;
        expect(d.startFill).toBe('interpolated');
        expect(d.startPlaceId).toBe('home');
        // The 03-11 23:00 visit belongs to logical day 03-11 (start −4h = 19:00);
        // this day's bucket holds the 04:07 Home visit + the Work visit.
        expect(d.visitCount).toBe(2);
        expect(d.distinctPlaces).toBe(2); // home, work
    });

    it('fills an overnight hole by interpolation → home', () => {
        const d = days.get('2024-03-14')!;
        expect(d.startFill).toBe('interpolated');
        expect(d.startPlaceId).toBe('home');
        expect(d.startPlaceKm).toBeCloseTo(0, 3);
    });

    it('marks a travel night as interpolated (position en route)', () => {
        const d = days.get('2024-03-16')!;
        expect(d.startFill).toBe('interpolated');
        expect(d.kmTraveled).toBeCloseTo(0, 5); // the moving seg started 03-15, not bucketed here
    });

    it('marks the first day (no prior sample) as an edge', () => {
        const d = days.get('2024-03-10')!;
        expect(d.startFill).toBe('edge');
    });

    it('emits a contiguous run of logical days', () => {
        expect(days.has('2024-03-13')).toBe(true); // in-between day still emitted
        expect([...days.keys()].sort()[0]).toBe('2024-03-10');
    });
});

describe('computeDays — daily rhythm & novelty', () => {
    // A clean out-and-back day: sleep at HOME, out to WORK 09:00–17:00, home for
    // the night. HOME and WORK are ~6 km apart (> the 300 m away radius).
    const segs: DaySegment[] = [
        seg({ startMs: ms(2024, 5, 9, 23, 0), endMs: ms(2024, 5, 10, 8, 0), segmentType: 'stationary', placeId: 'home', ...HOME }),
        seg({ startMs: ms(2024, 5, 10, 9, 0), endMs: ms(2024, 5, 10, 17, 0), segmentType: 'stationary', placeId: 'work', ...WORK }),
        seg({ startMs: ms(2024, 5, 10, 18, 0), endMs: ms(2024, 5, 11, 8, 0), segmentType: 'stationary', placeId: 'home', ...HOME }),
    ];
    const days = build(segs);

    it('reads departure, return and amplitude off the away radius', () => {
        const d = days.get('2024-05-10')!;
        expect(d.departureHour).toBeCloseTo(9, 5);   // first sample >300 m from HOME
        expect(d.returnHour).toBeCloseTo(18, 5);     // settled back near HOME
        expect(d.amplitudeHours).toBeCloseTo(9, 5);
    });

    it('leaves departure/return null on a day spent at the anchor', () => {
        // 05-09 holds only the HOME visit's start; it never leaves.
        const d = days.get('2024-05-09')!;
        expect(d.departureHour).toBeNull();
        expect(d.returnHour).toBeNull();
        expect(d.amplitudeHours).toBeNull();
    });

    it('flags a day that sees a grid cell for the first time', () => {
        expect(days.get('2024-05-09')!.discoveredNew).toBe(true);  // HOME cell first seen
        expect(days.get('2024-05-10')!.discoveredNew).toBe(true);  // WORK cell first seen
        expect(days.get('2024-05-11')!.discoveredNew).toBe(false); // nothing new
    });
});
