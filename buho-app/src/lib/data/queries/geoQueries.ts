import { query } from '../db';
import type { ZoneRollupRow } from '$lib/visualizations/zoneChoropleth';

/**
 * Consumption queries over the geo-enriched `google_maps_segments` (the
 * country / region / department / arrondissement columns added by attributeZones).
 * Counts/sums are CAST so rows come back as JS numbers rather than BigInt.
 */

/**
 * SQL for the zone ROLLUP, exported so the headless test runs this exact text.
 *
 * The `n` CTE mirrors `normalizePath` in zoneChoropleth.ts — country falling back
 * to region for the 16 unparented territories, and a region equal to its country
 * collapsing away. It has to happen *before* the ROLLUP so the grouping columns are
 * already canonical: normalizing afterwards would fold every unparented territory
 * into one bucket, because the depth-1 row has its region column rolled up to NULL.
 */
export const ZONE_ROLLUP_SQL = `
    WITH b AS (
        SELECT duration_seconds, distance_meters,
            NULLIF(TRIM(country), '') AS c,
            NULLIF(TRIM(region), '') AS r,
            NULLIF(TRIM(department), '') AS d,
            NULLIF(TRIM(arrondissement), '') AS a
        FROM google_maps_segments
    ), n AS (
        SELECT duration_seconds, distance_meters,
            COALESCE(c, r) AS l1,
            CASE WHEN r IS DISTINCT FROM COALESCE(c, r) THEN r END AS l2,
            d AS l3,
            a AS l4
        FROM b
    )
    SELECT
        CAST(GROUPING(l1, l2, l3, l4) AS INTEGER) AS depth_mask,
        l1 AS country, l2 AS region, l3 AS department, l4 AS arrondissement,
        CAST(SUM(duration_seconds) / 3600.0 AS DOUBLE) AS hours,
        CAST(SUM(distance_meters) / 1000.0 AS DOUBLE) AS km,
        CAST(COUNT(*) AS INTEGER) AS points
    FROM n
    WHERE l1 IS NOT NULL
      AND l1 NOT IN (
          SELECT country FROM geo_zones WHERE level = 'ocean' AND country IS NOT NULL
      )
    GROUP BY ROLLUP(l1, l2, l3, l4)
    ORDER BY depth_mask, hours DESC`;

/**
 * Time spent per geographic zone at all four depths in a single pass, for the
 * guide's choropleth.
 *
 * `ROLLUP` gives country / +region / +department / +arrondissement subtotals plus a
 * grand total; `GROUPING()` tags each row with the bitmask that says which columns
 * were rolled up, which is what makes the depths distinguishable — a row like
 * `(Spain, Madrid, NULL, NULL)` is otherwise ambiguous between "the Madrid leaf"
 * and "the subtotal for Madrid", since only France has deeper levels.
 *
 * `COUNT(DISTINCT date)` has to be computed per depth by the engine: distinct days
 * are not additive across children, so a JS roll-up could not recover a parent's
 * value from its children's.
 *
 * Ocean rows are excluded. Attribution assigns offshore points the sea name as
 * their `country`, but a sea is not an administrative zone, and its area dwarfs any
 * country's — a couple of flights would paint a huge slab of the map. There is no
 * `country_code` on the segments table, so they are identified by name against the
 * ocean layer of `geo_zones` (118 rows; loaded by loadGeoAssets, which always runs
 * before this query since the section waits on `geoVersion`).
 *
 * Note `hours` must keep its explicit `AS`: it is a keyword in bare-alias position
 * and DuckDB rejects `… / 3600.0 hours`. `GROUPING()`/`COUNT()` return BIGINT, so
 * the CASTs are what keep the rows from arriving as unusable BigInt values.
 */
export async function getZoneRollup(): Promise<ZoneRollupRow[]> {
    try {
        return await query<ZoneRollupRow>(ZONE_ROLLUP_SQL);
    } catch (error) {
        console.error('Error fetching zone rollup:', error);
        return [];
    }
}
