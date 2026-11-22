import type { Play } from '#lib/types/play.ts';
import { trackKeySql } from '../sql/trackKey';
import { getConnection, insertStaged } from './client';
import { formatLocalDate, formatLocalTimestamp } from './format';
import type { StagedTable } from './staging';

/** Columns of `plays`, in schema order, minus the two derived counters. */
export const PLAY_COLUMNS = `
    source, timestamp, date, ms_played, track_name, artist_name, album_name,
    track_uri, isrc, platform, platform_clean, country, ip_addr, skipped,
    shuffle, offline, reason_start, reason_end, episode_name, episode_show_name,
    episode_uri, incognito_mode, media_type
`;

/**
 * Move staged rows into `plays`, skipping those already stored.
 *
 * Exported so the headless DuckDB test exercises this exact statement rather
 * than a paraphrase of it — the anti-join is the whole reason re-dropping the
 * same export doesn't duplicate it.
 *
 * `source` leads the key because the two services are separate observations of
 * the same life: playing a song on Spotify and on Deezer in the same second is
 * two plays, not one seen twice.
 */
export function playsDedupeSql(target: string, staging: string): string {
    return `
        INSERT INTO ${target} (${PLAY_COLUMNS})
        SELECT ${PLAY_COLUMNS} FROM ${staging} t
        WHERE NOT EXISTS (
            SELECT 1 FROM ${target} p
            WHERE p.source = t.source
              AND p.timestamp = t.timestamp
              AND p.track_name IS NOT DISTINCT FROM t.track_name
              AND p.artist_name IS NOT DISTINCT FROM t.artist_name
        )
        -- The anti-join only sees what is already stored, so twins arriving in
        -- the *same* drop would both pass it.
        QUALIFY ROW_NUMBER() OVER (
            PARTITION BY t.source, t.timestamp, t.track_name, t.artist_name
        ) = 1
    `;
}

/**
 * Recompute `play_count` and `is_first_play` over the whole table.
 *
 * These cannot be assigned while parsing: a parse only sees its own file, and
 * plays now accumulate across imports *and* across two services — so a counter
 * fixed at parse time would restart at 1 on every drop, and a song first heard
 * on Deezer in 2013 would be re-flagged as a discovery when the Spotify export
 * lands. Ranking the merged table is the only place the answer is knowable.
 *
 * Exported for the headless test, which is where the window function is proven.
 */
export function playCountsSql(target: string): string {
    return `
        CREATE OR REPLACE TABLE ${target} AS
        SELECT
            ${PLAY_COLUMNS},
            CAST(ROW_NUMBER() OVER w AS INTEGER) AS play_count,
            (ROW_NUMBER() OVER w) = 1 AS is_first_play
        FROM ${target}
        WINDOW w AS (PARTITION BY ${trackKeySql()} ORDER BY timestamp, source)
    `;
}

/** The table's staging spec — exported so the headless test runs the real one. */
export const PLAYS_TABLE: StagedTable<Play> = {
    table: 'plays',
    schema: `
        source VARCHAR,
        timestamp TIMESTAMP,
        date DATE,
        ms_played INTEGER,
        track_name VARCHAR,
        artist_name VARCHAR,
        album_name VARCHAR,
        track_uri VARCHAR,
        isrc VARCHAR,
        platform VARCHAR,
        platform_clean VARCHAR,
        country VARCHAR,
        ip_addr VARCHAR,
        skipped BOOLEAN,
        shuffle BOOLEAN,
        offline BOOLEAN,
        reason_start VARCHAR,
        reason_end VARCHAR,
        episode_name VARCHAR,
        episode_show_name VARCHAR,
        episode_uri VARCHAR,
        incognito_mode BOOLEAN,
        media_type VARCHAR,
        play_count INTEGER,
        is_first_play BOOLEAN
    `,
    columns: PLAY_COLUMNS,
    toRecord: (play: Play) => ({
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
    }),
    dedupeSql: playsDedupeSql,
};

/**
 * Insert plays into the `plays` table, **appending** to whatever is there.
 *
 * Unlike the original Spotify importer, which dropped the table on every upload,
 * this one never does: Spotify and Deezer arrive in separate drops and importing
 * one must not erase the other. Which makes duplicates possible — re-dropping
 * the same export — so rows go through a temp table and only those with no twin
 * already stored are kept.
 *
 * @throws {Error} If database is not initialized.
 */
export async function insertPlays(plays: Play[]): Promise<void> {
    await insertStaged(PLAYS_TABLE, plays);
    if (plays.length === 0) return;
    // Both counters describe the merged history, so they are rebuilt from it
    // rather than carried in with the batch.
    const connection = await getConnection();
    await connection.query(playCountsSql(PLAYS_TABLE.table));
}
