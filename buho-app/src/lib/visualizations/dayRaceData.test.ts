import { describe, it, expect } from 'vitest';
import {
    buildDayRaceDataset,
    computePercentileBounds,
    sampleDots,
    sampleTrails,
    dayOfYearFraction,
    DAY_MINUTES,
    MAX_KEYFRAMES_PER_DAY,
    TRAIL_MAX_SEG,
    TRAIL_WINDOW_MIN,
    type DayTrack,
} from './dayRaceData';
import type { DayRaceSegmentRows, DayRecord } from '$lib/data/queries/googleMapsQueries';

const DAY = '2024-01-02';
const ANCHOR = Date.UTC(2024, 0, 2, 4); // the 04:00 anchor of the logical day
const at = (min: number) => ANCHOR + min * 60000;

interface Seg {
    tStart: number; // clock-minutes since 04:00
    tEnd: number;
    lat: number;
    lon: number;
    stationary?: boolean;
}

function mkRows(segs: Seg[]): DayRaceSegmentRows {
    return {
        numRows: segs.length,
        startMs: segs.map((s) => at(s.tStart)),
        endMs: segs.map((s) => at(s.tEnd)),
        lat: segs.map((s) => s.lat),
        lon: segs.map((s) => s.lon),
        isStationary: segs.map((s) => (s.stationary ? 1 : 0)),
    };
}

function mkDay(day: string, lat: number, lon: number): DayRecord {
    return {
        day,
        startPlaceId: '',
        startSemanticType: 'Unknown',
        startLat: lat,
        startLon: lon,
        startCity: 'Paris',
        startCountry: 'France',
        startPlaceKm: 0,
        startFill: 'visit',
        kmTraveled: 0,
        maxDistFromStartKm: 0,
        distinctPlaces: 0,
        visitCount: 0,
        movingMinutes: 0,
        stationaryMinutes: 0,
        segmentCount: 0,
        departureHour: null,
        returnHour: null,
        amplitudeHours: null,
        discoveredNew: false,
    };
}

function track(dataset: ReturnType<typeof buildDayRaceDataset>, day: string): DayTrack {
    const t = dataset.tracks.find((x) => x.day === day);
    if (!t) throw new Error(`no track for ${day}`);
    return t;
}

describe('buildDayRaceDataset', () => {
    it('seeds each track at t=0 with the day record home anchor', () => {
        const ds = buildDayRaceDataset(mkRows([{ tStart: 300, tEnd: 300, lat: 11, lon: 21 }]), [
            mkDay(DAY, 10, 20),
        ]);
        const tr = track(ds, DAY);
        expect(tr.times[0]).toBe(0);
        expect(tr.lats[0]).toBe(10);
        expect(tr.lons[0]).toBe(20);
    });

    it('only builds days present in cityDays', () => {
        const ds = buildDayRaceDataset(mkRows([{ tStart: 300, tEnd: 300, lat: 11, lon: 21 }]), [
            mkDay('2020-05-05', 1, 1),
        ]);
        expect(ds.tracks).toHaveLength(0);
        expect(ds.bounds).toBeNull();
    });

    it('adds a hold pair for a stationary visit (same position at start and end)', () => {
        const ds = buildDayRaceDataset(
            mkRows([{ tStart: 300, tEnd: 600, lat: 11, lon: 21, stationary: true }]),
            [mkDay(DAY, 10, 20)],
        );
        const tr = track(ds, DAY);
        expect(Array.from(tr.times)).toEqual([0, 300, 600]);
        expect(tr.lats[1]).toBe(11);
        expect(tr.lats[2]).toBe(11);
        expect(tr.lons[1]).toBe(21);
        expect(tr.lons[2]).toBe(21);
    });

    it('clamps a visit spilling past the day end to 1440', () => {
        const ds = buildDayRaceDataset(
            mkRows([{ tStart: 1400, tEnd: 2000, lat: 11, lon: 21, stationary: true }]),
            [mkDay(DAY, 10, 20)],
        );
        const tr = track(ds, DAY);
        expect(tr.times[tr.times.length - 1]).toBe(DAY_MINUTES);
    });

    it('flags gapAfter only when Δt exceeds the threshold (45 min)', () => {
        // seed(0), 145, 190, 235 → Δ = 145, 45, 45 → only the first pair is a gap.
        const ds = buildDayRaceDataset(
            mkRows([
                { tStart: 145, tEnd: 145, lat: 11, lon: 21 },
                { tStart: 190, tEnd: 190, lat: 12, lon: 22 },
                { tStart: 235, tEnd: 235, lat: 13, lon: 23 },
            ]),
            [mkDay(DAY, 10, 20)],
        );
        const tr = track(ds, DAY);
        expect(Array.from(tr.times)).toEqual([0, 145, 190, 235]);
        expect(Array.from(tr.gapAfter)).toEqual([1, 0, 0, 0]);
    });

    it('downsamples to the cap while keeping protected keyframes', () => {
        const segs: Seg[] = [];
        for (let i = 1; i <= 500; i++) segs.push({ tStart: i * 2, tEnd: i * 2, lat: 10 + i * 1e-4, lon: 20 });
        // One stationary visit whose two protected keyframes must survive.
        segs.push({ tStart: 1200, tEnd: 1300, lat: 99, lon: 99, stationary: true });
        const ds = buildDayRaceDataset(mkRows(segs), [mkDay(DAY, 10, 20)]);
        const tr = track(ds, DAY);
        expect(tr.times.length).toBeLessThanOrEqual(MAX_KEYFRAMES_PER_DAY);
        expect(tr.times[0]).toBe(0); // seed retained
        // The stationary hold pair (lat/lon 99) survived the stride-drop.
        const held = Array.from(tr.lats).filter((v) => v === 99);
        expect(held.length).toBe(2);
    });
});

