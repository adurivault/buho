/**
 * SQL that attributes each GPS point to its geographic zones. Kept as plain
 * statements (no db import) so the headless test runs the exact same SQL against
 * the node-blocking DuckDB bundle.
 *
 * v2 "leaf-zones" model: `geo_zones` is a single layer where each polygon is the
 * finest admin unit of its territory and carries its full hierarchy in columns
 * (country / region / department / arrondissement). Attribution is therefore a
 * single `ST_Contains` per position that reads those columns — parent↔child
 * consistency is guaranteed by construction. Everything is a spatial JOIN (not a
 * correlated subquery) so the RTREE indexes from loadGeoAssets are used and it
 * stays within the in-browser memory cap.
 *
 * Batched by position: the spatial joins are by far the slow part of an upload,
 * so instead of one monolithic pass we split the distinct positions into batches
 * (a `batch` column on `loc`) and resolve one batch per statement. Each position
 * is attributed independently (leaf → buffer → ocean → city, all partitioned by
 * position), so the union of the batches is identical to a single pass — but the
 * UI gets a real, steadily advancing progress signal.
 *
 * Pipeline (all in-browser, no network with user coordinates):
 *   setup    — distinct positions rounded to DEDUP_DECIMALS (~11 m) tagged with a
 *              batch id; empty `location_zones` accumulator; segment columns.
 *   perBatch — for one batch: single leaf containment → hierarchy; coastal buffer
 *              fallback (a point just offshore still counts as on land, e.g. NYC);
 *              ocean fallback; nearest city (most populous in a small cluster);
 *              append the resolved rows to `location_zones`.
 *   finalize — copy the resolved columns onto every segment (join on position).
 */

/** Rounding used to deduplicate positions (~11 m at 4 decimals). */
export const DEDUP_DECIMALS = 4;

/** Max distance (km) to attach a "nearest city"; beyond this it's NULL (rural). */
export const NEAREST_CITY_MAX_KM = 30;

/**
 * Cluster radius (km) for collapsing sub-divisions into their parent city.
 * Among cities within `d_min + CITY_CLUSTER_KM` we take the most populous, so a
 * point lands on Paris rather than "Paris 04" (kept distinct: Versailles, 17 km).
 */
export const CITY_CLUSTER_KM = 5;

/** Candidate radius (degrees) for the nearest-city join — comfortably > 30 km. */
const CITY_CANDIDATE_DEG = 0.4;

/**
 * Coastline buffer (degrees, ~0.05° ≈ 5.5 km). Simplified leaf polygons are
 * coarse at coasts, so a shore point can fall just outside; a point within this
 * margin of land counts as in the nearest leaf ("feet in the water → still in
 * NYC"), while open-sea points fall through to the ocean polygons.
 */
export const COUNTRY_COAST_BUFFER_DEG = 0.05;

/**
 * Distinct positions per batch. Large enough that per-statement overhead stays
 * negligible, small enough that a big timeline yields many batches (→ a smoothly
 * moving progress bar). ~11 m dedup means positions are already far fewer than
 * raw segments.
 */
export const DEFAULT_BATCH_SIZE = 20000;

const R = DEDUP_DECIMALS;

/**
 * One-time statements before the per-batch loop: dedup positions into `loc` with
 * a `batch` id, create the empty `location_zones` accumulator, add the segment
 * columns. `batchSize` is inlined (integer literal) so the headless test can run
 * the exact same SQL with a small size to exercise multiple batches.
 */
export function buildSetupStatements(batchSize: number = DEFAULT_BATCH_SIZE): string[] {
  const size = Math.max(1, Math.trunc(batchSize));
  return [
    // Insertion order doesn't matter (every read uses ORDER BY); frees memory.
    `SET preserve_insertion_order = false`,

    // Distinct positions with a point geometry, tagged with a batch id.
    `CREATE OR REPLACE TABLE loc AS
     SELECT lat_k, lon_k, ST_Point(lon_k, lat_k) AS pt,
            CAST(floor((row_number() OVER () - 1) / ${size}) AS INTEGER) AS batch
     FROM (SELECT DISTINCT round(lat, ${R}) AS lat_k, round(lon, ${R}) AS lon_k
           FROM google_maps_segments WHERE lat IS NOT NULL AND lon IS NOT NULL)`,

    // Accumulator: one resolved row per position, filled batch by batch.
    `CREATE OR REPLACE TABLE location_zones (
       lat_k DOUBLE, lon_k DOUBLE, country VARCHAR, region VARCHAR,
       department VARCHAR, arrondissement VARCHAR, nearest_city VARCHAR, city_km DOUBLE
     )`,

    // Segment columns (idempotent) so finalize can write them.
    `ALTER TABLE google_maps_segments ADD COLUMN IF NOT EXISTS country VARCHAR`,
    `ALTER TABLE google_maps_segments ADD COLUMN IF NOT EXISTS region VARCHAR`,
    `ALTER TABLE google_maps_segments ADD COLUMN IF NOT EXISTS department VARCHAR`,
    `ALTER TABLE google_maps_segments ADD COLUMN IF NOT EXISTS nearest_city VARCHAR`,
    `ALTER TABLE google_maps_segments ADD COLUMN IF NOT EXISTS city_km DOUBLE`,
    `ALTER TABLE google_maps_segments ADD COLUMN IF NOT EXISTS arrondissement VARCHAR`,
  ];
}

