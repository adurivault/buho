// The steps view against the real engine: a phone and a watch count the same
// walk, and every read of step counts goes through the rule that keeps one of
// them per hour. Getting it wrong doubles a day, or loses the hours the watch
// spent on its charger.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
    openHeadlessDuckDB,
    type HeadlessConnection,
    type HeadlessDuckDB,
} from './headless.testutil';
import { STEP_PACKETS_TABLE, STEPS_VIEW_SQL, supersedeStepsSql } from './steps';

let db: HeadlessDuckDB;
let conn: HeadlessConnection;

beforeAll(async () => {
    ({ db, conn } = await openHeadlessDuckDB());
});

afterAll(() => {
    conn?.close();
    db?.terminate?.();
});

beforeEach(() => {
    conn.query('DROP VIEW IF EXISTS steps');
    conn.query('DROP TABLE IF EXISTS step_packets');
    conn.query(`CREATE TABLE step_packets (${STEP_PACKETS_TABLE.schema})`);
});

const sql = (v: boolean | null) => (v === null ? 'NULL' : String(v));

/** A watch packet: worn when it measured a pulse, null without a sensor. */
function watch(start: string, end: string, steps: number, worn: boolean | null) {
    conn.query(`INSERT INTO step_packets (source, start_timestamp, timestamp, date, steps, worn)
        VALUES ('garmin', TIMESTAMP '${start}', TIMESTAMP '${end}', DATE '${end.slice(0, 10)}',
                ${steps}, ${sql(worn)})`);
}

/** A phone packet: it can never tell whether it was carried. */
function phone(start: string, end: string, steps: number) {
    conn.query(`INSERT INTO step_packets (source, start_timestamp, timestamp, date, steps, worn)
        VALUES ('apple-health', TIMESTAMP '${start}', TIMESTAMP '${end}',
                DATE '${end.slice(0, 10)}', ${steps}, NULL)`);
}

function resolve() {
    conn.query(supersedeStepsSql());
    conn.query(STEPS_VIEW_SQL);
}

/** What the view serves, hour by hour: `HH source steps`. */
function held(): string[] {
    return conn
        .query(
            `SELECT strftime(timestamp, '%H') || ' ' || source AS h, CAST(SUM(steps) AS INTEGER) AS n
             FROM steps GROUP BY ALL ORDER BY h`
        )
        .toArray()
        .map((r) => {
            const row = r.toJSON();
            return `${row.h} ${row.n}`;
        });
}

const D = '2026-07-12';

describe('the steps view', () => {
    it('gives an hour the watch was worn to the watch, whatever the phone counted', () => {
        watch(`${D} 08:00:00`, `${D} 08:20:00`, 900, true);
        phone(`${D} 08:00:00`, `${D} 08:10:00`, 600);
        phone(`${D} 08:10:00`, `${D} 08:20:00`, 400);
        resolve();

        expect(held()).toEqual(['08 garmin 900']);
    });

    it('gives an hour the watch sat off the wrist to the phone', () => {
        // 10:00: on the desk, still writing its counters. 12:00: nobody else.
        watch(`${D} 10:00:00`, `${D} 10:50:00`, 30, false);
        phone(`${D} 10:05:00`, `${D} 10:15:00`, 1500);
        watch(`${D} 12:00:00`, `${D} 12:40:00`, 20, false);
        resolve();

        expect(held()).toEqual(['10 apple-health 1500', '12 garmin 20']);
    });

    it('counts the watch worn for every hour a window with a pulse spans', () => {
        // One packet at rest from 09:10 to 11:05, a pulse in it: worn at 10:00 too.
        watch(`${D} 09:10:00`, `${D} 11:05:00`, 40, true);
        phone(`${D} 10:20:00`, `${D} 10:30:00`, 300);
        resolve();

        expect(held()).toEqual(['11 garmin 40']);
    });

    it('falls back on the watch when it cannot tell either', () => {
        // A watch without a heart-rate sensor: no better than the phone, so the
        // order between recorders decides.
        watch(`${D} 08:00:00`, `${D} 08:20:00`, 700, null);
        phone(`${D} 08:00:00`, `${D} 08:10:00`, 900);
        resolve();

        expect(held()).toEqual(['08 garmin 700']);
    });

    it('gives an hour back when the export holding it is removed', () => {
        watch(`${D} 08:00:00`, `${D} 08:20:00`, 900, true);
        phone(`${D} 08:00:00`, `${D} 08:10:00`, 600);
        resolve();
        expect(held()).toEqual(['08 garmin 900']);

        conn.query("DELETE FROM step_packets WHERE source = 'garmin'");
        resolve();

        expect(held()).toEqual(['08 apple-health 600']);
    });

    it('serves a single recorder untouched', () => {
        phone(`${D} 08:00:00`, `${D} 08:10:00`, 600);
        phone(`${D} 08:10:00`, `${D} 08:20:00`, 200);
        resolve();

        expect(held()).toEqual(['08 apple-health 800']);
    });
});
