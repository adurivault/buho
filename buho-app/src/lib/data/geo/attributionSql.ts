/**
 * SQL for attributing each GPS point to its geographic zones. Kept as plain
 * statements (no db import) so the headless test runs the exact same SQL against
 * the node-blocking DuckDB bundle.
 *
 * Everything is expressed as spatial JOINs (not correlated subqueries): with the
 * RTREE indexes created in loadGeoAssets, DuckDB streams them and uses the index.
 * The earlier correlated-subquery form nested-looped over the 4500+ world ADM1
 * polygons per point and blew the in-browser memory cap (OOM at ~3 GB).
 *
 * Pipeline (all in-browser, no network with user coordinates):
 *   1. loc            — distinct positions rounded to DEDUP_DECIMALS (~11 m). The
 *      rounding is a join key only; google_maps_segments.lat/lon stay intact.
 *   2. country        — containment join; coastal points just offshore caught by
 *      a buffered nearest pass (j_buf); else ocean/sea polygons (j_ocean).
 *   3. region/dept    — containment joins, prefiltered by country.
 *   4. city           — nearest within 30 km, most populous in a small cluster
 *      (collapses GeoNames sub-divisions into Paris/Madrid/Marseille).
 *   5. arrondissement — nearest FR sub-point, for Paris/Lyon/Marseille only.
 *   6. location_zones — assembled; then copied onto every segment.
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

/** Candidate radius (degrees) for the arrondissement sub-point join. */
const ARR_CANDIDATE_DEG = 0.1;

/**
 * Coastline buffer (degrees, ~0.05° ≈ 5.5 km) for the country test. The 50m
 * country polygons are coarse at coasts, so a shore point can fall just outside
 * (Manhattan/NYC). A point within this margin of the land counts as in the
 * country — "feet in the water → still in NYC" — while open-sea points fall
 * through to the ocean polygons.
 */
export const COUNTRY_COAST_BUFFER_DEG = 0.05;

/** Cities with municipal arrondissements (the only French cities that have them). */
const ARRONDISSEMENT_CITIES = "('Paris', 'Lyon', 'Marseille')";

const R = DEDUP_DECIMALS;

