// @vitest-environment node
//
// Headless test of the positions and step-packet import SQL against the real
// DuckDB engine. Both accumulate — a Garmin export and a Google Timeline export
// are imported separately and must end up side by side — so the anti-joins in
// `locationDedupeSql` and `stepPacketsDedupeSql` are the only thing standing
// between a second drop and a doubled table, or between importing a watch and
// losing the phone's history.
import { describe, it, expect, beforeEach, afterAll, beforeAll } from 'vitest';
import {
    openHeadlessDuckDB,
    type HeadlessConnection,
    type HeadlessDuckDB,
} from '../../db/headless.testutil';
import {
    LOCATION_COLUMNS,
    STEPS_COLUMNS,
    stepPacketsDedupeSql,
    locationDedupeSql,
    supersedeSql,
} from '../../db';
import type { LocationSegment } from '#lib/types/positions.ts';
import type { StepPacket } from '#lib/types/steps.ts';

const LOCATION_SCHEMA = `
    source VARCHAR, timestamp TIMESTAMP, date DATE, end_timestamp TIMESTAMP,
    duration_seconds DOUBLE, lat DOUBLE, lon DOUBLE, segment_type VARCHAR,
    activity_type VARCHAR, semantic_type VARCHAR, place_id VARCHAR,
    distance_meters DOUBLE, speed_kmh DOUBLE, azimuth_degrees DOUBLE,
    altitude_m DOUBLE, heart_rate INTEGER, cadence_spm INTEGER, superseded BOOLEAN,
    country VARCHAR, region VARCHAR, department VARCHAR, nearest_city VARCHAR,
    city_km DOUBLE, arrondissement VARCHAR, seg_id INTEGER
`;

const STEPS_SCHEMA = `
    timestamp TIMESTAMP, date DATE, start_timestamp TIMESTAMP,
    steps INTEGER, active_seconds DOUBLE, span_seconds DOUBLE, distance_meters DOUBLE,
    calories DOUBLE, cadence_spm DOUBLE, intensity INTEGER,
    running_steps INTEGER, running_active_seconds DOUBLE, step_id INTEGER
`;

let db: HeadlessDuckDB;
let conn: HeadlessConnection;

function segment(
    source: LocationSegment['source'],
    timestamp: string,
    lat: number,
    lon: number,
    extra: Partial<LocationSegment> = {}
): LocationSegment {
    return {
        source,
        timestamp,
        date: timestamp.slice(0, 10),
        endTimestamp: timestamp,
        durationSeconds: 60,
        lat,
        lon,
        segmentType: 'moving',
        activityType: source === 'garmin' ? 'running' : 'walking',
        semanticType: null,
        placeId: null,
        distanceMeters: 12,
        speedKmh: 10,
        azimuthDegrees: 90,
        altitudeMeters: null,
        heartRate: null,
        cadenceSpm: null,
        ...extra,
    };
}

function packet(timestamp: string, steps: number): StepPacket {
    return {
        timestamp,
        date: timestamp.slice(0, 10),
        startTimestamp: timestamp,
        steps,
        activeSeconds: 60,
        spanSeconds: 120,
        distanceMeters: 40,
        calories: 3,
        cadenceSpm: 90,
        intensity: 4,
        runningSteps: 0,
        runningActiveSeconds: 0,
    };
}

const literal = (v: unknown) =>
    v === null || v === undefined
        ? 'NULL'
        : typeof v === 'string'
          ? `'${v.replace(/'/g, "''")}'`
          : typeof v === 'boolean'
            ? v
                ? 'TRUE'
                : 'FALSE'
            : String(v);

/** Mirrors insertLocationSegments: stage the rows, then anti-join them in. */
function importSegments(batch: LocationSegment[]) {
    conn.query('DROP TABLE IF EXISTS location_segments_incoming');
    conn.query(`CREATE TABLE location_segments_incoming (${LOCATION_SCHEMA})`);
    for (const s of batch) {
        conn.query(
            `INSERT INTO location_segments_incoming (${LOCATION_COLUMNS}) VALUES (${[
                s.source,
                s.timestamp,
                s.date,
                s.endTimestamp,
                s.durationSeconds,
                s.lat,
                s.lon,
                s.segmentType,
                s.activityType,
                s.semanticType,
                s.placeId,
                s.distanceMeters,
                s.speedKmh,
                s.azimuthDegrees,
                s.altitudeMeters,
                s.heartRate,
                s.cadenceSpm,
            ]
                .map(literal)
                .join(', ')})`
        );
    }
    conn.query(locationDedupeSql('location_segments', 'location_segments_incoming'));
    conn.query('DROP TABLE IF EXISTS location_segments_incoming');
    conn.query('UPDATE location_segments SET seg_id = rowid');
}

