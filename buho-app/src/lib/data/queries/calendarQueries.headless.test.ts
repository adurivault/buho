// @vitest-environment node
//
// Headless test of the calendar's SQL against the real engine.
//
// Every table is created from its own staging spec and positions are read
// through the real `positions` view, so the queries meet the schemas the app
// ships. `../db` keeps its real exports; only `query` and `tableExists` are
// swapped for the Node connection.
//
// The fixtures are invented and written as wall-clock strings, the way the app
// stores them, so nothing here depends on the machine's timezone.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import {
    headlessQuery,
    openHeadlessDuckDB,
    type HeadlessConnection,
    type HeadlessDuckDB,
} from '../db/headless.testutil';
import {
    GOOGLE_ACTIVITY_TABLE,
    HEALTH_READINGS_TABLE,
    LOCATION_SEGMENTS_TABLE,
    MESSAGES_TABLE,
    PLAYS_TABLE,
    POSITIONS_VIEW_SQL,
    STEP_PACKETS_TABLE,
    supersedeSql,
} from '../db';
import type { ModuleId } from '#lib/data/modules.ts';
import { rampFor } from '#lib/visualizations/healthRamp.ts';
import {
    getDayTimeline,
    getHeartRateStops,
    getYearData,
    getYearQuarters,
    getYearSummaries,
    type LoadedModules,
} from './calendarQueries';

const runQuery = vi.hoisted(() => vi.fn());
const tableExists = vi.hoisted(() => vi.fn());
vi.mock('../db', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../db')>()),
    query: runQuery,
    tableExists,
}));

let db: HeadlessDuckDB;
let conn: HeadlessConnection;

const ALL: LoadedModules = {
    listening: true,
    positions: true,
    messages: true,
    activity: true,
    steps: true,
    health: true,
};

const only = (...modules: ModuleId[]): LoadedModules => ({
    listening: modules.includes('listening'),
    positions: modules.includes('positions'),
    messages: modules.includes('messages'),
    activity: modules.includes('activity'),
    steps: modules.includes('steps'),
    health: modules.includes('health'),
});

const literal = (v: unknown) =>
    v === null || v === undefined
        ? 'NULL'
        : typeof v === 'string'
          ? `'${v.replace(/'/g, "''")}'`
          : typeof v === 'boolean'
            ? String(v).toUpperCase()
            : String(v);

/** Insert rows naming their columns, so a column the schema lost fails loudly. */
function insert(table: string, rows: Record<string, unknown>[]): void {
    const columns = Object.keys(rows[0]);
    const values = rows
        .map((row) => `(${columns.map((column) => literal(row[column])).join(', ')})`)
        .join(',\n');
    conn.query(`INSERT INTO ${table} (${columns.join(', ')}) VALUES ${values}`);
}

const play = (at: string, source: string, msPlayed: number | null, track = 'Low Light') => ({
    source,
    timestamp: at,
    date: at.slice(0, 10),
    ms_played: msPlayed,
    track_name: track,
    artist_name: 'Marée Basse',
});

const segment = (
    source: string,
    from: string,
    to: string,
    kind: 'stationary' | 'moving',
    extra: Record<string, unknown> = {}
) => ({
    source,
    timestamp: from,
    date: from.slice(0, 10),
    end_timestamp: to,
    lat: 45.76,
    lon: 4.84,
    segment_type: kind,
    activity_type: null,
    semantic_type: null,
    place_id: null,
    distance_meters: null,
    nearest_city: null,
    ...extra,
});

const message = (at: string, contact: string, direction: 'sent' | 'received') => ({
    network: 'whatsapp',
    timestamp: at,
    date: at.slice(0, 10),
    thread: contact,
    contact,
    sender: direction === 'sent' ? 'Me' : contact,
    direction,
    text: 'salut',
});

const entry = (at: string, service: string, action: string, label: string) => ({
    timestamp: at,
    date: at.slice(0, 10),
    service,
    action,
    label,
});

const packet = (from: string, to: string, steps: number) => ({
    timestamp: to,
    date: to.slice(0, 10),
    start_timestamp: from,
    steps,
});

const reading = (at: string, value: number, metric = 'heart_rate') => ({
    timestamp: at,
    date: at.slice(0, 10),
    metric,
    value,
});

beforeAll(async () => {
    ({ db, conn } = await openHeadlessDuckDB());
    runQuery.mockImplementation(headlessQuery(conn));
    tableExists.mockImplementation(
        async (name: string) =>
            conn.query(`SELECT 1 FROM duckdb_tables() WHERE table_name = '${name}'`).toArray()
                .length > 0
    );
});

