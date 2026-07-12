import { query } from '../db';
import {
    buildSetupStatements,
    attributionBatchSql,
    FINALIZE_STATEMENTS,
    DEFAULT_BATCH_SIZE
} from './attributionSql';

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
 * Distinct positions are resolved in batches (the slow spatial joins are the bulk
 * of an upload), so `onProgress(processed, total)` is called after each batch with
 * the number of positions located so far — the UI can show real, steadily
 * advancing progress with a point count.
 */
export async function attributeZones(
    onProgress?: (processed: number, total: number) => void
): Promise<void> {
    const batchSize = DEFAULT_BATCH_SIZE;
    for (const sql of buildSetupStatements(batchSize)) {
        await query(sql);
    }

    const [{ total }] = await query<{ total: number }>('SELECT count(*) AS total FROM loc');
    const totalPositions = Number(total);
    const batchCount = Math.ceil(totalPositions / batchSize);

    for (let b = 0; b < batchCount; b++) {
        await query(attributionBatchSql(b));
        onProgress?.(Math.min((b + 1) * batchSize, totalPositions), totalPositions);
    }

    for (const sql of FINALIZE_STATEMENTS) {
        await query(sql);
    }
    onProgress?.(totalPositions, totalPositions);
}
