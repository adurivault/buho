# Implementation plan — Geographic attribution of points

> Scope: **only** attaching each GPS point to its zones (country / region / department / city). The basemap, tiles, and rendering are **out of scope** here (see PRD §8).
> Reference: [prd-google-maps-geo.md](./prd-google-maps-geo.md). Settled decisions: DuckDB spatial (verified v1.4.3), everything eager, finest = ADM2, city = nearest via GeoNames `cities5000`.

## Guiding principle (perf)

We do **not** run point-in-polygon over the 10⁵–10⁶ raw points. We deduplicate positions first (round to ~110 m), attribute the **distinct positions** (typically 10³–10⁴), then join back onto the segments. This makes the joins tractable **without depending on the RTREE index** (unverified to date), and it stays valid up to the department scale.

## Dependencies

- **Runtime**: `topojson-client` (re-expand TopoJSON → GeoJSON, tiny).
- **Build/dev**: `mapshaper` (simplification + conversion; in `devDependencies` or via `npx`).
- No map dependency here (deck.gl / MapLibre = a separate batch).

## File map

| File | Nature | Role |
| --- | --- | --- |
| `buho-app/scripts/build-geo-assets.mjs` | new (offline) | Downloads, simplifies, normalizes → `static/geo/` |
| `buho-app/static/geo/adm0.topojson` | generated asset | Countries (Natural Earth, world) |
| `buho-app/static/geo/adm1.topojson` | generated asset | Regions/states (Natural Earth, world) |
| `buho-app/static/geo/adm2-fr.topojson` | generated asset | FR departments (geoBoundaries / france-geojson) |
| `buho-app/static/geo/cities5000.json` | generated asset | GeoNames cities (name, lat, lon, country, admin1, pop) |
| `buho-app/src/lib/data/geo/loadGeoAssets.ts` | new | Loads `geo_zones` + `geo_cities` into DuckDB |
| `buho-app/src/lib/data/geo/attributeZones.ts` | new | Deduplicates, attributes, enriches `google_maps_segments` |
| `buho-app/src/lib/data/db.ts` | modified | `loadSpatial()` (INSTALL/LOAD spatial, lazy) |
| `buho-app/src/lib/stores/dataStore.svelte.ts` | modified | Hook after `insertLocationSegments` |
| `buho-app/src/lib/data/queries/geo.ts` | new | Consumption queries (top countries, cities, etc.) |
| `buho-app/src/lib/data/geo/attributeZones.integration.manual.ts` | new | End-to-end test (see §Tests) |

---

## Step 0 — Prepare the assets (offline, one-off)

`scripts/build-geo-assets.mjs` (run by hand, re-run when adding a country):

1. **Download**: Natural Earth ADM0 + ADM1; geoBoundaries/france-geojson ADM2 FR; GeoNames `cities5000.zip`.
2. **Simplify** (mapshaper, Visvalingam, aggressive — precision of ~a few hundred m is OK):
   ```bash
   mapshaper ne_10m_admin_0_countries.shp \
     -simplify visvalingam 8% keep-shapes -clean \
     -o format=topojson static/geo/adm0.topojson
   ```
3. **Normalize properties** at build time so the runtime is source-agnostic → each feature carries `{ country_code (ISO3), zone_id, name }`. (Natural Earth: `ADM0_A3`/`ADMIN`; ADM1: `adm0_a3`/`name`; geoBoundaries: `shapeISO`/`shapeName`.)
4. **Cities**: extract from `cities5000.txt` (TSV) the useful columns → `cities5000.json` `[{name, lat, lon, country_code(ISO3), admin1, population}]`.

> The raw downloads are **not** committed (large); only the simplified `static/geo/*` files are. Document sources + licenses (geoBoundaries & GeoNames = CC-BY → credit in the app).

**Checkpoint**: `static/geo/*` sizes match PRD §4 (adm0 ~100 KB, adm1 ~1-2 MB, cities ~1.5-2 MB).

---

## Step 1 — Load the spatial extension (lazy)

