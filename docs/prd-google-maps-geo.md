# PRD — Google Maps geographic visualization

> Status: proposal · Source: Google Timeline exports (already parsed into `google_maps_segments`)
> Scope: interactive map + attribution of each point to multi-scale geographic zones.

## 1. Context & goal

Buho visualizes personal data **100% client-side**: no user data leaves the browser. The Google Timeline exports are already loaded into the DuckDB table `google_maps_segments` (see `lib/data/parseGoogleMaps.ts`). The routes `/google-maps/guide` (narrative) and `/google-maps/explore` (coordinated views) exist but are empty on the visualization side.

Goal of this increment:

1. **Display** the GPS points on an elegant, zoomable, interactive, free basemap.
2. **Attribute** each point to geographic zones at several scales: country → region → department → city → place.

## 2. Product promise & invariants (non-negotiable)

- **No network egress of user data.** GPS coordinates never leave the browser. → Any online reverse-geocoding API (Nominatim, Google, Mapbox) is **excluded**. Zone attribution happens **locally**.
- **No persistence** of user data (no localStorage, IndexedDB, etc.).
- Key distinction: **administrative boundaries** and **cities** are **public reference data**, not user data. Serving them statically (CDN/hosting) doesn't touch the invariant — it's like serving the JS bundle.
- Accepted network nuances, to be documented (see §9): basemap tiles reveal the *viewport* (not the data) to the tile provider; the DuckDB spatial extension is downloaded at runtime (*code*, not data).

## 3. Settled technical decisions

