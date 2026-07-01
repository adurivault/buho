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
 *
 * `onProgress` is called after each statement completes with the fraction in
 * [0, 1] of statements done, so the UI can show real attribution progress (this
 * is the slow part of an upload).
 */
export async function attributeZones(
    onProgress?: (fraction: number) => void
): Promise<void> {
    const total = ATTRIBUTION_STATEMENTS.length;
    for (let i = 0; i < total; i++) {
        await query(ATTRIBUTION_STATEMENTS[i]);
        onProgress?.((i + 1) / total);
    }
}