export const ATTRIBUTION_STATEMENTS: string[] = [
  // Insertion order doesn't matter (every read uses ORDER BY); frees memory.
  `SET preserve_insertion_order = false`,

  // 1. distinct positions with a point geometry.
  `CREATE OR REPLACE TABLE loc AS
   SELECT lat_k, lon_k, ST_Point(lon_k, lat_k) AS pt
   FROM (SELECT DISTINCT round(lat, ${R}) AS lat_k, round(lon, ${R}) AS lon_k
         FROM google_maps_segments WHERE lat IS NOT NULL AND lon IS NOT NULL)`,

  // 2a. country by exact containment.
  `CREATE OR REPLACE TABLE j_country AS
   SELECT lat_k, lon_k, ANY_VALUE(z.country_code) AS country_code, ANY_VALUE(z.name) AS country
   FROM loc JOIN geo_zones z ON z.level = 'country' AND ST_Contains(z.geom, loc.pt)
   GROUP BY lat_k, lon_k`,

  // 2b. coastal fallback: nearest country within the buffer, only for misses.
  `CREATE OR REPLACE TABLE j_buf AS
   WITH miss AS (
     SELECT loc.* FROM loc LEFT JOIN j_country c USING (lat_k, lon_k)
     WHERE c.country_code IS NULL
   ),
   cand AS (
     SELECT m.lat_k, m.lon_k, z.country_code, z.name, ST_Distance(z.geom, m.pt) AS d
     FROM miss m JOIN geo_zones z
       ON z.level = 'country' AND ST_DWithin(z.geom, m.pt, ${COUNTRY_COAST_BUFFER_DEG})
   ),
   rk AS (SELECT *, ROW_NUMBER() OVER (PARTITION BY lat_k, lon_k ORDER BY d) AS rn FROM cand)
   SELECT lat_k, lon_k, country_code, name AS country FROM rk WHERE rn = 1`,

  // 2c. ocean/sea for points still unmatched.
  `CREATE OR REPLACE TABLE j_ocean AS
   WITH miss AS (
     SELECT loc.* FROM loc
     LEFT JOIN j_country c USING (lat_k, lon_k)
     LEFT JOIN j_buf b USING (lat_k, lon_k)
     WHERE c.country_code IS NULL AND b.country_code IS NULL
   )
   SELECT m.lat_k, m.lon_k, ANY_VALUE(z.country_code) AS country_code, ANY_VALUE(z.name) AS country
   FROM miss m JOIN geo_zones z ON z.level = 'ocean' AND ST_Contains(z.geom, m.pt)
   GROUP BY m.lat_k, m.lon_k`,

  // 2d. resolved country per location (land → coastal buffer → ocean).
  `CREATE OR REPLACE TABLE loc_country AS
   SELECT l.lat_k, l.lon_k, l.pt,
     COALESCE(c.country_code, b.country_code, o.country_code) AS country_code,
     COALESCE(c.country, b.country, o.country) AS country
   FROM loc l
   LEFT JOIN j_country c USING (lat_k, lon_k)
   LEFT JOIN j_buf b USING (lat_k, lon_k)
   LEFT JOIN j_ocean o USING (lat_k, lon_k)`,

  // 3. region & department by containment, prefiltered by country.
  `CREATE OR REPLACE TABLE j_region AS
   SELECT lc.lat_k, lc.lon_k, ANY_VALUE(z.name) AS region
   FROM loc_country lc JOIN geo_zones z
     ON z.level = 'region' AND z.country_code = lc.country_code AND ST_Contains(z.geom, lc.pt)
   GROUP BY lc.lat_k, lc.lon_k`,

  `CREATE OR REPLACE TABLE j_dept AS
   SELECT lc.lat_k, lc.lon_k, ANY_VALUE(z.name) AS department
   FROM loc_country lc JOIN geo_zones z
     ON z.level = 'department' AND z.country_code = lc.country_code AND ST_Contains(z.geom, lc.pt)
   GROUP BY lc.lat_k, lc.lon_k`,

  // 4. nearest city: candidates within radius, keep ≤30 km, then most populous
  //    within d_min + cluster (tie-break nearest).
  `CREATE OR REPLACE TABLE j_city AS
   WITH near AS (
     SELECT lc.lat_k, lc.lon_k, g.name, g.population, ST_Distance_Sphere(g.geom, lc.pt) / 1000.0 AS km
     FROM loc_country lc JOIN geo_cities g
       ON g.country_code = lc.country_code AND ST_DWithin(g.geom, lc.pt, ${CITY_CANDIDATE_DEG})
   ),
   flt AS (SELECT * FROM near WHERE km <= ${NEAREST_CITY_MAX_KM}),
   dm AS (SELECT *, MIN(km) OVER (PARTITION BY lat_k, lon_k) AS dmin FROM flt),
   cl AS (
     SELECT *, ROW_NUMBER() OVER (PARTITION BY lat_k, lon_k ORDER BY population DESC, km ASC) AS rn
     FROM dm WHERE km <= dmin + ${CITY_CLUSTER_KM}
   )
   SELECT lat_k, lon_k, name AS nearest_city, km AS city_km FROM cl WHERE rn = 1`,

  // 5. arrondissement: true nearest FR sub-point (gated to Paris/Lyon/Marseille below).
  `CREATE OR REPLACE TABLE j_arr AS
   WITH near AS (
     SELECT lc.lat_k, lc.lon_k, g.name, ST_Distance(g.geom, lc.pt) AS d
     FROM loc_country lc JOIN geo_cities g
       ON lc.country_code = 'FRA' AND g.country_code = 'FRA' AND ST_DWithin(g.geom, lc.pt, ${ARR_CANDIDATE_DEG})
   ),
   rk AS (SELECT *, ROW_NUMBER() OVER (PARTITION BY lat_k, lon_k ORDER BY d ASC) AS rn FROM near)
   SELECT lat_k, lon_k, name AS arr FROM rk WHERE rn = 1`,

  // 6. assemble.
  `CREATE OR REPLACE TABLE location_zones AS
   SELECT lc.lat_k, lc.lon_k, lc.country, r.region, d.department,
     ci.nearest_city, ci.city_km,
     CASE WHEN ci.nearest_city IN ${ARRONDISSEMENT_CITIES}
            AND a.arr IS NOT NULL AND a.arr <> ci.nearest_city
          THEN a.arr END AS arrondissement
   FROM loc_country lc
   LEFT JOIN j_region r USING (lat_k, lon_k)
   LEFT JOIN j_dept d USING (lat_k, lon_k)
   LEFT JOIN j_city ci USING (lat_k, lon_k)
   LEFT JOIN j_arr a USING (lat_k, lon_k)`,

  // 7. copy attributes onto every segment (join on the rounded position).
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
