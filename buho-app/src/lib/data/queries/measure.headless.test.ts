// @vitest-environment node
//
// Headless test of the plays measure against the real DuckDB engine.
//
// The bug this pins down was invisible to every unit test: a Last.fm export
// parsed, imported and drew its constellation, and everything else on the page
// was blank. Nothing had thrown — a scrobble simply carries no duration, and
// the whole listening layer was measured in minutes, so half the queries
// filtered `ms_played IS NOT NULL` down to nothing and the other half summed
// NULL to zero.
//
// So the rows here go in through the real parser rather than being written by
// hand: what makes a scrobble hard is exactly what the parser decides about it.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
    openHeadlessDuckDB,
    type HeadlessConnection,
    type HeadlessDuckDB,
} from '../db/headless.testutil';
import { parseLastfmScrobbles } from '../sources/lastfm/parse';
import { parseSpotifyData } from '../sources/spotify/parse';
import { formatLocalDate, formatLocalTimestamp, playCountsSql } from '../db';
import { measureConditions, measureSql, type Measure } from '../sql/measure';
import type { Play } from '#lib/types/play.ts';

let db: HeadlessDuckDB;
let conn: HeadlessConnection;

const SCHEMA = `
    source VARCHAR, timestamp TIMESTAMP, date DATE, ms_played INTEGER,
    track_name VARCHAR, artist_name VARCHAR, album_name VARCHAR,
    track_uri VARCHAR, isrc VARCHAR, platform VARCHAR, platform_clean VARCHAR,
    country VARCHAR, ip_addr VARCHAR, skipped BOOLEAN, shuffle BOOLEAN,
    offline BOOLEAN, reason_start VARCHAR, reason_end VARCHAR,
    episode_name VARCHAR, episode_show_name VARCHAR, episode_uri VARCHAR,
    incognito_mode BOOLEAN, media_type VARCHAR, play_count INTEGER,
    is_first_play BOOLEAN
`;

/** The columns `insertPlays` stages, in its order. */
const record = (play: Play) => ({
    source: play.source,
    timestamp: formatLocalTimestamp(play.timestamp),
    date: formatLocalDate(play.date),
    ms_played: play.msPlayed,
    track_name: play.trackName,
    artist_name: play.artistName,
    album_name: play.albumName,
    track_uri: play.trackUri,
    isrc: play.isrc,
    platform: play.platform,
    platform_clean: play.platformClean,
    country: play.country,
    ip_addr: play.ipAddr,
    skipped: play.skipped,
    shuffle: play.shuffle,
    offline: play.offline,
    reason_start: play.reasonStart,
    reason_end: play.reasonEnd,
    episode_name: play.episodeName,
    episode_show_name: play.episodeShowName,
    episode_uri: play.episodeUri,
    incognito_mode: play.incognitoMode,
    media_type: play.mediaType,
});

function load(plays: Play[]) {
    conn.query('DROP TABLE IF EXISTS plays');
    conn.query(`CREATE TABLE plays (${SCHEMA})`);
    const rows = plays.map(record);
    const columns = Object.keys(rows[0]).join(', ');
    db.registerFileText('measure.json', JSON.stringify(rows));
    conn.query(
        `INSERT INTO plays (${columns}) SELECT ${columns} FROM read_json_auto('measure.json')`
    );
    conn.query(playCountsSql('plays'));
}

const rowsOf = (sql: string) =>
    conn
        .query(sql)
        .toArray()
        .map((r) => r.toJSON());

/** One page of the API response, shaped the way the exporter saves it. */
function scrobble(artist: string, track: string, uts: number) {
    return {
        artist: { mbid: '', '#text': artist },
        album: { mbid: '', '#text': `${track} - Single` },
        name: track,
        streamable: '0',
        url: `https://www.last.fm/music/${artist}/_/${track}`,
        date: { uts: String(uts), '#text': '01 Jan 2026, 12:00' },
    };
}

const JAN_2026 = Date.UTC(2026, 0, 5, 12, 0, 0) / 1000;
const DAY = 86_400;

beforeAll(async () => {
    ({ db, conn } = await openHeadlessDuckDB());
});

afterAll(() => {
    conn?.close();
    db?.terminate?.();
});

