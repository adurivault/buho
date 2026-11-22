// @vitest-environment node
//
// Headless test of the `plays` storage rules against the real engine.
//
// DuckDB-WASM's worker bundle can't run in JSDOM, but `duckdb-node-blocking`
// runs the same wasm core synchronously in Node, so the two statements that
// decide what "two sources cohabiting" means are exercised rather than assumed:
// the dedupe anti-join (re-dropping an export must change nothing) and the
// window function that ranks plays (a counter that must span both services and
// every past import).
//
// The SQL is imported from `plays.ts` itself, not paraphrased here — a copy would
// keep passing after the real statement drifted.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
    openHeadlessDuckDB,
    type HeadlessConnection,
    type HeadlessDuckDB,
} from './headless.testutil';
import { PLAY_COLUMNS, playCountsSql, playsDedupeSql } from './index';
import { trackKeySql } from '../sql/trackKey';

let db: HeadlessDuckDB;
let conn: HeadlessConnection;

const SCHEMA = `
    source VARCHAR, timestamp TIMESTAMP, date DATE, ms_played INTEGER,
    track_name VARCHAR, artist_name VARCHAR, album_name VARCHAR, track_uri VARCHAR,
    isrc VARCHAR, platform VARCHAR, platform_clean VARCHAR, country VARCHAR,
    ip_addr VARCHAR, skipped BOOLEAN, shuffle BOOLEAN, offline BOOLEAN,
    reason_start VARCHAR, reason_end VARCHAR, episode_name VARCHAR,
    episode_show_name VARCHAR, episode_uri VARCHAR, incognito_mode BOOLEAN,
    media_type VARCHAR, play_count INTEGER, is_first_play BOOLEAN
`;