describe('sampleDots', () => {
    // seed(0) → 300 (gap) → 320: hold across the seed→300 gap, lerp 300→320.
    const ds = buildDayRaceDataset(
        mkRows([
            { tStart: 300, tEnd: 300, lat: 11, lon: 21 },
            { tStart: 320, tEnd: 320, lat: 12, lon: 22 },
        ]),
        [mkDay(DAY, 10, 20)],
    );

    it('holds at the seed before the first real keyframe', () => {
        const out = new Float32Array(2);
        sampleDots(ds.tracks, 100, out);
        expect(out[0]).toBeCloseTo(20, 5); // lon
        expect(out[1]).toBeCloseTo(10, 5); // lat
    });

    it('lerps within a non-gap interval', () => {
        const out = new Float32Array(2);
        sampleDots(ds.tracks, 310, out);
        expect(out[0]).toBeCloseTo(21.5, 5);
        expect(out[1]).toBeCloseTo(11.5, 5);
    });

    it('holds at the last keyframe after the end', () => {
        const out = new Float32Array(2);
        sampleDots(ds.tracks, 1000, out);
        expect(out[0]).toBeCloseTo(22, 5);
        expect(out[1]).toBeCloseTo(12, 5);
    });
});

describe('sampleTrails', () => {
    // Clean multi-keyframe path (Δ 20 min < window), plus the seed→first gap.
    // times ≈ [0, 100, 120, 140], gapAfter ≈ [1, 0, 0].
    const ds = buildDayRaceDataset(
        mkRows([
            { tStart: 100, tEnd: 100, lat: 11, lon: 21 },
            { tStart: 120, tEnd: 120, lat: 12, lon: 22 },
            { tStart: 140, tEnd: 140, lat: 13, lon: 23 },
        ]),
        [mkDay(DAY, 10, 20)],
    );
    const seg = TRAIL_MAX_SEG;
    const buf = (n: number) => new Float32Array(n * seg * 2);
    const cbuf = (n: number) => new Uint8Array(n * seg * 4);
    const rgb = new Uint8Array([234, 67, 53]);

    it('uses real keyframes as interior vertices, with the dot as the newest end', () => {
        const src = buf(1);
        const dst = buf(1);
        sampleTrails(ds.tracks, 130, src, dst, cbuf(1), rgb);
        // Window [100, 130]. seg0: kf@120 → dot@130 (mid of 120→140).
        expect(dst[0]).toBeCloseTo(22.5, 5); // dot lon at t=130
        expect(dst[1]).toBeCloseTo(12.5, 5);
        expect(src[0]).toBeCloseTo(22, 5); // interior vertex = real keyframe @120
        expect(src[1]).toBeCloseTo(12, 5);
        // seg1: kf@100 → kf@120, sharing the vertex (continuous polyline).
        expect(src[2]).toBeCloseTo(21, 5);
        expect(src[3]).toBeCloseTo(11, 5);
        expect(dst[2]).toBeCloseTo(22, 5);
        expect(dst[3]).toBeCloseTo(12, 5);
    });

    it('stops at a gap instead of drawing the teleport back to the seed', () => {
        const src = buf(1);
        const dst = buf(1);
        // t=110 sits in the non-gap 100→120 interval; the 0→100 interval is a gap,
        // so the trail must begin where the dot landed (kf@100), never at the seed.
        sampleTrails(ds.tracks, 110, src, dst, cbuf(1), rgb);
        expect(src[0]).toBeCloseTo(21, 5); // kf@100
        expect(src[1]).toBeCloseTo(11, 5);
        // No vertex is the seed home (20, 10).
        for (let k = 0; k < seg; k++) {
            expect(src[k * 2]).not.toBeCloseTo(20, 3);
        }
    });

    it('fades alpha with age and zeroes unused slots', () => {
        const colors = cbuf(1);
        sampleTrails(ds.tracks, 130, buf(1), buf(1), colors, rgb);
        expect(colors[0]).toBe(234); // track RGB carried through
        expect(colors[3]).toBeGreaterThan(colors[1 * 4 + 3]); // seg0 fresher than seg1
        expect(colors[(seg - 1) * 4 + 3]).toBe(0); // last unused slot fully transparent
    });

    it('does not reach back past the trail window', () => {
        const src = buf(1);
        const dst = buf(1);
        // Window ends at t - TRAIL_WINDOW_MIN; with a step of 20 min the kf at
        // exactly the lower edge is the deepest real vertex reached.
        sampleTrails(ds.tracks, 100 + TRAIL_WINDOW_MIN, src, dst, cbuf(1), rgb);
        // Deepest src vertex should not predate the window (lon of kf@100 = 21).
        expect(src[0]).toBeGreaterThanOrEqual(21 - 1e-6);
    });

    it('fills the whole buffer for every track without throwing', () => {
        const n = ds.tracks.length;
        expect(() =>
            sampleTrails(ds.tracks, 500, buf(n), buf(n), cbuf(n), new Uint8Array(n * 3)),
        ).not.toThrow();
    });
});