/**
 * Resolve one batch of positions and append them to `location_zones`. Mirrors the
 * leaf → coastal-buffer → ocean → city resolution, restricted to `batch = id`.
 * `id` is inlined as an integer literal (internally computed, never user input).
 */
export function attributionBatchSql(id: number): string {
  const b = Math.trunc(id);
  return `INSERT INTO location_zones
    WITH bat AS (SELECT lat_k, lon_k, pt FROM loc WHERE batch = ${b}),

    -- single leaf containment → read the embedded hierarchy.
    j_leaf AS (
      SELECT lat_k, lon_k,
        ANY_VALUE(z.country_code) AS country_code, ANY_VALUE(z.country) AS country,
        ANY_VALUE(z.region) AS region, ANY_VALUE(z.department) AS department,
        ANY_VALUE(z.arrondissement) AS arrondissement
      FROM bat JOIN geo_zones z ON z.level <> 'ocean' AND ST_Contains(z.geom, bat.pt)
      GROUP BY lat_k, lon_k
    ),

    -- coastal fallback: nearest leaf within the buffer, only for misses.
    buf_miss AS (
      SELECT bat.* FROM bat LEFT JOIN j_leaf c USING (lat_k, lon_k) WHERE c.country_code IS NULL
    ),
    buf_cand AS (
      SELECT m.lat_k, m.lon_k, z.country_code, z.country, z.region, z.department, z.arrondissement,
             ST_Distance(z.geom, m.pt) AS d
      FROM buf_miss m JOIN geo_zones z
        ON z.level <> 'ocean' AND ST_DWithin(z.geom, m.pt, ${COUNTRY_COAST_BUFFER_DEG})
    ),
    buf_rk AS (SELECT *, ROW_NUMBER() OVER (PARTITION BY lat_k, lon_k ORDER BY d) AS rn FROM buf_cand),
    j_buf AS (
      SELECT lat_k, lon_k, country_code, country, region, department, arrondissement
      FROM buf_rk WHERE rn = 1
    ),

    -- ocean/sea for points still unmatched.
    ocean_miss AS (
      SELECT bat.* FROM bat
      LEFT JOIN j_leaf c USING (lat_k, lon_k)
      LEFT JOIN j_buf b USING (lat_k, lon_k)
      WHERE c.country_code IS NULL AND b.country_code IS NULL
    ),
    j_ocean AS (
      SELECT m.lat_k, m.lon_k, ANY_VALUE(z.country_code) AS country_code, ANY_VALUE(z.country) AS country
      FROM ocean_miss m JOIN geo_zones z ON z.level = 'ocean' AND ST_Contains(z.geom, m.pt)
      GROUP BY m.lat_k, m.lon_k
    ),

    -- resolved hierarchy per position (leaf → coastal buffer → ocean).
    loc_zone AS (
      SELECT l.lat_k, l.lon_k, l.pt,
        COALESCE(le.country_code, b.country_code, o.country_code) AS country_code,
        COALESCE(le.country, b.country, o.country) AS country,
        COALESCE(le.region, b.region) AS region,
        COALESCE(le.department, b.department) AS department,
        COALESCE(le.arrondissement, b.arrondissement) AS arrondissement
      FROM bat l
      LEFT JOIN j_leaf le USING (lat_k, lon_k)
      LEFT JOIN j_buf b USING (lat_k, lon_k)
      LEFT JOIN j_ocean o USING (lat_k, lon_k)
    ),

    -- nearest city: candidates within radius, keep ≤30 km, then most populous
    -- within d_min + cluster (tie-break nearest).
    city_near AS (
      SELECT lc.lat_k, lc.lon_k, g.name, g.population, ST_Distance_Sphere(g.geom, lc.pt) / 1000.0 AS km
      FROM loc_zone lc JOIN geo_cities g
        ON g.country_code = lc.country_code AND ST_DWithin(g.geom, lc.pt, ${CITY_CANDIDATE_DEG})
    ),
    city_flt AS (SELECT * FROM city_near WHERE km <= ${NEAREST_CITY_MAX_KM}),
    city_dm AS (SELECT *, MIN(km) OVER (PARTITION BY lat_k, lon_k) AS dmin FROM city_flt),
    city_cl AS (
      SELECT *, ROW_NUMBER() OVER (PARTITION BY lat_k, lon_k ORDER BY population DESC, km ASC) AS rn
      FROM city_dm WHERE km <= dmin + ${CITY_CLUSTER_KM}
    ),
    j_city AS (SELECT lat_k, lon_k, name AS nearest_city, km AS city_km FROM city_cl WHERE rn = 1)

    SELECT z.lat_k, z.lon_k, z.country, z.region, z.department, z.arrondissement,
      ci.nearest_city, ci.city_km
    FROM loc_zone z LEFT JOIN j_city ci USING (lat_k, lon_k)`;
}

/** Copy the resolved attributes onto every segment (join on the rounded position). */
export const FINALIZE_STATEMENTS: string[] = [
  `UPDATE google_maps_segments s
   SET country = lz.country, region = lz.region, department = lz.department,
       nearest_city = lz.nearest_city, city_km = lz.city_km, arrondissement = lz.arrondissement
   FROM location_zones lz
   WHERE round(s.lat, ${R}) = lz.lat_k AND round(s.lon, ${R}) = lz.lon_k`,
];
