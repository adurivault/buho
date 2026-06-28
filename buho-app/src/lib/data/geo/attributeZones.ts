import { query } from '../db';
import { ATTRIBUTION_STATEMENTS } from './attributionSql';

/**
 * Attribute every `google_maps_segments` row to its geographic zones
 * (country / region / department / nearest city), adding those columns in place.
 *
 * Preconditions: the `spatial` extension is loaded (`loadSpatial`) and the
 * reference tables exist (`loadGeoAssets`). Rerun safely after each upload —
 * the segments table is dropped and rebuilt per upload, and every statement is
 * CREATE OR REPLACE / ADD COLUMN IF NOT EXISTS.
 *
 * The original `lat`/`lon` are never modified: the ~11 m rounding is only a join
 * key for deduplication, so points stay precise for map placement.
 */
export async function attributeZones(): Promise<void> {
    for (const sql of ATTRIBUTION_STATEMENTS) {
        await query(sql);
    }
}