interface PlaySeed {
    source: 'spotify' | 'deezer';
    /** "2024-05-01 10:00:00" — a naive wall clock, as the app stores it. */
    at: string;
    track: string;
    artist: string;
    msPlayed?: number | null;
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

/** Stage a batch the way `insertPlays` does, then run the two statements. */
function importDrop(seeds: PlaySeed[]): void {
    conn.query(`CREATE OR REPLACE TEMP TABLE plays_incoming (${SCHEMA})`);
    for (const seed of seeds) {
        const values = [
            seed.source,
            seed.at,
            seed.at.slice(0, 10),
            seed.msPlayed === undefined ? 180000 : seed.msPlayed,
            seed.track,
            seed.artist,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            'track',
        ];
        conn.query(
            `INSERT INTO plays_incoming (${PLAY_COLUMNS}) VALUES (${values.map(literal).join(', ')})`
        );
    }
    conn.query(playsDedupeSql('plays', 'plays_incoming'));
    conn.query('DROP TABLE IF EXISTS plays_incoming');
    conn.query(playCountsSql('plays'));
}

const rows = (sql: string): Record<string, unknown>[] =>
    conn
        .query(sql)
        .toArray()
        .map((r) =>
            Object.fromEntries(
                Object.entries(r.toJSON()).map(([k, v]) => [
                    k,
                    typeof v === 'bigint' ? Number(v) : v,
                ])
            )
        );

const count = (where = 'TRUE'): number =>
    Number(rows(`SELECT COUNT(*) c FROM plays WHERE ${where}`)[0].c);

beforeAll(async () => {
    ({ db, conn } = await openHeadlessDuckDB());
});

afterAll(() => {
    conn?.close();
    db?.terminate?.();
});

beforeEach(() => {
    conn.query('DROP TABLE IF EXISTS plays');
    conn.query(`CREATE TABLE plays (${SCHEMA})`);
});

describe('the plays dedupe', () => {
    it('keeps every distinct play of one import', () => {
        importDrop([
            { source: 'spotify', at: '2024-05-01 10:00:00', track: 'A', artist: 'X' },
            { source: 'spotify', at: '2024-05-01 10:05:00', track: 'A', artist: 'X' },
        ]);

        expect(count()).toBe(2);
    });

    it('makes re-importing the same export a no-op', () => {
        const drop: PlaySeed[] = [
            { source: 'spotify', at: '2024-05-01 10:00:00', track: 'A', artist: 'X' },
            { source: 'spotify', at: '2024-05-01 10:05:00', track: 'B', artist: 'X' },
        ];

        importDrop(drop);
        importDrop(drop);

        expect(count()).toBe(2);
    });

    it('collapses twins arriving inside the same drop', () => {
        // The anti-join only sees what is already stored, so the QUALIFY is what
        // catches a duplicate that arrives with its own twin.
        importDrop([
            { source: 'spotify', at: '2024-05-01 10:00:00', track: 'A', artist: 'X' },
            { source: 'spotify', at: '2024-05-01 10:00:00', track: 'A', artist: 'X' },
        ]);

        expect(count()).toBe(1);
    });

    it('keeps the same song played on both services at the same second', () => {
        // `source` leads the key on purpose: these are two observations, not one
        // seen twice, and merging them would silently lose a play.
        importDrop([
            { source: 'spotify', at: '2024-05-01 10:00:00', track: 'A', artist: 'X' },
            { source: 'deezer', at: '2024-05-01 10:00:00', track: 'A', artist: 'X' },
        ]);

        expect(count()).toBe(2);
    });

    it('does not let a Deezer import erase the Spotify one', () => {
        importDrop([{ source: 'spotify', at: '2024-05-01 10:00:00', track: 'A', artist: 'X' }]);
        importDrop([{ source: 'deezer', at: '2013-02-03 09:00:00', track: 'B', artist: 'Y' }]);

        expect(count()).toBe(2);
        expect(count("source = 'spotify'")).toBe(1);
        expect(count("source = 'deezer'")).toBe(1);
    });
});

describe('the play counters', () => {
    it('numbers a track chronologically', () => {
        importDrop([
            { source: 'spotify', at: '2024-05-01 12:00:00', track: 'A', artist: 'X' },
            { source: 'spotify', at: '2024-05-01 10:00:00', track: 'A', artist: 'X' },
            { source: 'spotify', at: '2024-05-01 11:00:00', track: 'A', artist: 'X' },
        ]);

        expect(
            rows('SELECT play_count FROM plays ORDER BY timestamp').map((r) => r.play_count)
        ).toEqual([1, 2, 3]);
    });

    it('flags exactly one first play per track', () => {
        importDrop([
            { source: 'spotify', at: '2024-05-01 10:00:00', track: 'A', artist: 'X' },
            { source: 'spotify', at: '2024-05-01 11:00:00', track: 'A', artist: 'X' },
            { source: 'spotify', at: '2024-05-01 12:00:00', track: 'B', artist: 'X' },
        ]);

        expect(count('is_first_play')).toBe(2);
    });

    it('counts a track across both services, not once per service', () => {
        importDrop([
            { source: 'spotify', at: '2024-05-01 10:00:00', track: 'A', artist: 'X' },
            { source: 'deezer', at: '2024-05-01 11:00:00', track: 'A', artist: 'X' },
        ]);

        expect(
            rows('SELECT play_count FROM plays ORDER BY timestamp').map((r) => r.play_count)
        ).toEqual([1, 2]);
        expect(count('is_first_play')).toBe(1);
    });

    it('moves the first play when an older import lands afterwards', () => {
        // The whole reason the counters are rebuilt from the table: a Deezer
        // export reaching back to 2013 must demote the 2024 Spotify play that
        // was, until that drop, the earliest one on record.
        importDrop([{ source: 'spotify', at: '2024-05-01 10:00:00', track: 'A', artist: 'X' }]);
        expect(count('is_first_play')).toBe(1);

        importDrop([{ source: 'deezer', at: '2013-02-03 09:00:00', track: 'A', artist: 'X' }]);

        const first = rows('SELECT source FROM plays WHERE is_first_play')[0];
        expect(first.source).toBe('deezer');
        expect(count('is_first_play')).toBe(1);
    });

    it('restarts numbering per track rather than continuing across them', () => {
        importDrop([
            { source: 'spotify', at: '2024-05-01 10:00:00', track: 'A', artist: 'X' },
            { source: 'spotify', at: '2024-05-01 11:00:00', track: 'B', artist: 'X' },
        ]);

        expect(rows('SELECT play_count FROM plays').map((r) => r.play_count)).toEqual([1, 1]);
    });

    it('does not merge two artists that share a track title', () => {
        importDrop([
            { source: 'spotify', at: '2024-05-01 10:00:00', track: 'Alive', artist: 'X' },
            { source: 'deezer', at: '2024-05-01 11:00:00', track: 'Alive', artist: 'Y' },
        ]);

        expect(count('is_first_play')).toBe(2);
    });

    it('matches the same song across services despite case and padding', () => {
        // Title + artist is the only identifier the two exports share, so it is
        // folded before comparison — Deezer and Spotify capitalise differently.
        importDrop([
            { source: 'spotify', at: '2024-05-01 10:00:00', track: 'On A Train', artist: 'Yuksek' },
            {
                source: 'deezer',
                at: '2024-05-01 11:00:00',
                track: ' on a train ',
                artist: 'YUKSEK',
            },
        ]);

        expect(count('is_first_play')).toBe(1);
    });
});

describe('the shared track key', () => {
    it('groups the two services onto one track', () => {
        importDrop([
            { source: 'spotify', at: '2024-05-01 10:00:00', track: 'A', artist: 'X' },
            { source: 'deezer', at: '2024-05-01 11:00:00', track: 'A', artist: 'X' },
        ]);

        const distinct = rows(`SELECT COUNT(DISTINCT ${trackKeySql()}) c FROM plays`)[0].c;
        expect(distinct).toBe(1);
    });

    it('keeps a play whose title is missing rather than dropping it', () => {
        conn.query(
            `INSERT INTO plays (${PLAY_COLUMNS}) VALUES ('deezer', '2024-05-01 10:00:00', DATE '2024-05-01', 1000,
             NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'track')`
        );

        const key = rows(`SELECT ${trackKeySql()} k FROM plays`)[0].k;
        expect(key).toBe('__unknown_track__ :: __unknown_artist__');
    });
});

describe('a play whose duration Deezer never recorded', () => {
    it('is stored NULL and left out of the total', () => {
        importDrop([
            {
                source: 'deezer',
                at: '2024-05-01 10:00:00',
                track: 'A',
                artist: 'X',
                msPlayed: null,
            },
            {
                source: 'deezer',
                at: '2024-05-01 11:00:00',
                track: 'B',
                artist: 'X',
                msPlayed: 60_000,
            },
        ]);

        // Still two plays; only one of them contributes minutes. SUM is cast in
        // SQL because DuckDB returns a DECIMAL that reads back as 0 otherwise.
        expect(count()).toBe(2);
        expect(rows('SELECT CAST(SUM(ms_played) AS BIGINT) s FROM plays')[0].s).toBe(60_000);
        expect(count('ms_played IS NULL')).toBe(1);
    });
});