describe('a scrobbled history, which carries no durations', () => {
    let plays: Play[];

    beforeAll(() => {
        plays = parseLastfmScrobbles([
            [
                scrobble('Ólafur Arnalds', 'Near Light', JAN_2026),
                scrobble('Ólafur Arnalds', 'Near Light', JAN_2026 + 300),
                scrobble('Solann', 'Notre-Dame', JAN_2026 + DAY),
            ],
            [scrobble('Solann', 'Monstre', JAN_2026 + 2 * DAY)],
        ]);
        load(plays);
    });

    it('parses to plays with no duration at all', () => {
        expect(plays).toHaveLength(4);
        expect(plays.every((p) => p.msPlayed === null)).toBe(true);
    });

    it('sums to nothing in minutes — the failure the measure exists for', () => {
        const [row] = rowsOf(`
            SELECT ${measureSql('minutes')} AS value FROM plays
            WHERE ${measureConditions('minutes').join(' AND ')}
        `);
        expect(row.value).toBeNull();
    });

    it.each<[string, Measure, number]>([
        ['minutes', 'minutes', 0],
        ['plays', 'plays', 3],
    ])('groups %s of listening into %i day(s)', (_label, measure, expected) => {
        // The guide's calendar heatmap, which came back empty: the day rows
        // exist only when the measure can be computed from them.
        const days = rowsOf(`
            SELECT CAST(date AS VARCHAR) AS date, CAST(${measureSql(measure)} AS DOUBLE) AS value
            FROM plays
            ${
                measureConditions(measure).length
                    ? `WHERE ${measureConditions(measure).join(' AND ')}`
                    : ''
            }
            GROUP BY date
        `);
        expect(days).toHaveLength(expected);
        if (expected > 0) expect(days.every((d) => Number(d.value) > 0)).toBe(true);
    });

    it('ranks artists by plays, with the months under them', () => {
        const months = rowsOf(`
            SELECT artist_name AS artist, CAST(${measureSql('plays')} AS DOUBLE) AS value
            FROM plays
            WHERE artist_name IS NOT NULL AND date IS NOT NULL
            GROUP BY artist_name, DATE_TRUNC('month', date)
            ORDER BY value DESC, artist ASC
        `);
        expect(months).toEqual([
            { artist: 'Solann', value: 2 },
            { artist: 'Ólafur Arnalds', value: 2 },
        ]);
    });

    it('reports no total duration and no skip rate rather than zeroes', () => {
        const [row] = rowsOf(`
            SELECT
                CAST(SUM(ms_played) / 60000.0 AS INTEGER) AS totalMinutes,
                CAST(AVG(CASE WHEN skipped THEN 1.0 WHEN skipped IS NULL THEN NULL ELSE 0.0 END) AS DOUBLE) AS skipRate
            FROM plays
        `);
        expect(row.totalMinutes).toBeNull();
        expect(row.skipRate).toBeNull();
    });
});

describe('a history holding both a Spotify export and scrobbles', () => {
    beforeAll(() => {
        const spotify = parseSpotifyData([
            {
                ts: '2026-01-05T12:00:00Z',
                ms_played: 180_000,
                master_metadata_track_name: 'Nightcall',
                master_metadata_album_artist_name: 'Kavinsky',
                master_metadata_album_album_name: 'OutRun',
                spotify_track_uri: 'spotify:track:0U0ldCRmgCqhVvD6ksG63j',
                platform: 'ios',
                conn_country: 'FR',
                ip_addr: '192.0.2.1',
                episode_name: null,
                episode_show_name: null,
                spotify_episode_uri: null,
                reason_start: 'clickrow',
                reason_end: 'trackdone',
                shuffle: false,
                skipped: false,
                offline: false,
                offline_timestamp: null,
                incognito_mode: false,
            },
        ]);
        load([...spotify, ...parseLastfmScrobbles([[scrobble('Solann', 'Monstre', JAN_2026)]])]);
    });

    it('counts every play, whichever service recorded it', () => {
        const [row] = rowsOf(`SELECT CAST(${measureSql('plays')} AS INTEGER) AS value FROM plays`);
        expect(row.value).toBe(2);
    });

    it('leaves the scrobble out of the minutes rather than scoring it zero', () => {
        // Not a regression to fix: minutes are Spotify's answer over Spotify's
        // rows. It is why the measure has to be offered rather than inferred —
        // read in minutes, this history is missing half of itself.
        const [row] = rowsOf(`
            SELECT CAST(${measureSql('minutes')} AS INTEGER) AS value FROM plays
            WHERE ${measureConditions('minutes').join(' AND ')}
        `);
        expect(row.value).toBe(3);
    });
});