In `db.ts`, a dedicated function called **only** on the Google Maps path (Spotify users don't pay the CDN fetch):

```ts
let spatialLoaded = false;
export async function loadSpatial(): Promise<void> {
  if (spatialLoaded) return;
  const c = await getConnection();
  await c.query('INSTALL spatial');
  await c.query('LOAD spatial');
  spatialLoaded = true;
}
```

**Checkpoint**: `SELECT ST_Contains(ST_GeomFromText('POLYGON((2 48,3 48,3 49,2 49,2 48))'), ST_Point(2.35,48.85))` → `true` (already validated outside the app).

---

## Step 2 — Load the reference tables (`geo_zones`, `geo_cities`)

`loadGeoAssets.ts` — idempotent (reference data, independent of the user; load once per session):

```ts
import { feature } from 'topojson-client';
// 1. geo_zones
await query(`CREATE TABLE IF NOT EXISTS geo_zones (
  level VARCHAR, country_code VARCHAR, zone_id VARCHAR, name VARCHAR, geom GEOMETRY)`);
for (const [level, url] of [['country','/geo/adm0.topojson'],
                            ['region','/geo/adm1.topojson'],
                            ['department','/geo/adm2-fr.topojson']]) {
  const topo = await (await fetch(url)).json();
  const fc = feature(topo, Object.values(topo.objects)[0]);
  const rows = fc.features.map(f => ({
    level, country_code: f.properties.country_code,
    zone_id: f.properties.zone_id, name: f.properties.name,
    geom_text: JSON.stringify(f.geometry),
  }));
  // staging JSON → INSERT ... ST_GeomFromGeoJSON(geom_text)
}
```

Insertion: reuse the `registerFileText` + `read_json_auto` pattern from `insertData`, into a staging table `(…, geom_text VARCHAR)`, then:
```sql
INSERT INTO geo_zones SELECT level, country_code, zone_id, name, ST_GeomFromGeoJSON(geom_text) FROM _staging;
```
`geo_cities`: same topo, geometry `ST_Point(lon, lat)`.

**Checkpoint**: `SELECT level, count(*) FROM geo_zones GROUP BY 1` consistent (~250 / ~3600 / ~101); `SELECT count(*) FROM geo_cities` ≈ 52k.

---

## Step 3 — Attribute (`attributeZones.ts`)

Replayed on **every upload** (depends on user data). Three sub-steps in SQL.

**3a. Distinct positions** (the perf key):
```sql
CREATE OR REPLACE TABLE segment_locations AS
SELECT DISTINCT round(lat,3) AS lat_k, round(lon,3) AS lon_k
FROM google_maps_segments WHERE lat IS NOT NULL AND lon IS NOT NULL;
```

**3b. Attribute the distinct positions** (country first, then region/department pre-filtered by country; city pre-filtered by country + radius guardrail):
```sql
CREATE OR REPLACE TABLE location_zones AS
WITH base AS (SELECT lat_k, lon_k, ST_Point(lon_k, lat_k) AS pt FROM segment_locations),
ctry AS (
  SELECT b.*,
    (SELECT z.country_code FROM geo_zones z
       WHERE z.level='country' AND ST_Contains(z.geom, b.pt) LIMIT 1) AS country_code,
    (SELECT z.name FROM geo_zones z
       WHERE z.level='country' AND ST_Contains(z.geom, b.pt) LIMIT 1) AS country
  FROM base b)
SELECT c.lat_k, c.lon_k, c.country_code, c.country,
  (SELECT z.name FROM geo_zones z WHERE z.level='region'
     AND z.country_code=c.country_code AND ST_Contains(z.geom,c.pt) LIMIT 1) AS region,
  (SELECT z.name FROM geo_zones z WHERE z.level='department'
     AND z.country_code=c.country_code AND ST_Contains(z.geom,c.pt) LIMIT 1) AS department,
  city.name AS nearest_city, city.km AS city_km
FROM ctry c
LEFT JOIN LATERAL (
  SELECT g.name, ST_Distance_Sphere(g.geom, c.pt)/1000 AS km
  FROM geo_cities g WHERE g.country_code = c.country_code
  ORDER BY ST_Distance(g.geom, c.pt) LIMIT 1
) city ON city.km <= 30;   -- max radius → otherwise nearest_city = NULL
```

**3c. Enrich the segments** (ALTER + UPDATE…FROM, join on the rounded positions):
```sql
ALTER TABLE google_maps_segments ADD COLUMN country VARCHAR;      -- + region, department, nearest_city, city_km
UPDATE google_maps_segments s
SET country=lz.country, region=lz.region, department=lz.department,
    nearest_city=lz.nearest_city, city_km=lz.city_km
FROM location_zones lz
WHERE round(s.lat,3)=lz.lat_k AND round(s.lon,3)=lz.lon_k;
```
`place_id` is already a column on the segments → nothing to do for places at this stage (cf. PRD §7, backfill = later phase).

**Checkpoint**: `SELECT count(*) total, count(country) attributed, count(nearest_city) with_city FROM google_maps_segments` → country attribution rate ≈ 100%, city reasonable. Inspect a few known rows (a point in Paris → France / Île-de-France / Paris / Paris).

---

## Step 4 — Wire into the flow

`dataStore.svelte.ts`, after `insertLocationSegments(...)`, on the Google Maps path only:
```ts
await loadSpatial();
await loadGeoAssets();     // idempotent
await attributeZones();
```
Expose a state (`geoAttributionReady`) so the sections know the columns are ready.

## Step 5 — Query layer (`queries/geo.ts`)

camelCase queries via `query<T>()`, e.g.:
- `topCountries()` — duration/visits per `country`.
- `topCities()` — per `nearest_city` (+ `population`, `city_km`).
- `regionBreakdown(country)` — region/department split of a country.
- `timeAbroad()` — share of time outside the country of residence.

These queries feed the `/google-maps/guide` sections and the `/google-maps/explore` views (separate batch).

## Tests & verification

- **Headless spatial SQL**: unlike the worker pipeline (skipped in JSDOM), the **`duckdb-node-blocking.cjs`** bundle loads `spatial` in Node (demonstrated during verification). So we can write a **real automated test** of the attribution on a tiny set of positions (Paris, London, New York, a point at sea) + a tiny synthetic `geo_zones`/`geo_cities`. To frame in `attributeZones.integration.manual.ts` (or a dedicated Node harness).
- **Pure unit tests**: property mapping at build, rounding expression, radius-guardrail logic.
- **Network invariant**: `npm test` (the existing `stores.test.ts` keeps the no-persistence guarantee); verify no call leaves with coordinates (only the static `/geo/*` assets + the `extensions.duckdb.org` extension go out).
- `npm run check` (types).

## Suggested sequencing

1. Step 0 (FR + world assets) → 2. loadSpatial → 3. loadGeoAssets → 4. attributeZones (country only first, checkpoint) → 5. add region → department → city → 6. wire dataStore → 7. queries/geo.ts.

Each notch has a verifiable SQL checkpoint before adding the next level.

## Decisions (settled) & implementation

1. Finest v1 = **department** (municipality = later phase 3).
2. ADM2 = **France only**.
3. Max city radius = **30 km** (`NEAREST_CITY_MAX_KM`).
4. Position dedup = **4 decimals (~11 m)** (`DEDUP_DECIMALS`). The rounding is just a join key: `google_maps_segments.lat/lon` stay intact for precise map placement.

State: **implemented and tested** (`npm test` → headless DuckDB spatial via the `duckdb-node-blocking` bundle; `npm run check` clean). Assets generated in `static/geo/` (adm0 236 KB, adm1 99 KB, adm2-fr 205 KB, cities5000 6.4 MB / 64k cities).

Two pitfalls revealed by validation on real data (encoded in the code):

- **Coastlines:** the `…-version-simplifiee.geojson` files from france-geojson over-simplify coastlines (a point in Ajaccio fell outside Corse-du-Sud). We start from the **full** file and simplify ourselves at 20% (preserves Ajaccio/Nice/Brest/Biarritz). Same for world ADM0 at 25% (otherwise Marseille falls outside France).
- **Arrondissements:** GeoNames lists arrondissements/neighborhoods (Paris 04, Marseille 02, Sol) as points coded `PPL` (like real cities), with high population → they win the "nearest". Fix: among the cities of a same cluster (`d_min + CITY_CLUSTER_KM = 5 km`), take the **most populated** one (collapses sub-divisions toward Paris/Madrid/Marseille, keeps distinct neighbors like Versailles).

Remaining out of scope (non-blocking): `cities5000.json` weighs 6.4 MB uncompressed (≈1.5–2 MB gzip in transit) — to optimize later (round the coords, or Parquet) if the committed weight becomes a problem.
