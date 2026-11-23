// The steps explorer's points against the real engine: each packet carries the
// gait readings taken inside its window, which is what lets walking speed and
// step length filter like any other dimension.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import {
    headlessQuery,
    openHeadlessDuckDB,
    type HeadlessConnection,
    type HeadlessDuckDB,
} from '../db/headless.testutil';
import { GAIT_READINGS_TABLE } from '../db/gait';
import { STEP_PACKETS_TABLE, STEPS_VIEW_SQL, supersedeStepsSql } from '../db/steps';
import { getStepBasePoints, NOT_MEASURED } from './stepsQueries';

const runQuery = vi.hoisted(() => vi.fn());
const tableExists = vi.hoisted(() => vi.fn());
vi.mock('#lib/data/db/index.ts', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#lib/data/db/index.ts')>()),
    query: runQuery,
    tableExists,
}));

let db: HeadlessDuckDB;
let conn: HeadlessConnection;

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
    conn.query('DROP VIEW IF EXISTS steps');
    conn.query('DROP TABLE IF EXISTS step_packets');
    conn.query('DROP TABLE IF EXISTS gait_readings');
    conn.query(`CREATE TABLE step_packets (${STEP_PACKETS_TABLE.schema})`);
    // A walk, then a sit.
    conn.query(`INSERT INTO step_packets
        (source, start_timestamp, timestamp, date, steps, active_seconds, span_seconds, step_id)
        VALUES
        ('apple-health', TIMESTAMP '2024-05-01 10:00:00', TIMESTAMP '2024-05-01 10:10:00',
         DATE '2024-05-01', 1100, NULL, 600, 1),
        ('apple-health', TIMESTAMP '2024-05-01 14:00:00', TIMESTAMP '2024-05-01 14:10:00',
         DATE '2024-05-01', 40, NULL, 600, 2)`);
    conn.query(supersedeStepsSql());
    conn.query(STEPS_VIEW_SQL);
});

function gait(at: string, metric: string, value: number) {
    conn.query(`INSERT INTO gait_readings VALUES
        ('apple-health', TIMESTAMP '${at}', DATE '${at.slice(0, 10)}', '${metric}', ${value})`);
}

describe('getStepBasePoints', () => {
    it('gives each packet the median of the gait readings taken in its window', async () => {
        conn.query(`CREATE TABLE gait_readings (${GAIT_READINGS_TABLE.schema})`);
        gait('2024-05-01 10:02:00', 'walking_speed', 4.6);
        gait('2024-05-01 10:05:00', 'walking_speed', 5.2);
        gait('2024-05-01 10:08:00', 'walking_speed', 4.8);
        gait('2024-05-01 10:05:00', 'step_length', 72);
        // Outside every window: describes no packet.
        gait('2024-05-01 12:00:00', 'walking_speed', 6.4);

        const [walk, sit] = await getStepBasePoints();

        expect(walk).toMatchObject({
            walkingSpeed: 4.8,
            stepLength: 72,
            fSpeed: '4.5–5',
            fStride: '70–80',
        });
        expect(sit).toMatchObject({
            walkingSpeed: null,
            stepLength: null,
            fSpeed: NOT_MEASURED,
            fStride: NOT_MEASURED,
        });
    });

    it('reads every packet as not measured when no export carried gait', async () => {
        const points = await getStepBasePoints();

        expect(points).toHaveLength(2);
        expect(points.every((p) => p.fSpeed === NOT_MEASURED && p.walkingSpeed === null)).toBe(
            true
        );
    });
});