/** Mirrors insertStepPackets. */
function importPackets(batch: StepPacket[]) {
    conn.query('DROP TABLE IF EXISTS step_packets_incoming');
    conn.query(`CREATE TABLE step_packets_incoming (${STEPS_SCHEMA})`);
    for (const p of batch) {
        conn.query(
            `INSERT INTO step_packets_incoming (${STEPS_COLUMNS}) VALUES (${[
                p.timestamp,
                p.date,
                p.startTimestamp,
                p.steps,
                p.activeSeconds,
                p.spanSeconds,
                p.distanceMeters,
                p.calories,
                p.cadenceSpm,
                p.intensity,
                p.runningSteps,
                p.runningActiveSeconds,
            ]
                .map(literal)
                .join(', ')})`
        );
    }
    conn.query(stepPacketsDedupeSql('step_packets', 'step_packets_incoming'));
    conn.query('DROP TABLE IF EXISTS step_packets_incoming');
    conn.query('UPDATE step_packets SET step_id = rowid');
}

function scalar(sql: string): number {
    const [row] = conn
        .query(sql)
        .toArray()
        .map((r) => r.toJSON());
    return Number(Object.values(row)[0]);
}

const countSegments = (where = '1=1') =>
    scalar(`SELECT COUNT(*) AS n FROM location_segments WHERE ${where}`);
const countPackets = (where = '1=1') =>
    scalar(`SELECT COUNT(*) AS n FROM step_packets WHERE ${where}`);

const TIMELINE = [
    segment('google-timeline', '2026-07-12 08:00:00', 48.8566, 2.3522),
    segment('google-timeline', '2026-07-12 08:01:00', 48.857, 2.3525),
];
const WATCH = [
    segment('garmin', '2026-07-12 18:29:31', 46.8999, 6.9299, { heartRate: 151, cadenceSpm: 162 }),
    segment('garmin', '2026-07-12 18:29:37', 46.9001, 6.9301, { heartRate: 153, cadenceSpm: 162 }),
];

beforeAll(async () => {
    ({ db, conn } = await openHeadlessDuckDB());
});

beforeEach(() => {
    conn.query('DROP TABLE IF EXISTS location_segments');
    conn.query(`CREATE TABLE location_segments (${LOCATION_SCHEMA})`);
    conn.query('DROP TABLE IF EXISTS step_packets');
    conn.query(`CREATE TABLE step_packets (${STEPS_SCHEMA})`);
});

afterAll(() => {
    conn?.close();
    db?.terminate?.();
});

