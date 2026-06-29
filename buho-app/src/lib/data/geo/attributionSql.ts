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
 * Pipeline (all in-browser, no network with user coordinates):
 *   1. loc        — distinct positions rounded to DEDUP_DECIMALS (~11 m); the
 *                   rounding is a join key only, lat/lon stay intact.
 *   2. j_leaf     — single leaf containment → hierarchy columns.
 *   3. j_buf      — coastal fallback: nearest leaf within a small buffer (a point
 *                   just offshore still counts as on land, e.g. NYC).
 *   4. j_ocean    — ocean/sea polygons for points still unmatched.
 *   5. loc_zone   — resolved hierarchy (leaf → buffer → ocean).
 *   6. j_city     — nearest city (point-based; most populous in a small cluster).
 *   7. enrich google_maps_segments with the columns.
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

const R = DEDUP_DECIMALS;

export const ATTRIBUTION_STATEMENTS: string[] = [
  // Insertion order doesn't matter (every read uses ORDER BY); frees memory.
  `SET preserve_insertion_order = false`,

  // 1. distinct positions with a point geometry.
  `CREATE OR REPLACE TABLE loc AS
   SELECT lat_k, lon_k, ST_Point(lon_k, lat_k) AS pt
   FROM (SELECT DISTINCT round(lat, ${R}) AS lat_k, round(lon, ${R}) AS lon_k
         FROM google_maps_segments WHERE lat IS NOT NULL AND lon IS NOT NULL)`,

  // 2. single leaf containment → read the embedded hierarchy.
  `CREATE OR REPLACE TABLE j_leaf AS
   SELECT lat_k, lon_k,
     ANY_VALUE(z.country_code) AS country_code, ANY_VALUE(z.country) AS country,
     ANY_VALUE(z.region) AS region, ANY_VALUE(z.department) AS department,
     ANY_VALUE(z.arrondissement) AS arrondissement
   FROM loc JOIN geo_zones z ON z.level <> 'ocean' AND ST_Contains(z.geom, loc.pt)
   GROUP BY lat_k, lon_k`,

  // 3. coastal fallback: nearest leaf within the buffer, only for misses.
  `CREATE OR REPLACE TABLE j_buf AS
   WITH miss AS (
     SELECT loc.* FROM loc LEFT JOIN j_leaf c USING (lat_k, lon_k) WHERE c.country_code IS NULL
   ),
   cand AS (
     SELECT m.lat_k, m.lon_k, z.country_code, z.country, z.region, z.department, z.arrondissement,
            ST_Distance(z.geom, m.pt) AS d
     FROM miss m JOIN geo_zones z
       ON z.level <> 'ocean' AND ST_DWithin(z.geom, m.pt, ${COUNTRY_COAST_BUFFER_DEG})
   ),
   rk AS (SELECT *, ROW_NUMBER() OVER (PARTITION BY lat_k, lon_k ORDER BY d) AS rn FROM cand)
   SELECT lat_k, lon_k, country_code, country, region, department, arrondissement FROM rk WHERE rn = 1`,

  // 4. ocean/sea for points still unmatched.
  `CREATE OR REPLACE TABLE j_ocean AS
   WITH miss AS (
     SELECT loc.* FROM loc
     LEFT JOIN j_leaf c USING (lat_k, lon_k)
     LEFT JOIN j_buf b USING (lat_k, lon_k)
     WHERE c.country_code IS NULL AND b.country_code IS NULL
   )
   SELECT m.lat_k, m.lon_k, ANY_VALUE(z.country_code) AS country_code, ANY_VALUE(z.country) AS country
   FROM miss m JOIN geo_zones z ON z.level = 'ocean' AND ST_Contains(z.geom, m.pt)
   GROUP BY m.lat_k, m.lon_k`,

  // 5. resolved hierarchy per position (leaf → coastal buffer → ocean).
  `CREATE OR REPLACE TABLE loc_zone AS
   SELECT l.lat_k, l.lon_k, l.pt,
     COALESCE(le.country_code, b.country_code, o.country_code) AS country_code,
     COALESCE(le.country, b.country, o.country) AS country,
     COALESCE(le.region, b.region) AS region,
     COALESCE(le.department, b.department) AS department,
     COALESCE(le.arrondissement, b.arrondissement) AS arrondissement
   FROM loc l
   LEFT JOIN j_leaf le USING (lat_k, lon_k)
   LEFT JOIN j_buf b USING (lat_k, lon_k)
   LEFT JOIN j_ocean o USING (lat_k, lon_k)`,

  // 6. nearest city: candidates within radius, keep ≤30 km, then most populous
  //    within d_min + cluster (tie-break nearest).
  `CREATE OR REPLACE TABLE j_city AS
   WITH near AS (
     SELECT lc.lat_k, lc.lon_k, g.name, g.population, ST_Distance_Sphere(g.geom, lc.pt) / 1000.0 AS km
     FROM loc_zone lc JOIN geo_cities g
       ON g.country_code = lc.country_code AND ST_DWithin(g.geom, lc.pt, ${CITY_CANDIDATE_DEG})
   ),
   flt AS (SELECT * FROM near WHERE km <= ${NEAREST_CITY_MAX_KM}),
   dm AS (SELECT *, MIN(km) OVER (PARTITION BY lat_k, lon_k) AS dmin FROM flt),
   cl AS (
     SELECT *, ROW_NUMBER() OVER (PARTITION BY lat_k, lon_k ORDER BY population DESC, km ASC) AS rn
     FROM dm WHERE km <= dmin + ${CITY_CLUSTER_KM}
   )
   SELECT lat_k, lon_k, name AS nearest_city, km AS city_km FROM cl WHERE rn = 1`,

  // 7. assemble.
  `CREATE OR REPLACE TABLE location_zones AS
   SELECT z.lat_k, z.lon_k, z.country, z.region, z.department, z.arrondissement,
     ci.nearest_city, ci.city_km
   FROM loc_zone z LEFT JOIN j_city ci USING (lat_k, lon_k)`,

  // 8. copy attributes onto every segment (join on the rounded position).
  `ALTER TABLE google_maps_segments ADD COLUMN IF NOT EXISTS country VARCHAR`,
  `ALTER TABLE google_maps_segments ADD COLUMN IF NOT EXISTS region VARCHAR`,
  `ALTER TABLE google_maps_segments ADD COLUMN IF NOT EXISTS department VARCHAR`,
  `ALTER TABLE google_maps_segments ADD COLUMN IF NOT EXISTS nearest_city VARCHAR`,
  `ALTER TABLE google_maps_segments ADD COLUMN IF NOT EXISTS city_km DOUBLE`,
  `ALTER TABLE google_maps_segments ADD COLUMN IF NOT EXISTS arrondissement VARCHAR`,
  `UPDATE google_maps_segments s
   SET country = lz.country, region = lz.region, department = lz.department,
       nearest_city = lz.nearest_city, city_km = lz.city_km, arrondissement = lz.arrondissement
   FROM location_zones lz
   WHERE round(s.lat, ${R}) = lz.lat_k AND round(s.lon, ${R}) = lz.lon_k`,
];