afterAll(() => {
    conn?.close();
    db?.terminate?.();
});

beforeEach(() => {
    runQuery.mockClear();
    for (const spec of [
        PLAYS_TABLE,
        LOCATION_SEGMENTS_TABLE,
        MESSAGES_TABLE,
        GOOGLE_ACTIVITY_TABLE,
        STEP_PACKETS_TABLE,
        HEALTH_READINGS_TABLE,
    ]) {
        conn.query(`DROP TABLE IF EXISTS ${spec.table} CASCADE`);
        conn.query(`CREATE TABLE ${spec.table} (${spec.schema})`);
    }

    insert('plays', [
        play('2024-12-31 23:50:00', 'spotify', 240_000),
        play('2025-03-10 08:00:00', 'spotify', 180_000, 'Northbound'),
        play('2025-03-10 08:04:00', 'spotify', 120_000, 'Paper Moon'),
        play('2025-03-10 21:00:00', 'spotify', 300_000, 'Salt Air'),
        // A scrobble: a play, but no duration to count in minutes.
        play('2025-03-11 12:00:00', 'lastfm', null),
        play('2025-06-01 10:00:00', 'deezer', 600_000),
    ]);

    insert('location_segments', [
        segment('google-timeline', '2024-07-14 09:00:00', '2024-07-14 18:00:00', 'stationary'),
        // The night before, running on into the 10th.
        segment('google-timeline', '2025-03-09 22:00:00', '2025-03-10 08:00:00', 'stationary', {
            semantic_type: 'HOME',
            place_id: 'p-home',
            nearest_city: 'Lyon',
        }),
        // A Timeline activity carries the activity; its path carries the length.
        segment('google-timeline', '2025-03-10 08:00:00', '2025-03-10 08:20:00', 'moving', {
            activity_type: 'walking',
        }),
        segment('google-timeline', '2025-03-10 08:00:00', '2025-03-10 08:10:00', 'moving', {
            distance_meters: 800,
        }),
        segment('google-timeline', '2025-03-10 08:10:00', '2025-03-10 08:20:00', 'moving', {
            distance_meters: 700,
        }),
        segment('google-timeline', '2025-03-10 08:20:00', '2025-03-10 17:30:00', 'stationary', {
            semantic_type: 'WORK',
            place_id: 'p-work',
            nearest_city: 'Lyon',
        }),
        // A run the watch recorded, and the phone's coarser version of the same
        // minute, which the watch supersedes.
        segment('garmin', '2025-03-10 18:00:00', '2025-03-10 18:30:00', 'moving', {
            activity_type: 'running',
            distance_meters: 2500,
        }),
        segment('garmin', '2025-03-10 18:30:00', '2025-03-10 19:00:00', 'moving', {
            activity_type: 'running',
            distance_meters: 2500,
        }),
        segment('garmin', '2025-03-10 19:00:00', '2025-03-10 19:00:00', 'moving', {
            activity_type: 'running',
        }),
        segment('google-timeline', '2025-03-10 18:00:00', '2025-03-10 18:30:00', 'moving', {
            distance_meters: 3000,
        }),
        segment('google-timeline', '2025-03-10 19:30:00', '2025-03-11 07:00:00', 'stationary', {
            semantic_type: 'HOME',
            place_id: 'p-home',
            nearest_city: 'Lyon',
        }),
        segment('google-timeline', '2025-03-11 07:00:00', '2025-03-11 07:30:00', 'moving', {
            distance_meters: 5000,
        }),
    ]);
    conn.query(supersedeSql());
    conn.query(POSITIONS_VIEW_SQL);

    insert('messages', [
        message('2024-11-20 12:00:00', 'Hugo', 'sent'),
        message('2025-03-10 09:00:00', 'Léa', 'received'),
        message('2025-03-10 09:05:00', 'Léa', 'sent'),
        message('2025-03-10 09:06:00', 'Léa', 'received'),
        message('2025-03-10 20:00:00', 'Hugo', 'received'),
        message('2025-03-12 10:00:00', 'Climbing group', 'received'),
    ]);

    insert('google_activity', [
        entry('2025-03-10 07:30:00', 'search', 'searched', 'weather tomorrow'),
        entry('2025-03-10 22:15:00', 'youtube', 'watched', 'Ten-minute stretch'),
        entry('2026-01-02 09:00:00', 'search', 'searched', 'train times'),
    ]);

    insert('step_packets', [
        packet('2025-03-10 08:00:00', '2025-03-10 08:14:00', 1200),
        packet('2025-03-10 08:14:00', '2025-03-10 08:20:00', 800),
        packet('2025-03-10 17:50:00', '2025-03-10 18:10:00', 2000),
        // A day's closing reading, one second before midnight.
        packet('2025-03-10 23:30:00', '2025-03-10 23:59:59', 100),
        packet('2025-03-11 07:00:00', '2025-03-11 07:20:00', 3000),
    ]);

    insert('health_readings', [
        reading('2025-03-10 08:00:00', 60),
        reading('2025-03-10 08:01:00', 62),
        reading('2025-03-10 18:05:00', 150),
        reading('2025-03-10 18:06:00', 160),
        reading('2025-03-10 23:59:00', 55),
        reading('2025-03-10 08:00:00', 30, 'stress'),
        reading('2025-03-11 03:00:00', 52),
    ]);
});