describe('incremental positions import', () => {
    it('stores what it is given', () => {
        importSegments(TIMELINE);
        expect(countSegments()).toBe(2);
    });

    it('re-importing the same export changes nothing', () => {
        importSegments(TIMELINE);
        importSegments(TIMELINE);
        expect(countSegments()).toBe(2);
    });

    /** The whole point of the shared table: a watch joins the phone, not replaces it. */
    it('lets a watch and a phone share the table', () => {
        importSegments(TIMELINE);
        importSegments(WATCH);

        expect(countSegments()).toBe(4);
        expect(countSegments("source = 'google-timeline'")).toBe(2);
        expect(countSegments("source = 'garmin'")).toBe(2);
    });

    it('re-importing one provider leaves the other alone', () => {
        importSegments(TIMELINE);
        importSegments(WATCH);
        importSegments(WATCH);

        expect(countSegments("source = 'google-timeline'")).toBe(2);
        expect(countSegments("source = 'garmin'")).toBe(2);
    });

    /**
     * The providers record the same walk at different rates, so a coincidence of
     * second and position is still two separate observations — which is why
     * `source` leads the key.
     */
    it('keeps two providers’ readings of the same instant and place apart', () => {
        importSegments([
            segment('google-timeline', '2026-07-12 08:00:00', 48.8566, 2.3522),
            segment('garmin', '2026-07-12 08:00:00', 48.8566, 2.3522),
        ]);

        expect(countSegments()).toBe(2);
    });

    it('collapses a fix repeated within one drop', () => {
        // A watch standing still writes the same position again and again.
        importSegments([
            segment('garmin', '2026-07-12 18:29:31', 46.8999, 6.9299),
            segment('garmin', '2026-07-12 18:29:31', 46.8999, 6.9299),
        ]);

        expect(countSegments()).toBe(1);
    });

    it('keeps a stationary watch’s successive seconds', () => {
        importSegments([
            segment('garmin', '2026-07-12 18:29:31', 46.8999, 6.9299),
            segment('garmin', '2026-07-12 18:29:32', 46.8999, 6.9299),
        ]);

        expect(countSegments()).toBe(2);
    });

    it('gives every stored row a stable key', () => {
        importSegments(TIMELINE);
        importSegments(WATCH);

        expect(scalar('SELECT COUNT(DISTINCT seg_id) AS n FROM location_segments')).toBe(4);
    });

    it('round-trips the sensor columns only a watch fills in', () => {
        importSegments(WATCH);

        expect(
            scalar(
                "SELECT heart_rate FROM location_segments WHERE timestamp = '2026-07-12 18:29:31'"
            )
        ).toBe(151);
        expect(scalar('SELECT COUNT(*) AS n FROM location_segments WHERE heart_rate IS NULL')).toBe(
            0
        );
    });

    it('leaves the geo columns for the background attribution to fill', () => {
        importSegments(TIMELINE);

        expect(scalar('SELECT COUNT(*) AS n FROM location_segments WHERE country IS NULL')).toBe(2);
    });
});

/**
 * Two providers record the same life at different resolutions. Stacking them raw
 * gives a timeline saying you were in two places at once, so the data layer
 * resolves the overlap once — minute by minute, watch wins — and every view
 * reads the result through the `positions` view.
 */
