import { describe, it, expect } from 'vitest';
import {
    buildDayTraces,
    buildActivityTraces,
    clusterOrigins,
    clockAt,
    snapOrigins,
    ORIGIN_SNAP_M,
    computeReach,
    hasContinuousRows,
    hasEpisodicRows,
    progressOf,
    samplePos,
    sampleHeads,
    type RelativeTrack,
} from './relativeTraces';
import {
    ACTIVITY_OTHER,
    type DayRaceSegmentRows,
    type DayRecord,
} from '#lib/data/queries/positionsQueries.ts';

const DAY = '2024-01-02';
const ANCHOR = Date.UTC(2024, 0, 2, 4); // the 04:00 anchor of the logical day
const at = (min: number) => ANCHOR + min * 60000;

// 0.01° of latitude is near enough 1105.7 m. Kept round so the metre offsets the
// assertions read are obvious rather than reverse-engineered.
const HOME_LAT = 48.85;
const HOME_LON = 2.35;
const DEG_LAT_M = 1105.7;

interface Seg {
    tStart: number; // clock-minutes since 04:00
    tEnd?: number; // defaults to tStart, which for a watch ends its activity
    lat: number;
    lon: number;
    stationary?: boolean;
    garmin?: boolean;
    activity?: number;
}

function mkRows(segs: Seg[]): DayRaceSegmentRows {
    return {
        numRows: segs.length,
        startMs: segs.map((s) => at(s.tStart)),
        endMs: segs.map((s) => at(s.tEnd ?? s.tStart)),
        lat: segs.map((s) => s.lat),
        lon: segs.map((s) => s.lon),
        isStationary: segs.map((s) => (s.stationary ? 1 : 0)),
        isGarmin: segs.map((s) => (s.garmin ? 1 : 0)),
        isContinuous: segs.map((s) => (s.garmin ? 0 : 1)),
        activity: segs.map((s) => s.activity ?? ACTIVITY_OTHER),
    };
}

