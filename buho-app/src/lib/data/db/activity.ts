import type { ActivityRow } from '#lib/types/googleActivity.ts';
import { getConnection, insertStaged } from './client';
import type { StagedTable } from './staging';

/** Columns of `google_activity`, in schema order, minus the derived `act_id`. */
export const ACTIVITY_COLUMNS = `
    timestamp, date, service, action, label, secondary, secondary_url,
    target_id, url, domain, origin, place_lat, place_lon, lat, lon, loc_source, is_ad
`;

/**
 * Move staged rows into `google_activity`, skipping those already stored.
 *
 * Exported so the headless DuckDB test exercises this exact statement rather
 * than a paraphrase of it.
 */
export function activityDedupeSql(target: string, staging: string): string {
    return `
        INSERT INTO ${target} (${ACTIVITY_COLUMNS})
        SELECT ${ACTIVITY_COLUMNS} FROM ${staging} t
        WHERE NOT EXISTS (
            SELECT 1 FROM ${target} a
            WHERE a.service = t.service
              AND a.timestamp = t.timestamp
              AND a.action = t.action
              AND a.label IS NOT DISTINCT FROM t.label
              AND a.url IS NOT DISTINCT FROM t.url
        )
        -- The anti-join only sees what is already stored, so twins arriving in
        -- the *same* drop would both pass it. Takeout does emit those — a
        -- background ping logged several times within one second — so the key is
        -- enforced inside the batch too. PARTITION BY groups NULLs together,
        -- matching the IS NOT DISTINCT FROM above.
        QUALIFY ROW_NUMBER() OVER (
            PARTITION BY t.service, t.timestamp, t.action, t.label, t.url
        ) = 1
    `;
}

/** The table's staging spec — exported so the headless test runs the real one. */
export const GOOGLE_ACTIVITY_TABLE: StagedTable<ActivityRow> = {
    table: 'google_activity',
    schema: `
        timestamp TIMESTAMP,
        date DATE,
        service VARCHAR,
        action VARCHAR,
        label VARCHAR,
        secondary VARCHAR,
        secondary_url VARCHAR,
        target_id VARCHAR,
        url VARCHAR,
        domain VARCHAR,
        origin VARCHAR,
        place_lat DOUBLE,
        place_lon DOUBLE,
        lat DOUBLE,
        lon DOUBLE,
        loc_source VARCHAR,
        is_ad BOOLEAN,
        act_id INTEGER
    `,
    columns: ACTIVITY_COLUMNS,
    toRecord: (r: ActivityRow) => ({
        timestamp: r.timestamp,
        date: r.date,
        service: r.service,
        action: r.action,
        label: r.label,
        secondary: r.secondary,
        secondary_url: r.secondaryUrl,
        target_id: r.targetId,
        url: r.url,
        domain: r.domain,
        origin: r.origin,
        place_lat: r.placeLat,
        place_lon: r.placeLon,
        lat: r.lat,
        lon: r.lon,
        loc_source: r.locSource,
        is_ad: r.isAd,
    }),
    dedupeSql: activityDedupeSql,
};

/**
 * Insert Google "My Activity" rows, **appending** to whatever is already there.
 * `timestamp`/`date` are named as in the three other sources, so the shared
 * date-filter helpers and any cross-source join work unchanged.
 *
 * One table for every service, keyed by `service`: the whole export shares a
 * single schema, and only the meaning of `label` changes between them.
 *
 * Appending mirrors `insertMessages` — a Takeout can be imported service by
 * service — so duplicates are possible and rows go through a temp table first.
 * The natural key is (service, timestamp, action, label, url); its cost is that
 * two identical actions logged in the same second collapse into one. Rare, and
 * far less damaging than a double import.
 *
 * @throws {Error} If database is not initialized.
 */
export async function insertGoogleActivity(rows: ActivityRow[]): Promise<void> {
    await insertStaged(GOOGLE_ACTIVITY_TABLE, rows);
    if (rows.length === 0) return;
    // Stable per-row key, mirroring seg_id / msg_index.
    const connection = await getConnection();
    await connection.query(`UPDATE ${GOOGLE_ACTIVITY_TABLE.table} SET act_id = rowid`);
}