describe('provider precedence', () => {
    const supersede = () => conn.query(supersedeSql('location_segments'));

    const active = () =>
        conn
            .query(
                `SELECT source, timestamp FROM location_segments
                    WHERE superseded IS NOT TRUE ORDER BY timestamp`
            )
            .toArray()
            .map((r) => r.toJSON());

    it('drops a phone point for a minute the watch was recording', () => {
        importSegments([
            segment('google-timeline', '2026-07-12 18:29:00', 48.85, 2.35),
            segment('garmin', '2026-07-12 18:29:31', 46.89, 6.92),
        ]);
        supersede();

        const rows = active();
        expect(rows).toHaveLength(1);
        expect(rows[0].source).toBe('garmin');
    });

    /** The whole point: the timeline stays continuous around the activity. */
    it('keeps the phone either side of a recorded stretch', () => {
        importSegments([
            segment('google-timeline', '2026-07-12 18:00:00', 48.85, 2.35),
            segment('google-timeline', '2026-07-12 18:29:00', 48.86, 2.36),
            segment('garmin', '2026-07-12 18:29:31', 46.89, 6.92),
            segment('garmin', '2026-07-12 18:30:05', 46.89, 6.93),
            segment('google-timeline', '2026-07-12 19:00:00', 48.87, 2.37),
        ]);
        supersede();

        expect(active().map((r) => r.source)).toEqual([
            'google-timeline', // 18:00, untouched
            'garmin', //          18:29, the phone's minute is superseded
            'garmin', //          18:30
            'google-timeline', // 19:00, back to the phone
        ]);
    });

    it('never supersedes the watch', () => {
        importSegments([
            segment('garmin', '2026-07-12 18:29:31', 46.89, 6.92),
            segment('garmin', '2026-07-12 18:29:45', 46.89, 6.93),
        ]);
        supersede();

        expect(active()).toHaveLength(2);
    });

    /**
     * The same outing, twice: the watch writes the file and Strava receives a
     * copy of it. Only the watch's own file kept the offset it was set to, so
     * that is the one the day is read off.
     */
    it('keeps the watch’s own file over Strava’s copy of it', () => {
        importSegments([
            segment('strava', '2026-07-12 18:29:31', 46.89, 6.92),
            segment('garmin', '2026-07-12 18:29:35', 46.89, 6.93),
        ]);
        supersede();

        expect(active().map((r) => r.source)).toEqual(['garmin']);
    });

    /** A track is a track: a Strava recording outranks the phone just the same. */
    it('drops a phone point for a minute Strava was recording', () => {
        importSegments([
            segment('google-timeline', '2026-07-12 18:29:00', 48.85, 2.35),
            segment('strava', '2026-07-12 18:29:31', 46.89, 6.92),
            segment('google-timeline', '2026-07-12 19:00:00', 48.87, 2.37),
        ]);
        supersede();

        expect(active().map((r) => r.source)).toEqual(['strava', 'google-timeline']);
    });

    it('changes nothing at all without a watch import', () => {
        importSegments(TIMELINE);
        supersede();

        expect(active()).toHaveLength(2);
    });

    /**
     * Recomputed over the whole table, never incrementally: a Garmin export
     * arriving second has to supersede the Timeline already loaded.
     */
    it('supersedes a Timeline imported before the watch', () => {
        importSegments([segment('google-timeline', '2026-07-12 18:29:00', 48.85, 2.35)]);
        supersede();
        expect(active()).toHaveLength(1);

        importSegments([segment('garmin', '2026-07-12 18:29:31', 46.89, 6.92)]);
        supersede();

        expect(active().map((r) => r.source)).toEqual(['garmin']);
    });

    it('restores a minute the watch no longer covers', () => {
        importSegments([
            segment('google-timeline', '2026-07-12 18:29:00', 48.85, 2.35),
            segment('garmin', '2026-07-12 18:29:31', 46.89, 6.92),
        ]);
        supersede();
        expect(active()).toHaveLength(1);

        // The watch's rows go, as removing the Garmin source would take them.
        conn.query("DELETE FROM location_segments WHERE source = 'garmin'");
        supersede();

        expect(active().map((r) => r.source)).toEqual(['google-timeline']);
    });

    it('serves the resolved set through the view every read uses', () => {
        importSegments([
            segment('google-timeline', '2026-07-12 18:29:00', 48.85, 2.35),
            segment('google-timeline', '2026-07-12 19:00:00', 48.87, 2.37),
            segment('garmin', '2026-07-12 18:29:31', 46.89, 6.92),
        ]);
        supersede();
        conn.query(
            'CREATE OR REPLACE VIEW positions AS SELECT * FROM location_segments WHERE superseded IS NOT TRUE'
        );

        expect(scalar('SELECT COUNT(*) AS n FROM positions')).toBe(2);
        expect(scalar('SELECT COUNT(*) AS n FROM location_segments')).toBe(3);
    });
});

describe('incremental step-packet import', () => {
    const DAY = [packet('2026-07-12 08:00:00', 200), packet('2026-07-12 09:00:00', 320)];

    it('stores what it is given', () => {
        importPackets(DAY);
        expect(countPackets()).toBe(2);
    });

    it('re-importing the same export changes nothing', () => {
        importPackets(DAY);
        importPackets(DAY);
        expect(countPackets()).toBe(2);
    });

    it('collapses a packet repeated within one drop', () => {
        // Monitoring files overlap, so the same reading arrives several times.
        importPackets([packet('2026-07-12 08:00:00', 200), packet('2026-07-12 08:00:00', 200)]);

        expect(countPackets()).toBe(1);
    });

    it('accumulates a second export instead of replacing the first', () => {
        importPackets(DAY);
        importPackets([packet('2026-07-13 08:00:00', 150)]);

        expect(countPackets()).toBe(3);
        expect(scalar('SELECT SUM(steps) AS n FROM step_packets')).toBe(670);
    });

    it('gives every stored row a stable key', () => {
        importPackets(DAY);
        expect(scalar('SELECT COUNT(DISTINCT step_id) AS n FROM step_packets')).toBe(2);
    });

    it('keeps the active duration apart from the window it sits in', () => {
        importPackets([packet('2026-07-12 08:00:00', 200)]);

        expect(scalar('SELECT active_seconds FROM step_packets')).toBe(60);
        expect(scalar('SELECT span_seconds FROM step_packets')).toBe(120);
    });
});