/** Every statement sent to the engine since the last `beforeEach`. */
const sent = () => runQuery.mock.calls.map(([sql]) => String(sql));

describe('getYearSummaries', () => {
    it('totals every module per year, in its own unit, with the days it covers', async () => {
        const summaries = await getYearSummaries(ALL);

        expect(summaries).toEqual([
            {
                module: 'listening',
                year: 2024,
                total: 4,
                firstDay: '2024-12-31',
                lastDay: '2024-12-31',
            },
            // The scrobble has no minutes to add, but its day is covered.
            {
                module: 'listening',
                year: 2025,
                total: 20,
                firstDay: '2025-03-10',
                lastDay: '2025-06-01',
            },
            {
                module: 'positions',
                year: 2024,
                total: 0,
                firstDay: '2024-07-14',
                lastDay: '2024-07-14',
            },
            // 1.5 km walked, 5 km run (the phone's 3 km of the same run are
            // superseded), 5 km the next morning.
            {
                module: 'positions',
                year: 2025,
                total: 11.5,
                firstDay: '2025-03-09',
                lastDay: '2025-03-11',
            },
            {
                module: 'messages',
                year: 2024,
                total: 1,
                firstDay: '2024-11-20',
                lastDay: '2024-11-20',
            },
            {
                module: 'messages',
                year: 2025,
                total: 5,
                firstDay: '2025-03-10',
                lastDay: '2025-03-12',
            },
            {
                module: 'activity',
                year: 2025,
                total: 2,
                firstDay: '2025-03-10',
                lastDay: '2025-03-10',
            },
            {
                module: 'activity',
                year: 2026,
                total: 1,
                firstDay: '2026-01-02',
                lastDay: '2026-01-02',
            },
            {
                module: 'steps',
                year: 2025,
                total: 7100,
                firstDay: '2025-03-10',
                lastDay: '2025-03-11',
            },
            // Days with a heart-rate reading; the stress reading adds none.
            {
                module: 'health',
                year: 2025,
                total: 2,
                firstDay: '2025-03-10',
                lastDay: '2025-03-11',
            },
        ]);
    });

    it('counts plays rather than minutes under the plays measure', async () => {
        const summaries = await getYearSummaries(only('listening'), 'plays');
        expect(summaries.map((s) => [s.year, s.total])).toEqual([
            [2024, 1],
            [2025, 5],
        ]);
    });

    it('sends nothing for a module that is not loaded', async () => {
        const summaries = await getYearSummaries(only('messages'));

        expect(new Set(summaries.map((s) => s.module))).toEqual(new Set(['messages']));
        expect(sent()).toHaveLength(1);
        expect(sent()[0]).toContain('FROM messages');
    });
});

