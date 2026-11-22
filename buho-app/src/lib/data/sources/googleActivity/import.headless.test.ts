// @vitest-environment node
//
// Headless test of the Google-activity import SQL against the real DuckDB
// engine. Like messages, activity imports accumulate — a Takeout can be dropped
// service by service — so the anti-join in `activityDedupeSql` is the only thing
// standing between a second drop of the same export and a doubled table.
import { describe, it, expect, beforeEach, afterAll, beforeAll } from 'vitest';
import {
    openHeadlessDuckDB,
    type HeadlessConnection,
    type HeadlessDuckDB,
} from '../../db/headless.testutil';
import { ACTIVITY_COLUMNS, activityDedupeSql } from '../../db';
import { parseActivityEntry } from './parser';
import type { ActivityRow, RawMyActivityEntry } from '#lib/types/googleActivity.ts';

const SCHEMA = `
    timestamp TIMESTAMP, date DATE, service VARCHAR, action VARCHAR, label VARCHAR,
    secondary VARCHAR, secondary_url VARCHAR, target_id VARCHAR, url VARCHAR,
    domain VARCHAR, origin VARCHAR, place_lat DOUBLE, place_lon DOUBLE, lat DOUBLE, lon DOUBLE,
    loc_source VARCHAR, is_ad BOOLEAN, act_id INTEGER
`;

let db: HeadlessDuckDB;
let conn: HeadlessConnection;

function watched(title: string, videoId: string, iso: string): RawMyActivityEntry {
    return {
        header: 'YouTube',
        title: `Watched ${title}`,
        titleUrl: `https://www.youtube.com/watch?v=${videoId}`,
        subtitles: [{ name: 'A Channel', url: 'https://www.youtube.com/channel/UC1' }],
        time: iso,
        products: ['YouTube'],
    };
}

function searched(query: string, iso: string): RawMyActivityEntry {
    return {
        header: 'Search',
        title: `Searched for ${query}`,
        titleUrl: `https://www.google.com/search?q=${encodeURIComponent(query)}`,
        time: iso,
        products: ['Search'],
    };
}

const rows = (raw: RawMyActivityEntry[]): ActivityRow[] =>
    raw.map((e) => parseActivityEntry(e)!).filter(Boolean);

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

/** Mirrors insertGoogleActivity: stage the rows, then anti-join them in. */
function importRows(batch: ActivityRow[]) {
    conn.query('DROP TABLE IF EXISTS google_activity_incoming');
    conn.query(`CREATE TABLE google_activity_incoming (${SCHEMA})`);
    for (const r of batch) {
        conn.query(
            `INSERT INTO google_activity_incoming (${ACTIVITY_COLUMNS}) VALUES (${[
                r.timestamp,
                r.date,
                r.service,
                r.action,
                r.label,
                r.secondary,
                r.secondaryUrl,
                r.targetId,
                r.url,
                r.domain,
                r.origin,
                r.placeLat,
                r.placeLon,
                r.lat,
                r.lon,
                r.locSource,
                r.isAd,
            ]
                .map(literal)
                .join(', ')})`
        );
    }
    conn.query(activityDedupeSql('google_activity', 'google_activity_incoming'));
    conn.query('DROP TABLE IF EXISTS google_activity_incoming');
    conn.query('UPDATE google_activity SET act_id = rowid');
}

function count(where = '1=1'): number {
    const [row] = conn
        .query(`SELECT COUNT(*) AS n FROM google_activity WHERE ${where}`)
        .toArray()
        .map((r) => r.toJSON());
    return Number(row.n);
}

const YOUTUBE = rows([
    watched('Video One', 'aaaaaaaaaaa', '2026-07-29T11:03:00.000Z'),
    watched('Video Two', 'bbbbbbbbbbb', '2026-07-29T11:20:00.000Z'),
]);
const SEARCH = rows([
    searched('duckdb wasm', '2026-07-29T09:00:00.000Z'),
    searched('observable plot', '2026-07-29T09:05:00.000Z'),
]);

beforeAll(async () => {
    ({ db, conn } = await openHeadlessDuckDB());
});

beforeEach(() => {
    conn.query('DROP TABLE IF EXISTS google_activity');
    conn.query(`CREATE TABLE google_activity (${SCHEMA})`);
});

afterAll(() => {
    conn?.close();
    db?.terminate?.();
});

describe('incremental Google activity import', () => {
    it('stores what it is given', () => {
        importRows(YOUTUBE);
        expect(count()).toBe(2);
        expect(count("service = 'youtube'")).toBe(2);
    });

    it('re-importing the same export changes nothing', () => {
        importRows(YOUTUBE);
        importRows(YOUTUBE);
        expect(count()).toBe(2);
    });

    it('accumulates services instead of replacing them', () => {
        importRows(YOUTUBE);
        importRows(SEARCH);
        expect(count()).toBe(4);
        expect(count("service = 'youtube'")).toBe(2);
        expect(count("service = 'search'")).toBe(2);
    });

    it('re-importing one service leaves the others alone', () => {
        importRows(YOUTUBE);
        importRows(SEARCH);
        importRows(YOUTUBE);
        expect(count()).toBe(4);
    });

    it('keeps two identical labels at different times', () => {
        importRows(
            rows([
                watched('Same Title', 'aaaaaaaaaaa', '2026-07-29T11:03:00.000Z'),
                watched('Same Title', 'aaaaaaaaaaa', '2026-07-29T18:40:00.000Z'),
            ])
        );
        expect(count()).toBe(2);
    });

    /**
     * The documented cost of the natural key: two identical actions logged in the
     * same second are indistinguishable, so they collapse. Pinned here so the
     * tradeoff stays a decision rather than a surprise.
     */
    it('collapses two identical actions logged in the same second', () => {
        importRows(
            rows([
                watched('Same Title', 'aaaaaaaaaaa', '2026-07-29T11:03:00.000Z'),
                watched('Same Title', 'aaaaaaaaaaa', '2026-07-29T11:03:00.000Z'),
            ])
        );
        expect(count()).toBe(1);
    });

    it('gives every stored row a stable key', () => {
        importRows(YOUTUBE);
        importRows(SEARCH);
        const [row] = conn
            .query('SELECT COUNT(DISTINCT act_id) AS n FROM google_activity')
            .toArray()
            .map((r) => r.toJSON());
        expect(Number(row.n)).toBe(4);
    });

    it('round-trips the two coordinate pairs apart', () => {
        importRows(
            rows([
                {
                    header: 'Maps',
                    title: 'Searched for Yonne',
                    titleUrl:
                        'https://www.google.fr/maps/place//@47.8552033,3.5943699,8z/data=!4m2!3m1!1s0x47ee4feff2f737df:0x309ce34b30d2b10',
                    time: '2026-07-29T10:59:30.361Z',
                    products: ['Maps'],
                    locationInfos: [
                        {
                            name: 'At this general area',
                            url: 'https://www.google.com/maps/@?api=1&map_action=map&center=48.856600,2.352200&zoom=12',
                            source: 'From your device',
                        },
                    ],
                },
            ])
        );

        const [row] = conn
            .query('SELECT place_lat, place_lon, lat, lon, target_id FROM google_activity')
            .toArray()
            .map((r) => r.toJSON());

        expect(Number(row.place_lat)).toBeCloseTo(47.8552033);
        expect(Number(row.lat)).toBeCloseTo(48.8566);
        expect(row.target_id).toBe('0x47ee4feff2f737df:0x309ce34b30d2b10');
    });
});