describe('dayOfYearFraction', () => {
    it('is 0 on Jan 1 and 1 on Dec 31', () => {
        expect(dayOfYearFraction('2024-01-01')).toBe(0);
        expect(dayOfYearFraction('2024-12-31')).toBeCloseTo(1, 5);
    });

    it('reaches roughly mid-year at the start of July', () => {
        expect(dayOfYearFraction('2023-07-02')).toBeCloseTo(0.5, 1);
    });
});

describe('computePercentileBounds', () => {
    it('returns null with no points', () => {
        expect(computePercentileBounds([])).toBeNull();
    });

    it('excludes outliers via the 2nd/98th percentile', () => {
        const n = 100;
        const times = new Float32Array(n);
        const lats = new Float32Array(n);
        const lons = new Float32Array(n);
        for (let i = 0; i < n; i++) {
            times[i] = i;
            lats[i] = 48 + i * 1e-4;
            lons[i] = 2 + i * 1e-4;
        }
        lons[n - 1] = 50; // a single travel-day outlier
        lats[n - 1] = 60;
        const tr: DayTrack = { day: DAY, times, lats, lons, gapAfter: new Uint8Array(n) };
        const bounds = computePercentileBounds([tr]);
        expect(bounds).not.toBeNull();
        const [[, minLat], [maxLon, maxLat]] = bounds!;
        expect(maxLon).toBeLessThan(10);
        expect(maxLat).toBeLessThan(50);
        expect(minLat).toBeGreaterThan(40);
    });
});