| Topic | Decision | Verified |
| --- | --- | --- |
| Zone computation | **DuckDB spatial** (`ST_Contains` for polygons, `ST_Distance` for nearest city), 100% in SQL in the browser | ✅ `LOAD spatial` OK on DuckDB-WASM **v1.4.3** (the project's bundle); `ST_Contains` and `ST_GeomFromGeoJSON` validated |
| Basemap | **MapLibre GL JS** + **OpenFreeMap** tiles (free, no key, no quota), dark style | — |
| Point rendering | **deck.gl** as an overlay (one Timeline export = 10⁵–10⁶ points) | — |
| Finest admin level | **Department / county (ADM2)**; the municipality (polygons) is out of v1 scope | — |
| "City" level | **Nearest city** via GeoNames `cities5000` points (no municipality polygons) | — |

## 4. Data sources

Everything is **eager** (loaded once, no lazy-loading): we stay below ADM2, so the volumes hold.

| Layer | Source | Scale | ~# features | Weight (trimmed + gzip) | License |
| --- | --- | --- | --- | --- | --- |
| Countries (ADM0) | Natural Earth | world | ~250 | ~50–120 KB | Public domain |
| Region (ADM1) | Natural Earth | world | ~3,600 | ~0.5–2 MB | Public domain |
| Department / county (ADM2) | geoBoundaries (or national sources: `france-geojson`, US Census) | curated countries (FR first, then UK/US/DE/ES/IT) | variable | a few MB | CC-BY (credit) / public domain |
| City | GeoNames `cities5000` | world | ~52,000 | ~1.5–2 MB | CC-BY (credit) |

Notes:
- Boundaries are transported as **TopoJSON** (~80% lighter than GeoJSON), re-expanded client-side with `topojson-client`, then handed to `ST_GeomFromGeoJSON`. The heavy case (future municipalities) would move to **GeoParquet**.
- **Aggressive simplification assumed** (mapshaper / Visvalingam): for point-in-polygon, an error of a few hundred meters at a zone edge is inconsequential for personal analytics.
- GeoNames carries `name, lat, lon, country, admin1, population` → the nearest city provides region + population *for free* (for the narrative).

## 5. Data flow

```
ZIP export → parseGoogleMaps → google_maps_segments (lat/lon, already in place)
                                        │
        (static assets)                 │  init / on source load
  geo_zones (ADM0/1/2)  ─────────┐      ▼
  geo_cities (cities5000) ───────┴─►  spatial joins (DuckDB)
                                        │
                                        ▼
                              segment_geo: for each point →
                              country / region / department / nearest_city / place_id
                                        │
                         ┌──────────────┴───────────────┐
                         ▼                               ▼
                /google-maps/guide              /google-maps/explore
              (narrative sections)         (MapLibre map + cross-filtering)
```

## 6. DuckDB schema

```sql
-- Administrative polygons (loaded from the assets at runtime)
CREATE TABLE geo_zones (
  level        VARCHAR,   -- 'country' | 'region' | 'department'
  country_code VARCHAR,   -- ISO 3166-1 alpha-3
  zone_id      VARCHAR,   -- stable zone identifier
  name         VARCHAR,
  geom         GEOMETRY
);

-- City points (GeoNames cities5000)
CREATE TABLE geo_cities (
  name         VARCHAR,
  country_code VARCHAR,
  admin1       VARCHAR,
  population   INTEGER,
  lat          DOUBLE,
  lon          DOUBLE,
  geom         GEOMETRY   -- ST_Point(lon, lat)
);

-- Enriched result, computed once after the source is loaded
CREATE TABLE segment_geo (
  segment_id   BIGINT,    -- stable rowid of google_maps_segments
  country      VARCHAR,
  region       VARCHAR,
  department   VARCHAR,   -- NULL outside curated countries
  nearest_city VARCHAR,   -- NULL beyond the max radius
  city_km      DOUBLE,
  place_id     VARCHAR    -- carried over from the export (stationary only)
);
```

## 7. Attribution logic

### Administrative zones (country / region / department)
Spatial join `ST_Contains(zone.geom, ST_Point(lon, lat))` per level. Valid for **all** points, including in transit.

### Nearest city
1. Pre-filter candidate cities **to the point's country** (already known via the ADM0 join) → from 52k cities down to a few dozen/hundred.
2. `ST_Distance` (or `ST_Distance_Sphere` to announce "12 km from Lyon"), keep the min.
3. **Guardrail**: if the nearest city is beyond a **max radius** (proposal: 30 km), `nearest_city = NULL` (rural area) — otherwise a point out in the countryside is misleadingly attached to a distant city.

### Places
The export only carries `placeId` (opaque) + `semanticType` (Home/Work…) on `stationary` segments. **Resolving `placeId → name/address` goes through the Places API → network → forbidden.** So, client-side, a "place" is limited to:
- the export's semantic labels (Home/Work);
- the `placeId` as an **opaque grouping key** ("you went 47× to this place", without a name);
- the city level (above) as a substitute for the named place.

**Option (later phase) — backfill the `placeId`** onto points without a place, by **temporal + spatial** neighborhood: if a point is bracketed by two visits to the **same** place → propagate that place (gap within a stay); otherwise only "snap" the endpoints close to a visit; otherwise `NULL` (in transit). Implementable with window functions (`LAST_VALUE(... IGNORE NULLS)`). To be done only if the product value is proven.

## 8. Basemap & rendering

- **MapLibre GL JS** + dark style, **OpenFreeMap** source (zero config, zero key).
- **deck.gl** `ScatterplotLayer` as an overlay for raw points; aggregations (heatmap/hexbin) for overview views.
- `/explore` stays consistent with the Spotify pattern: cross-filtering between the map and the other views (filters in a dedicated store, like `googleMapsExplorerFilters`).
- **Privacy evolution (optional)**: replace OpenFreeMap with self-hosted **Protomaps `.pmtiles`** as static → even the viewport stops leaking. A config change, not an architecture one.

## 9. Batching

**Phase 1 — map MVP + coarse zoning**
- MapLibre + OpenFreeMap basemap, points in deck.gl.
- `geo_zones` ADM0/ADM1 (Natural Earth, world, eager) + `geo_cities` (GeoNames cities5000).
- `segment_geo`: country + region + nearest_city.
- First Guide sections + Explore map.

**Phase 2 — departments + places**
- ADM2 for curated countries (FR, then UK/US/DE/ES/IT).
- Aggregation by `placeId` (frequency) + Home/Work labels.

**Phase 3 — optional / if value is proven**
- `placeId` backfill on transit/stay points.
- Municipality polygons (lazy-per-country, GeoParquet) for true FR precision.
- Self-hosted Protomaps tiles + self-hosted spatial extension (fully offline).

## 10. Risks & things to verify

- **Perf of the spatial join at scale**: N points × polygons. OK at the country/region/department scale. **DuckDB RTREE index to validate** only if we move to municipalities (phase 3) — untested to date.
- **Spatial extension = runtime CDN fetch** (~a few MB from `extensions.duckdb.org`). Doesn't breach the invariant (code, not data) but assumes being online at first load. Mitigation: self-host the `.duckdb_extension.wasm` (phase 3).
- **Tiles = viewport visible to the provider.** Acceptable, to document; Protomaps removes it (phase 3).
- **Browser memory volume**: `cities5000` (~52k points) + world ADM1 + curated-country ADM2, loaded on top of the existing tables. To monitor, expected reasonable (< a few MB of geometry memory).
- **License attribution**: credit geoBoundaries and GeoNames (CC-BY) in the app.

## 11. Open product decisions

1. **Finest admin level v1 = department (ADM2)** — confirmed? (the municipality stays out of scope).
2. **List of curated countries** for ADM2 beyond France.
3. **Max radius** for "nearest city" attachment (proposal: 30 km).
4. Do we want **Home/Work** as early as phase 2, or settle for opaque grouping by `placeId`?
