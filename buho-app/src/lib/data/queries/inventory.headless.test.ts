// @vitest-environment node
//
// Headless test of source removal against the real DuckDB engine.
//
// Imports only ever accumulate now, so removal is the only way back — and the
// statements are riskier than they look. Every table is shared by two or more
// exports, so a removal that forgets its scope takes a neighbour with it; and
// `superseded` is a claim about the table as a whole, so removing the watch
// leaves the phone points it hid invisible unless the flags are recomputed.
//
// The DELETEs are driven from SOURCE_STORAGE rather than written out here: that
// map is the thing under test, and a column or value that doesn't match what the
// parsers actually write would otherwise fail silently, deleting nothing.
import { describe, it, expect, beforeEach, afterAll, beforeAll } from 'vitest';
import {
    openHeadlessDuckDB,
    type HeadlessConnection,
    type HeadlessDuckDB,
} from '../db/headless.testutil';
import { supersedeSql } from '#lib/data/db/index.ts';
import { SOURCE_STORAGE, storesFor } from '#lib/data/sources/storage.ts';

let db: HeadlessDuckDB;
let conn: HeadlessConnection;

/** What `removeSource` runs for one source, over one of its tables. */
function removeFrom(sourceId: string, table: string) {
    const store = storesFor(sourceId).find((s) => s.table === table);
    if (!store) throw new Error(`"${sourceId}" does not write to ${table}`);
    if (!store.scope) {
        conn.query(`DROP TABLE IF EXISTS ${table}`);
        return;
    }
    // The app binds the value; a literal is equivalent here and keeps the test
    // to one statement.
    conn.query(`DELETE FROM ${table} WHERE ${store.scope.column} = '${store.scope.value}'`);
}

const scalar = (sql: string) => Number(conn.query(sql).toArray()[0].toJSON().n);

beforeAll(async () => {
    ({ db, conn } = await openHeadlessDuckDB());
});

afterAll(() => {
    conn?.close();
    db?.terminate?.();
});

beforeEach(() => {
    conn.query('DROP TABLE IF EXISTS location_segments');
    conn.query('DROP TABLE IF EXISTS plays');
    conn.query('DROP TABLE IF EXISTS messages');
    conn.query('DROP TABLE IF EXISTS step_packets');
});

describe('removing a source from a shared table', () => {
    it('takes one music service out and leaves the other', () => {
        conn.query('CREATE TABLE plays (source VARCHAR, track_name VARCHAR)');
        conn.query(`INSERT INTO plays VALUES
            ('spotify', 'On A Train'), ('spotify', 'Sunday'), ('deezer', 'Ainsi Bas La Vida')`);

        removeFrom('deezer', 'plays');

        expect(scalar("SELECT COUNT(*) AS n FROM plays WHERE source = 'spotify'")).toBe(2);
        expect(scalar("SELECT COUNT(*) AS n FROM plays WHERE source = 'deezer'")).toBe(0);
    });

    it('takes one messaging service out and leaves the others', () => {
        conn.query('CREATE TABLE messages (network VARCHAR, text VARCHAR)');
        conn.query(`INSERT INTO messages VALUES
            ('messenger', 'hello'), ('whatsapp', 'salut'), ('instagram', 'hey')`);

        removeFrom('whatsapp', 'messages');

        expect(scalar('SELECT COUNT(*) AS n FROM messages')).toBe(2);
        expect(scalar("SELECT COUNT(*) AS n FROM messages WHERE network = 'whatsapp'")).toBe(0);
    });

    it('scopes every source that shares a table, so none can take a neighbour', () => {
        // The guard behind the two cases above: an unscoped entry on a shared
        // table would drop it whole.
        const byTable = new Map<string, string[]>();
        for (const [id, stores] of Object.entries(SOURCE_STORAGE)) {
            for (const store of stores) {
                byTable.set(store.table, [...(byTable.get(store.table) ?? []), id]);
            }
        }

        for (const [table, ids] of byTable) {
            if (ids.length < 2) continue;
            for (const id of ids) {
                const store = storesFor(id).find((s) => s.table === table);
                expect(store?.scope, `"${id}" shares ${table} unscoped`).toBeDefined();
            }
        }
    });
});

/**
 * The failure this file exists for. `superseded` marks the phone points a watch
 * was covering; delete the watch and those points are the only record left of
 * where you were. Leaving the flags as they stood would punch a hole in the map
 * exactly where the removed source used to be — and nothing would look broken.
 */
describe('removing a positions provider', () => {
    const segment = (source: string, timestamp: string, lat: number) =>
        `('${source}', TIMESTAMP '${timestamp}', ${lat}, 2.35, NULL)`;

    function seed() {
        conn.query(`CREATE TABLE location_segments (
            source VARCHAR, timestamp TIMESTAMP, lat DOUBLE, lon DOUBLE, superseded BOOLEAN
        )`);
        conn.query(`INSERT INTO location_segments VALUES
            ${segment('google-timeline', '2026-07-12 18:00:00', 48.85)},
            ${segment('google-timeline', '2026-07-12 18:29:00', 48.86)},
            ${segment('garmin', '2026-07-12 18:29:31', 46.89)}`);
        conn.query(supersedeSql('location_segments'));
    }

    const visible = () =>
        scalar('SELECT COUNT(*) AS n FROM location_segments WHERE superseded IS NOT TRUE');

    it('hides the phone point the watch covered, before any removal', () => {
        seed();
        expect(visible()).toBe(2);
    });

    it('brings the hidden phone points back once the watch is removed', () => {
        seed();
        removeFrom('garmin', 'location_segments');
        // What db.rebuildPositionsDerived runs after the delete.
        conn.query(supersedeSql('location_segments'));

        expect(scalar('SELECT COUNT(*) AS n FROM location_segments')).toBe(2);
        expect(visible()).toBe(2);
    });

    it('would leave a hole if the flags were not recomputed', () => {
        // Stated as a test so the recompute can't be dropped as redundant.
        seed();
        removeFrom('garmin', 'location_segments');

        expect(visible()).toBe(1);
    });

    it('leaves the watch tracks alone when the phone history is removed', () => {
        seed();
        removeFrom('google-timeline', 'location_segments');
        conn.query(supersedeSql('location_segments'));

        expect(scalar("SELECT COUNT(*) AS n FROM location_segments WHERE source = 'garmin'")).toBe(
            1
        );
        expect(visible()).toBe(1);
    });
});

/** Garmin is the one export feeding two modules, so removing it reaches two tables. */
describe('removing a source that fills two modules', () => {
    it('clears both the tracks and the step counters', () => {
        conn.query(`CREATE TABLE location_segments (
            source VARCHAR, timestamp TIMESTAMP, lat DOUBLE, lon DOUBLE, superseded BOOLEAN
        )`);
        conn.query(`INSERT INTO location_segments VALUES
            ('garmin', TIMESTAMP '2026-07-12 18:29:31', 46.89, 6.92, NULL),
            ('google-timeline', TIMESTAMP '2026-07-12 19:00:00', 48.85, 2.35, NULL)`);
        conn.query('CREATE TABLE step_packets (timestamp TIMESTAMP, steps INTEGER)');
        conn.query(`INSERT INTO step_packets VALUES (TIMESTAMP '2026-07-12 18:00:00', 412)`);

        for (const store of storesFor('garmin')) removeFrom('garmin', store.table);

        expect(scalar('SELECT COUNT(*) AS n FROM location_segments')).toBe(1);
        expect(
            scalar(`SELECT COUNT(*) AS n FROM duckdb_tables() WHERE table_name = 'step_packets'`)
        ).toBe(0);
    });
});