describe('getYearData', () => {
    const stops = rampFor({ low: 50, high: 100, peak: 150 });

    it('reads one figure a day per module, only on the days it recorded', async () => {
        const data = await getYearData(2025, ALL, { heartRateStops: stops });

        expect(data.listening).toEqual([
            { date: '2025-03-10', value: 10 },
            { date: '2025-06-01', value: 10 },
        ]);
        expect(data.messages).toEqual([
            { date: '2025-03-10', value: 4 },
            { date: '2025-03-12', value: 1 },
        ]);
        expect(data.activity).toEqual([{ date: '2025-03-10', value: 2 }]);
        expect(data.steps).toEqual([
            { date: '2025-03-10', value: 4100 },
            { date: '2025-03-11', value: 3000 },
        ]);
    });

    it('sums kilometres per day, and names each day by the town it began in', async () => {
        const { positions } = await getYearData(2025, only('positions'));

        // The 10th began in the stay begun at 22:00 the night before; the 9th
        // has no position before 04:00, so its first located one names it.
        expect(positions).toEqual([
            { date: '2025-03-09', km: 0, city: 'Lyon' },
            { date: '2025-03-10', km: 6.5, city: 'Lyon' },
            { date: '2025-03-11', km: 5, city: 'Lyon' },
        ]);
    });

    it('names no town before the points have been located', async () => {
        conn.query('UPDATE location_segments SET nearest_city = NULL');
        const { positions } = await getYearData(2025, only('positions'));
        expect(positions?.map((d) => [d.date, d.km, d.city])).toEqual([
            ['2025-03-09', 0, null],
            ['2025-03-10', 6.5, null],
            ['2025-03-11', 5, null],
        ]);
    });

    it('splits each day’s heart rate into the bands of the ramp, in minutes', async () => {
        const { health } = await getYearData(2025, only('health'), { heartRateStops: stops });

        expect(health?.stops).toBe(stops);
        // 61 bpm (two readings in one slot), 155 bpm, 55 bpm: five minutes each.
        expect(health?.days).toEqual([
            { date: '2025-03-10', minutes: [5, 5, 0, 0, 0, 0, 5] },
            { date: '2025-03-11', minutes: [5, 0, 0, 0, 0, 0, 0] },
        ]);
    });

    it('works the ramp out from the whole history when it is not handed one', async () => {
        const fetched = await getHeartRateStops();
        const { health } = await getYearData(2025, only('health'));

        expect(fetched.length).toBeGreaterThanOrEqual(6);
        expect(health?.stops).toEqual(fetched);
        expect(health?.days.map((d) => d.date)).toEqual(['2025-03-10', '2025-03-11']);
    });

    it('counts plays a day under the plays measure', async () => {
        const { listening } = await getYearData(2025, only('listening'), { measure: 'plays' });
        expect(listening).toEqual([
            { date: '2025-03-10', value: 3 },
            { date: '2025-03-11', value: 1 },
            { date: '2025-06-01', value: 1 },
        ]);
    });

    it('leaves the modules that are not loaded null, and sends nothing for them', async () => {
        const data = await getYearData(2025, only('steps'));

        expect(data).toMatchObject({
            listening: null,
            positions: null,
            messages: null,
            activity: null,
            health: null,
        });
        expect(sent().every((sql) => sql.includes('FROM step_packets'))).toBe(true);
    });
});

describe('getYearQuarters', () => {
    it('counts each module quarter-hour by quarter-hour, in its own unit', async () => {
        insert('step_packets', [packet('2025-03-11 12:00:00', '2025-03-11 12:10:00', 40)]);
        const quarters = await getYearQuarters(2025, only('listening', 'positions', 'steps'));

        // 08:00 and 08:04 share the quarter-hour from 08:00.
        expect(quarters.listening).toEqual([
            { date: '2025-03-10', quarter: 32, value: 2 },
            { date: '2025-03-10', quarter: 84, value: 1 },
            { date: '2025-03-11', quarter: 48, value: 1 },
            { date: '2025-06-01', quarter: 40, value: 1 },
        ]);
        // The run the watch recorded, not the phone's version of it.
        expect(quarters.positions).toEqual([
            { date: '2025-03-10', quarter: 32, value: 1.5 },
            { date: '2025-03-10', quarter: 72, value: 2.5 },
            { date: '2025-03-10', quarter: 74, value: 2.5 },
            { date: '2025-03-11', quarter: 28, value: 5 },
        ]);
        // Each packet in the quarter-hour its window closed in; the 40 steps at
        // noon on the 11th are moving about a room, not walking.
        expect(quarters.steps).toEqual([
            { date: '2025-03-10', quarter: 32, value: 1200 },
            { date: '2025-03-10', quarter: 33, value: 800 },
            { date: '2025-03-10', quarter: 72, value: 2000 },
            { date: '2025-03-10', quarter: 95, value: 100 },
            { date: '2025-03-11', quarter: 29, value: 3000 },
        ]);
    });

    it('sends nothing for a module that is not loaded', async () => {
        const quarters = await getYearQuarters(2025, only('messages'));

        expect(Object.keys(quarters)).toEqual(['messages']);
        expect(sent()).toHaveLength(1);
        expect(sent()[0]).toContain('FROM messages');
    });

    it('averages the heart rate of each quarter-hour, and nothing else the watch reads', async () => {
        const quarters = await getYearQuarters(2025, only('health'));

        expect(quarters.health).toEqual([
            { date: '2025-03-10', quarter: 32, value: 61 },
            { date: '2025-03-10', quarter: 72, value: 155 },
            { date: '2025-03-10', quarter: 95, value: 55 },
            { date: '2025-03-11', quarter: 12, value: 52 },
        ]);
    });
});