function mkDay(day: string, lat: number, lon: number, city = 'Paris'): DayRecord {
    return {
        day,
        startPlaceId: '',
        startSemanticType: 'Unknown',
        startLat: lat,
        startLon: lon,
        startCity: city,
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

const paris = mkDay(DAY, HOME_LAT, HOME_LON);

/** Fake tracks for the pure helpers that only read a few fields. */
const fakeTracks = (
    parts: Array<{ originLat: number; originLon: number; startCity: string }>
): RelativeTrack[] => parts as unknown as RelativeTrack[];

describe('buildDayTraces', () => {
    /**
     * The old anchor was the position at 04:00, which the day record only knows
     * when a visit spanned the night — otherwise it interpolates between the two
     * points either side, a place nobody was. Every trace started at its own
     * guess, scattered around the middle, instead of at the middle.
     */
    it('starts at the day’s first recorded point, dead centre', () => {
        const [tr] = buildDayTraces(
            mkRows([
                { tStart: 300, lat: HOME_LAT, lon: HOME_LON },
                { tStart: 320, lat: HOME_LAT + 0.01, lon: HOME_LON },
            ]),
            // A record whose 04:00 guess is nowhere near the first real fix.
            [mkDay(DAY, HOME_LAT + 3, HOME_LON + 3)]
        ).tracks;

        expect(tr.xs[0]).toBe(0);
        expect(tr.ys[0]).toBe(0);
        expect(tr.originLat).toBe(HOME_LAT);
        expect(tr.originLon).toBe(HOME_LON);
    });

    /** Where a trace sits on the clock has to keep saying what time it was. */
    it('keeps time on the clock of the day, not from the first point', () => {
        const [tr] = buildDayTraces(
            mkRows([
                { tStart: 300, lat: HOME_LAT, lon: HOME_LON },
                { tStart: 320, lat: HOME_LAT + 0.01, lon: HOME_LON },
            ]),
            [paris]
        ).tracks;

        expect([...tr.times]).toEqual([300, 320]);
    });

    it('runs a 24-hour clock at one speed', () => {
        const ds = buildDayTraces(
            mkRows([
                { tStart: 300, lat: HOME_LAT, lon: HOME_LON },
                { tStart: 320, lat: HOME_LAT + 0.01, lon: HOME_LON },
            ]),
            [paris]
        );

        expect(ds.span).toBe(1440);
        expect(ds.knee).toBeNull();
        expect(ds.timeBase).toBe('time-of-day');
    });

    it('measures east–west in metres, shrunk by the latitude', () => {
        const [tr] = buildDayTraces(
            mkRows([
                { tStart: 300, lat: HOME_LAT, lon: HOME_LON },
                { tStart: 320, lat: HOME_LAT, lon: HOME_LON + 0.01 },
            ]),
            [paris]
        ).tracks;

        // 0.01° of longitude at 48.85°N ≈ 1113.2 × cos(48.85) ≈ 732 m.
        expect(tr.xs[1]).toBeCloseTo(1113.2 * Math.cos((HOME_LAT * Math.PI) / 180), 0);
    });

    it('leaves the watch’s rows to the other builder', () => {
        const ds = buildDayTraces(
            mkRows([
                { tStart: 300, lat: HOME_LAT, lon: HOME_LON, garmin: true },
                { tStart: 320, lat: HOME_LAT + 0.01, lon: HOME_LON, garmin: true },
            ]),
            [paris]
        );

        expect(ds.tracks).toHaveLength(0);
    });

    /**
     * Google labels the semantic leg, not the raw path points that trace its
     * shape — a walk is one typed row spanning fifty untyped ones.
     */
    it('lends a labelled leg its type to the untyped points inside it', () => {
        const [tr] = buildDayTraces(
            mkRows([
                { tStart: 300, tEnd: 360, lat: HOME_LAT, lon: HOME_LON, activity: 3 },
                { tStart: 310, lat: HOME_LAT + 0.001, lon: HOME_LON },
                { tStart: 350, lat: HOME_LAT + 0.002, lon: HOME_LON },
                { tStart: 400, lat: HOME_LAT + 0.003, lon: HOME_LON },
            ]),
            [paris]
        ).tracks;

        expect([...tr.activity]).toEqual([3, 3, 3, ACTIVITY_OTHER]);
    });

    it('marks a tracking gap so the jump is never drawn as a path', () => {
        const [tr] = buildDayTraces(
            mkRows([
                { tStart: 10, lat: HOME_LAT, lon: HOME_LON },
                // 290 minutes later: well past the 45-minute gap threshold.
                { tStart: 300, lat: HOME_LAT + 0.5, lon: HOME_LON },
                { tStart: 320, lat: HOME_LAT + 0.5, lon: HOME_LON },
            ]),
            [paris]
        ).tracks;

        expect([...tr.gapAfter]).toEqual([1, 0, 0]);
    });

    it('drops a day with a single point, which has no shape at all', () => {
        const ds = buildDayTraces(mkRows([{ tStart: 300, lat: HOME_LAT, lon: HOME_LON }]), [paris]);
        expect(ds.tracks).toHaveLength(0);
    });
});

describe('buildActivityTraces', () => {
    /** The parser writes end == start on the last fix of a .fit file. */
    it('cuts one trace per activity on the terminal fix', () => {
        const ds = buildActivityTraces(
            mkRows([
                { tStart: 420, tEnd: 421, lat: HOME_LAT, lon: HOME_LON, garmin: true },
                { tStart: 421, tEnd: 422, lat: HOME_LAT + 0.01, lon: HOME_LON, garmin: true },
                // end == start: the morning run is over.
                { tStart: 422, lat: HOME_LAT + 0.02, lon: HOME_LON, garmin: true },
                { tStart: 430, tEnd: 431, lat: HOME_LAT + 1, lon: HOME_LON, garmin: true },
                { tStart: 431, lat: HOME_LAT + 1.01, lon: HOME_LON, garmin: true },
            ])
        );

        expect(ds.tracks.map((t) => t.key)).toEqual([`${DAY}#1`, `${DAY}#2`]);
    });

    it('starts every activity at zero, at the centre', () => {
        const ds = buildActivityTraces(
            mkRows([
                { tStart: 420, tEnd: 421, lat: HOME_LAT, lon: HOME_LON, garmin: true },
                { tStart: 450, lat: HOME_LAT + 0.01, lon: HOME_LON, garmin: true },
                { tStart: 1100, tEnd: 1101, lat: HOME_LAT + 1, lon: HOME_LON, garmin: true },
                { tStart: 1120, lat: HOME_LAT + 1.01, lon: HOME_LON, garmin: true },
            ])
        );

        for (const tr of ds.tracks) {
            expect(tr.times[0]).toBe(0);
            expect(tr.xs[0]).toBe(0);
            expect(tr.ys[0]).toBe(0);
        }
        // An evening outing and a morning one now lie on top of each other.
        expect([...ds.tracks[0].times]).toEqual([0, 30]);
        expect([...ds.tracks[1].times]).toEqual([0, 20]);
        expect(ds.timeBase).toBe('elapsed');
    });

    /** A watch that has been off for the afternoon has ended its activity. */
    it('also breaks on a long silence, for exports without the marker', () => {
        const ds = buildActivityTraces(
            mkRows([
                { tStart: 420, tEnd: 421, lat: HOME_LAT, lon: HOME_LON, garmin: true },
                { tStart: 450, tEnd: 451, lat: HOME_LAT + 0.01, lon: HOME_LON, garmin: true },
                // 10 hours later, with no terminal marker in sight.
                { tStart: 1050, tEnd: 1051, lat: HOME_LAT + 1, lon: HOME_LON, garmin: true },
                { tStart: 1080, tEnd: 1081, lat: HOME_LAT + 1.01, lon: HOME_LON, garmin: true },
            ])
        );

        expect(ds.tracks).toHaveLength(2);
    });

    it('leaves the phone’s rows to the other builder', () => {
        const ds = buildActivityTraces(
            mkRows([
                { tStart: 300, lat: HOME_LAT, lon: HOME_LON },
                { tStart: 320, lat: HOME_LAT + 0.01, lon: HOME_LON },
            ])
        );

        expect(ds.tracks).toHaveLength(0);
    });

    /**
     * The clock has to reach the longest outing without every ordinary one
     * finishing in the first tenth of the bar.
     */
    it('puts a knee at the 98th percentile when the tail is long', () => {
        const short = Array.from({ length: 20 }, (_, i) => [
            { tStart: i * 60, tEnd: i * 60 + 1, lat: HOME_LAT, lon: HOME_LON, garmin: true },
            { tStart: i * 60 + 20, lat: HOME_LAT + 0.01, lon: HOME_LON, garmin: true },
        ]).flat();
        // One eight-hour hike, sampled every half hour — a watch records far
        // more often than that, and anything sparser would read as it being off.
        const hike = Array.from({ length: 17 }, (_, i) => ({
            tStart: 1300 + i * 30,
            tEnd: i === 16 ? undefined : 1301 + i * 30,
            lat: HOME_LAT + i * 0.01,
            lon: HOME_LON,
            garmin: true,
        }));
        const ds = buildActivityTraces(mkRows([...short, ...hike]));

        expect(ds.span).toBe(480);
        expect(ds.knee).not.toBeNull();
        expect(ds.knee!.min).toBeLessThan(480);
    });

    it('runs one speed when nothing is unusually long', () => {
        const ds = buildActivityTraces(
            mkRows([
                { tStart: 420, tEnd: 421, lat: HOME_LAT, lon: HOME_LON, garmin: true },
                { tStart: 450, lat: HOME_LAT + 0.01, lon: HOME_LON, garmin: true },
                { tStart: 1100, tEnd: 1101, lat: HOME_LAT + 1, lon: HOME_LON, garmin: true },
                { tStart: 1128, lat: HOME_LAT + 1.01, lon: HOME_LON, garmin: true },
            ])
        );

        expect(ds.knee).toBeNull();
    });
});

describe('the clock', () => {
    const knee = { min: 30, at: 0.8 };

    it('runs straight through with no knee', () => {
        expect(clockAt(0.5, 100, null)).toBe(50);
        expect(progressOf(50, 100, null)).toBe(0.5);
    });

    it('spends most of the playhead below the knee', () => {
        // 80% of the bar covers the first 30 of 100 minutes.
        expect(clockAt(0.8, 100, knee)).toBeCloseTo(30, 6);
        expect(clockAt(0.4, 100, knee)).toBeCloseTo(15, 6);
        // The last 20% covers the remaining 70.
        expect(clockAt(0.9, 100, knee)).toBeCloseTo(65, 6);
        expect(clockAt(1, 100, knee)).toBeCloseTo(100, 6);
    });

    it('inverts exactly, so playing and dragging agree', () => {
        for (const p of [0, 0.13, 0.5, 0.8, 0.95, 1]) {
            expect(progressOf(clockAt(p, 100, knee), 100, knee)).toBeCloseTo(p, 6);
        }
    });

    it('ignores a knee that is not actually inside the span', () => {
        expect(clockAt(0.5, 100, { min: 100, at: 0.8 })).toBe(50);
        expect(clockAt(0.5, 100, { min: 0, at: 0.8 })).toBe(50);
    });
});

describe('samplePos', () => {
    const [tr] = buildDayTraces(
        mkRows([
            { tStart: 60, lat: HOME_LAT, lon: HOME_LON },
            { tStart: 90, lat: HOME_LAT + 0.01, lon: HOME_LON },
        ]),
        [paris]
    ).tracks;

    it('interpolates between two keyframes', () => {
        const out: [number, number] = [0, 0];
        samplePos(tr, 75, out);
        expect(out[1]).toBeCloseTo(DEG_LAT_M / 2, 0);
    });

    it('holds at the origin before the trace has started', () => {
        const out: [number, number] = [0, 0];
        samplePos(tr, 0, out);
        expect(out).toEqual([0, 0]);
    });

    it('holds at the last keyframe once the trace is done', () => {
        const out: [number, number] = [0, 0];
        samplePos(tr, 1000, out);
        expect(out[1]).toBeCloseTo(DEG_LAT_M, 0);
    });
});

describe('sampleHeads', () => {
    const rows = mkRows([
        { tStart: 60, lat: HOME_LAT, lon: HOME_LON, activity: 0 },
        { tStart: 90, lat: HOME_LAT + 0.01, lon: HOME_LON },
    ]);

    function heads(t: number) {
        const { tracks } = buildDayTraces(rows, [paris]);
        const xy = new Float32Array(tracks.length * 2);
        const seg = new Int32Array(tracks.length);
        const alive = new Uint8Array(tracks.length);
        sampleHeads(tracks, t, xy, seg, alive);
        return { tracks, xy, seg, alive };
    }

    it('reports a trace as alive while the clock is inside it', () => {
        expect(heads(75).alive[0]).toBe(1);
    });

    it('reports a trace as done once the clock passes its last keyframe', () => {
        expect(heads(600).alive[0]).toBe(0);
    });

    /** The leg, not a colour: the renderer decides what a leg is worth. */
    it('reports the keyframe the head is travelling from', () => {
        const { tracks, seg } = heads(75);
        expect(seg[0]).toBe(0);
        expect(tracks[0].activity[seg[0]]).toBe(0);
    });

    it('puts the head where samplePos does', () => {
        expect(heads(75).xy[1]).toBeCloseTo(DEG_LAT_M / 2, 0);
    });
});

describe('snapOrigins', () => {
    /**
     * A track of two points: its origin, and `endM` metres north of that origin
     * — which is how the builders write them, everything relative to the fix
     * the trace started from.
     */
    const mkTrack = (key: string, lat: number, lon: number, endM = 1000): RelativeTrack => ({
        key,
        day: DAY,
        times: new Float32Array([0, 10]),
        xs: new Float32Array([0, 0]),
        ys: new Float32Array([0, endM]),
        gapAfter: new Uint8Array([0, 0]),
        activity: new Uint8Array([ACTIVITY_OTHER, ACTIVITY_OTHER]),
        originLat: lat,
        originLon: lon,
        startCity: 'Unknown',
    });

    /** Metres of latitude, near enough, for readable offsets. */
    const north = (m: number) => m / 110_574;

    it('puts origins within the radius onto one shared centre', () => {
        const a = mkTrack('a', HOME_LAT, HOME_LON);
        const b = mkTrack('b', HOME_LAT + north(60), HOME_LON);
        snapOrigins([a, b]);

        expect(a.originLat).toBeCloseTo(b.originLat, 12);
        expect(a.originLon).toBeCloseTo(b.originLon, 12);
        // The centroid of the two.
        expect(a.originLat).toBeCloseTo(HOME_LAT + north(30), 9);
    });

    /**
     * The whole point. Two mornings from the same doorstep that walked to the
     * same corner: the fixes they started from are 60 m apart, so measured each
     * from its own origin they disagree about where that corner is by 60 m —
     * the shared destination lands in two places. On a common centre they land
     * on one.
     */
    it('brings traces from one place into a common frame', () => {
        const a = mkTrack('a', HOME_LAT, HOME_LON, 1000);
        // Started 60 m further north, so the same corner is 60 m nearer.
        const b = mkTrack('b', HOME_LAT + north(60), HOME_LON, 940);
        snapOrigins([a, b]);

        expect(a.ys[1]).toBeCloseTo(b.ys[1], 3);
        expect(a.ys[1]).toBeCloseTo(970, 0);
    });

    /**
     * Moving the frame has to move every point of a trace by the same amount:
     * the error was never at the origin, it slid the whole trace sideways.
     */
    it('shifts a trace whole, keeping its shape exactly', () => {
        const a = mkTrack('a', HOME_LAT, HOME_LON);
        const b = mkTrack('b', HOME_LAT + north(60), HOME_LON);
        snapOrigins([a, b]);

        // Each first point now sits at its own real offset from the centre…
        expect(a.ys[0]).toBeCloseTo(-30, 0);
        expect(b.ys[0]).toBeCloseTo(30, 0);
        // …and each trace still measures exactly what it did before.
        expect(a.ys[1] - a.ys[0]).toBeCloseTo(1000, 3);
        expect(b.ys[1] - b.ys[0]).toBeCloseTo(1000, 3);
    });

    it('leaves a genuinely different place alone', () => {
        const a = mkTrack('a', HOME_LAT, HOME_LON);
        const far = mkTrack('far', HOME_LAT + north(5000), HOME_LON);
        snapOrigins([a, far]);

        expect(a.originLat).toBe(HOME_LAT);
        expect(far.ys[0]).toBe(0);
    });

    it('leaves a lone origin exactly where it is', () => {
        const a = mkTrack('a', HOME_LAT, HOME_LON);
        snapOrigins([a]);
        expect(a.originLat).toBe(HOME_LAT);
        expect(a.ys[0]).toBe(0);
    });

    /**
     * Leader clustering, not single-link: a chain of fixes down a street must
     * not merge into one group wider than the radius it was asked for.
     */
    it('never builds a cluster wider than twice the radius', () => {
        const chain = Array.from({ length: 10 }, (_, i) =>
            mkTrack(`t${i}`, HOME_LAT + north(i * 60), HOME_LON)
        );
        snapOrigins(chain);

        const centres = new Set(chain.map((t) => t.originLat));
        expect(centres.size).toBeGreaterThan(1);
        for (const t of chain) {
            // Its own first point never ends up further than the radius away.
            expect(Math.hypot(t.xs[0], t.ys[0])).toBeLessThanOrEqual(ORIGIN_SNAP_M);
        }
    });

    it('centres a group on the mean of the origins it holds', () => {
        const offsets = [0, 20, 40, 60];
        const group = offsets.map((m, i) => mkTrack(`t${i}`, HOME_LAT + north(m), HOME_LON));
        snapOrigins(group);

        const mean = HOME_LAT + north(offsets.reduce((a, b) => a + b, 0) / offsets.length);
        for (const t of group) expect(t.originLat).toBeCloseTo(mean, 9);
    });

    it('is not sensitive to the order the traces arrive in', () => {
        const build = () => [
            mkTrack('a', HOME_LAT, HOME_LON),
            mkTrack('b', HOME_LAT + north(60), HOME_LON),
            mkTrack('c', HOME_LAT + north(40), HOME_LON),
        ];
        const forward = build();
        const backward = build().reverse();
        snapOrigins(forward);
        snapOrigins(backward);

        const centres = (ts: RelativeTrack[]) => new Map(ts.map((t) => [t.key, t.originLat]));
        expect(centres(forward)).toEqual(centres(backward));
    });
});

describe('clusterOrigins', () => {
    it('groups traces that started within the same couple of kilometres', () => {
        const { clusters, byTrack } = clusterOrigins(
            fakeTracks([
                { originLat: HOME_LAT, originLon: HOME_LON, startCity: 'Paris' },
                // ~110 m away: the same home, a different fix.
                { originLat: HOME_LAT + 0.001, originLon: HOME_LON, startCity: 'Paris' },
                // Half a degree away: somewhere else entirely.
                { originLat: HOME_LAT + 0.5, originLon: HOME_LON, startCity: 'Rouen' },
            ])
        );

        expect(clusters[0]).toEqual({ label: 'Paris', days: 2 });
        expect(byTrack[0]).toBe(byTrack[1]);
        expect(byTrack[2]).not.toBe(byTrack[0]);
    });

    it('falls back to coordinates when no city was attributed', () => {
        const { clusters } = clusterOrigins(
            fakeTracks([{ originLat: 12.5, originLon: -3.25, startCity: 'Unknown' }])
        );
        expect(clusters[0].label).toBe('12.50, -3.25');
    });

    it('collapses everything past the cap into one Elsewhere', () => {
        const { clusters, byTrack, hasElsewhere } = clusterOrigins(
            fakeTracks(
                Array.from({ length: 5 }, (_, i) => ({
                    originLat: i,
                    originLon: 0,
                    startCity: `City ${i}`,
                }))
            ),
            2
        );

        expect(hasElsewhere).toBe(true);
        expect(clusters).toHaveLength(3);
        expect(clusters[2]).toEqual({ label: 'Elsewhere', days: 3 });
        expect([...byTrack].filter((b) => b === 2)).toHaveLength(3);
    });

    it('leaves out Elsewhere when every trace fits', () => {
        const { clusters, hasElsewhere } = clusterOrigins(
            fakeTracks([
                { originLat: 0, originLon: 0, startCity: 'A' },
                { originLat: 1, originLon: 0, startCity: 'B' },
            ]),
            6
        );

        expect(hasElsewhere).toBe(false);
        expect(clusters.map((c) => c.label)).toEqual(['A', 'B']);
    });
});

describe('borrowing a place name', () => {
    it('takes the day record’s city when it describes where the trace began', () => {
        const [tr] = buildDayTraces(
            mkRows([
                { tStart: 300, lat: HOME_LAT, lon: HOME_LON },
                { tStart: 320, lat: HOME_LAT + 0.01, lon: HOME_LON },
            ]),
            [paris]
        ).tracks;

        expect(tr.startCity).toBe('Paris');
    });

    /**
     * The record's start is the 04:00 position, which the trace no longer uses
     * and which is often interpolated between two far points. Repeating its name
     * would put a bedroom's city on a forest car park.
     */
    it('drops it when it describes somewhere else', () => {
        const [tr] = buildDayTraces(
            mkRows([
                { tStart: 300, lat: HOME_LAT, lon: HOME_LON },
                { tStart: 320, lat: HOME_LAT + 0.01, lon: HOME_LON },
            ]),
            [mkDay(DAY, HOME_LAT + 1, HOME_LON, 'Nowhere')]
        ).tracks;

        expect(tr.startCity).toBe('Unknown');
    });
});

describe('computeReach', () => {
    it('is the 98th percentile of the distance from the origin, not the maximum', () => {
        const near = Array.from({ length: 99 }, (_, i) => ({
            tStart: i + 1,
            lat: HOME_LAT + 0.001,
            lon: HOME_LON,
        }));
        const { tracks } = buildDayTraces(
            mkRows([
                { tStart: 0, lat: HOME_LAT, lon: HOME_LON },
                ...near,
                { tStart: 200, lat: HOME_LAT + 5, lon: HOME_LON },
            ]),
            [paris]
        );

        // One flight of 500 km must not shrink an ordinary 110 m day to a dot.
        expect(computeReach(tracks)).toBeLessThan(1000);
    });

    it('never returns zero, so a flat dataset still has a scale', () => {
        const { tracks } = buildDayTraces(
            mkRows([
                { tStart: 300, lat: HOME_LAT, lon: HOME_LON },
                { tStart: 320, lat: HOME_LAT, lon: HOME_LON },
            ]),
            [paris]
        );

        expect(computeReach(tracks)).toBeGreaterThan(0);
    });
});

describe('which plots have anything to show', () => {
    it('tells the two kinds of row apart', () => {
        const phone = mkRows([{ tStart: 1, lat: HOME_LAT, lon: HOME_LON }]);
        const watch = mkRows([{ tStart: 1, lat: HOME_LAT, lon: HOME_LON, garmin: true }]);

        expect(hasContinuousRows(phone)).toBe(true);
        expect(hasEpisodicRows(phone)).toBe(false);
        expect(hasContinuousRows(watch)).toBe(false);
        expect(hasEpisodicRows(watch)).toBe(true);
    });
});