describe('getDayTimeline', () => {
    it('lays every module of one day on its clock', async () => {
        const stops = rampFor({ low: 50, high: 100, peak: 150 });
        const day = await getDayTimeline('2025-03-10', ALL, { heartRateStops: stops });

        // The day's speed, five minutes at a time: 800 m between 08:00 and
        // 08:10, then a 5 km/h run from 18:00; the stays count as still.
        const bins = day.positions?.bins ?? [];
        expect(bins).toHaveLength(288);
        expect(bins[96]?.kmh).toBeCloseTo(4.8);
        expect(bins[98]?.kmh).toBeCloseTo(4.2);
        expect(bins[216]?.kmh).toBeCloseTo(5);
        expect(bins[0]).toEqual({ km: 0, kmh: 0 });
        // Timeline's inferred walk, which carries no distance, is left out.
        expect(day.positions?.points.some((p) => !p.stationary && p.meters === 0)).toBe(false);
        expect(day.positions?.points[0]).toMatchObject({
            start: -120,
            stationary: true,
            city: 'Lyon',
            lat: 45.76,
            lon: 4.84,
        });
        expect(day.positions?.km).toBeCloseTo(6.5);

        expect(day.listening?.plays.map((p) => [p.start, p.minutes, p.track])).toEqual([
            [480, 3, 'Northbound'],
            [484, 2, 'Paper Moon'],
            [1260, 5, 'Salt Air'],
        ]);
        expect(day.listening?.sessions).toEqual([
            { start: 480, end: 486, plays: 2, minutes: 5 },
            { start: 1260, end: 1265, plays: 1, minutes: 5 },
        ]);

        // A row per conversation — the thread on its network — with who wrote each message.
        expect(day.messages).toEqual([
            {
                conversation: 'whatsapp:Léa',
                contact: 'Léa',
                count: 3,
                sent: 1,
                received: 2,
                messages: [
                    { minute: 540, sent: false, sender: 'Léa', text: 'salut' },
                    { minute: 545, sent: true, sender: 'Me', text: 'salut' },
                    { minute: 546, sent: false, sender: 'Léa', text: 'salut' },
                ],
            },
            {
                conversation: 'whatsapp:Hugo',
                contact: 'Hugo',
                count: 1,
                sent: 0,
                received: 1,
                messages: [{ minute: 1200, sent: false, sender: 'Hugo', text: 'salut' }],
            },
        ]);

        expect(day.activity).toEqual([
            { minute: 450, service: 'search', action: 'searched', label: 'weather tomorrow' },
            { minute: 1335, service: 'youtube', action: 'watched', label: 'Ten-minute stretch' },
        ]);

        // Each packet in the quarter its window closed in.
        const steps = day.steps ?? [];
        expect(steps).toHaveLength(96);
        expect([steps[32], steps[33], steps[72], steps[95]]).toEqual([1200, 800, 2000, 100]);
        expect(steps.filter((v) => v !== null)).toHaveLength(4);

        const heart = day.heartRate?.quarters ?? [];
        expect([heart[32], heart[72], heart[95]]).toEqual([61, 155, 55]);
        expect(heart.filter((v) => v !== null)).toHaveLength(3);
        expect(day.heartRate?.stops).toBe(stops);
    });

    it('gives a play without a duration no length, and a day without records empty tracks', async () => {
        const day = await getDayTimeline('2025-03-11', only('listening', 'messages', 'steps'));

        expect(day.listening?.plays).toEqual([
            { start: 720, minutes: null, track: 'Low Light', artist: 'Marée Basse' },
        ]);
        expect(day.messages).toEqual([]);
        expect(day.steps?.[29]).toBe(3000);
    });

    it('sends nothing for a malformed date or a module that is not loaded', async () => {
        const malformed = await getDayTimeline('10/03/2025', ALL);
        expect(malformed.positions).toBeNull();
        expect(sent()).toHaveLength(0);

        const day = await getDayTimeline('2025-03-10', only('activity'));
        expect(day.listening).toBeNull();
        expect(day.activity).toHaveLength(2);
        expect(sent()).toHaveLength(1);
    });
});
