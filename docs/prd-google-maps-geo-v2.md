# PRD v2 — Geographic attribution: "leaf-zones" architecture

> Status: proposal · Source: Google Timeline exports (table `google_maps_segments`)
> **Relation to v1** ([prd-google-maps-geo.md](./prd-google-maps-geo.md)): this document **replaces** the *attribution logic* (v1 §6 schema, §7 logic) and the *asset production*. Everything else in v1 — network invariants, MapLibre basemap, deck.gl rendering, Guide/Explore split — **stays valid and unchanged**. v1 is kept as the reference for the initial approach (multi-source patchwork).

## 1. Why this revision

v1 attributes each point by **recomputing the hierarchy level by level at runtime**: a country test, then region, then department, each on polygons coming from **different sources** (Natural Earth 50m for countries, NE 10m for world regions, france-geojson for France, etc.). Observed consequences:

- **Boundaries that don't line up**: files simplified separately don't coincide → gaps (a point in a country but in no region) and **department ⊄ region** inconsistencies near edges.
- **Patches**: coastal buffer, specific safeguards, dependence on local quirks (e.g. an over-simplified Corsican coast ejecting a city from its department). Not scalable.
- **No materialized hierarchy**: the parent→child relationship exists nowhere as data; it is re-assembled by `GROUP BY` at query time, *assuming* consistency across columns.
- **Runtime cost**: 4–5 spatial operations per distinct position.

Product goal identical to v1 (attribute each point to country / region / department / city), but with a **universal architecture, scalable to new countries, and faster**.

## 2. Guiding principle

> **All the complex work is done at build time. At runtime, we attribute a point to a zone, and the zone already carries its hierarchy.**

1. The build produces **a single "leaf-zones" layer**: each polygon is the **finest available** administrative unit for its territory, and **carries its full hierarchy in columns** (`country` / `region` / `department`).
2. Runtime attribution reduces to **a single `ST_Contains`** → one row → we read the columns. Parent↔child consistency is **guaranteed by construction** (everything is on the same row).
3. **No logic specific to a region of the world.** Per-country behavior is driven by a **data manifest**, not by code.

## 3. Single hierarchical source

The multi-source patchwork is the root cause of v1's problems. We switch to **geoBoundaries**, a homogeneous worldwide source covering every level. Two packagings, your choice:

| Packaging | License | For |
| --- | --- | --- |
| **CGAZ** (harmonized global composite) | **just 1: CC-BY 4.0** | Max simplicity: one citation for the whole world |
| **gbOpen** (per country, official national source) | per country, **all open** (Etalab, OGL, Public Domain, CC-BY…), auto-collectable via the API | Official precision + download only the manifest's country+level |

**Coverage (validated via the gbOpen API)**: ADM0 = **230 countries**, ADM1 = **198**, ADM2 = **180**. Every point falls at least in a country; most have a region and a department. The ~50 without ADM2 are micro-states with no real 2nd level (Monaco, Singapore…) → manifest at ADM1/ADM0.

| Others | Decision |
| --- | --- |
| To avoid | **GADM** — more detailed but **non-commercial** license → not redistributable |
| Cities | **GeoNames `cities5000`** (unchanged from v1) — points, "nearest city", *not* containment |
| Oceans | **Natural Earth** marine polys (public domain) for the §6 fallback |

> **FR validation (geoBoundaries gbOpen — done)**: ADM1 = 13 regions, ADM2 = 96 departments, source **IGN** (official), Etalab license. Coastlines **healthy** when un-simplified (Marseille, Ajaccio, Brest, Nice all contained — Ajaccio broke with the "simplified" france-geojson). dept⊂region consistency **perfect** (PIP: 0 orphans, cf. §5.3).

A homogeneous source **tiles cleanly** (a country's ADM2s union into its ADM1) → most inter-file reconciliations and patches disappear.

**Recommendation**: start in **CGAZ** (1 license); switch a country to gbOpen (national source) case by case via the manifest, without touching the runtime. Watch out for **ShareAlike** (e.g. JPN in CC-BY-SA): if we commit its derived boundaries, mark them CC-BY-SA — or leave those countries as outline only.

## 4. Data model

### 4.1 Leaf layer `geo_zones`

```sql
CREATE TABLE geo_zones (
  zone_id      VARCHAR,   -- stable identifier of the leaf-zone
  level        VARCHAR,   -- actual level of the leaf: 'department' | 'region' | 'country'
  country_code VARCHAR,   -- ISO 3166-1 alpha-3
  country      VARCHAR,   -- embedded hierarchy
  region       VARCHAR,   -- NULL if the country has no such level loaded
  department   VARCHAR,   -- NULL if the country has no such level loaded
  geom         GEOMETRY
);
```

Example (**variable** depth depending on the data loaded per country):

| geom | level | country | region | department |
| --- | --- | --- | --- | --- |
| ▢ | department | France | Île-de-France | Paris |
| ▢ | department | France | Bretagne | Finistère |
| ▢ | region | Spain | Catalonia | NULL |
| ▢ | country | Brazil | NULL | NULL |

Each leaf tiles its territory; the union of the leaves covers the world (at least at the country level — cf. §6 fallback).

### 4.2 Cities `geo_cities` (unchanged)

GeoNames points (`name, country_code, admin1, population, lat, lon, geom = ST_Point`). The "city" stays a **nearest-point** attribution (cities don't tile the plane) — it's the only level that *cannot* live in the leaf layer.

### 4.3 Country manifest (the scalability lever)

A declarative config file drives the **depth loaded per country**:

```jsonc
{
  "default": "ADM0",        // any unlisted country → country outline only
  "FRA": "ADM2",
  "USA": "ADM2",
  "ESP": "ADM1"
}
```

> **Adding a country = one line in the manifest + a build re-run.** Zero runtime change, zero per-region logic.

### 4.4 Fine sources outside the ADM hierarchy (e.g. arrondissements)

Some useful levels aren't geoBoundaries ADMs — the **municipal arrondissements** (Paris/Lyon/Marseille) are sub-communal (geoBoundaries FR stops at ADM2 = department). We add them as **finer leaves clipped to their parent**, via a dedicated source (data.gouv, ~45 polygons):

- **Paris**: the 20 arrondissements = exactly department 75 → they **replace** the "Paris department" leaf.
- **Lyon / Marseille**: the arrondissements only cover the city (⊂ department) → insert the arrondissements **+** replace the department leaf with "department **minus** the city" (`ST_Difference` at build time).

The arrondissement leaf then carries `country/region/department` + its `arrondissement` level. The runtime stays **a single `ST_Contains`** — much cleaner and more precise than the v1 impl's "nearest GeoNames point" hack (exact containment, no fuzziness or false positive). Driven by the manifest (territory override), so scalable.

## 5. Build pipeline (`scripts/build-geo-assets.mjs`, rewritten)

Offline, one-off, re-run when we touch the manifest or the sources:

1. **Download** geoBoundaries CGAZ ADM0/ADM1/ADM2 (+ Natural Earth oceans, + GeoNames `cities5000`).
2. **Assemble the leaf layer** per the manifest:
   - for each curated country → its polygons at the requested level (ADM2/ADM1);
   - for all other countries → their ADM0 polygon.
   - The union doesn't overlap: a curated country is removed from the ADM0 layer (replaced by its fine leaves).
3. **Embed the hierarchy in columns via point-in-polygon (PIP) at build time.** gbOpen features do **not** carry the parent name (attributes = `shapeName/shapeGroup/shapeType` only — *validated*). So we derive ancestry at build: for each leaf, a guaranteed interior point (`ST_PointOnSurface`) → which parent polygon (ADM1, ADM0) contains it. **Code-agnostic** (INSEE/FIPS/…), so never country-specific. *FR-validated: 96 departments → **0 orphans**, each in exactly one region.* (If we ever take a source that already embeds the hierarchy: a simple copy.)
4. **Simplify** (mapshaper, Visvalingam, `keep-shapes`) with **a single global tolerance**, arbitrated against the memory goal (§8). No per-region tuning: one worldwide slider *"don't simplify to the point of ejecting a populated city from its zone"*.
5. **Oceans**: named marine polygons (Natural Earth) in a separate `ocean` layer, for the §6 fallback.
6. **Cities**: extract `cities5000` → flat JSON (unchanged from v1).

Output: one leaf-layer asset (TopoJSON), one oceans asset, one cities asset — instead of v1's 5 heterogeneous files.

## 6. Runtime attribution (`attributeZones` / `attributionSql.ts`, simplified)

Unchanged: we **deduplicate positions first** (round ~11 m → 10³–10⁴ distinct positions instead of 10⁵–10⁶ raw points), attribute the distinct positions, then join back onto the segments.

Attributing a distinct position reduces to:

```sql
-- 1) A single containment test on the leaf layer → reads the hierarchy.
SELECT z.country, z.region, z.department
FROM geo_zones z
WHERE ST_Contains(z.geom, pt)
LIMIT 1;

-- 2) Fallback if no land leaf (sea / coarse outline):
--    prefer land; otherwise nearest country within a small margin; otherwise ocean.
--    (universal fallback scale, not a per-region buffer)

-- 3) Nearest city: unchanged (GeoNames, distance, radius guardrail, country pre-filter).
```

What **disappears** compared to v1:
- the separate region / department tests (and thus the dept↔region inconsistency);
- the per-country pre-filter on each level;
- the per-local-quirk patches.

## 7. Perf & memory (goal: scale to several countries)

This is the only truly inherent cost (you need the polygons to attribute). Mitigations, all compatible with the architecture:

- **A single `ST_Contains` per position** (instead of 4–5) → faster runtime.
- **RTREE index** on `geo_zones.geom` (and `geo_cities.geom`) → `ST_Contains` / `ST_DWithin` sub-linear even with many leaves (US counties ≈ 3,200, etc.). ✅ **Validated**: the DuckDB-WASM RTREE works and is **indispensable** — without an index, spatial joins on ~4,500 polygons blow up to **OOM (3 GB)**; with it, 100k distinct positions pass. ⚠️ Prerequisite: the queries must be **spatial JOINs**; correlated subqueries do **not** use the index and OOM'd (fixed in the v1 impl).
- **Position deduplication** (already in place) → the number of tests is bounded by distinct positions, independent of the raw volume.
- **Memory**: the leaf layer only loads ADM2 for curated countries (the rest = ADM0, ~250 features). We can **drop `adm1.topojson`** (the region is now a column, no longer a polygon to test). Net memory ≈ neutral or even better than v1.

## 8. Simplification: a single global slider

Precision is set by **one worldwide simplification tolerance**, arbitrated against memory/bandwidth. Universal constraint: preserve the containment of **populated places** (a city must not fall outside its zone after simplification). No per-region exception in code.

## 9. Sources & licenses (product requirement)

CC-BY requires attribution including: **source name**, **link**, **license name + link**, and **an indication that the data is modified** (we simplify). Satisfied by a **dedicated "Data & licenses" section** in the UI (FAQ / About) — no need to show it on every screen.

In **gbOpen**, each country has its national license (all open); the API returns `boundaryLicense` + `boundarySource` per country → the build **auto-generates** the credits for the loaded countries (zero manual entry). In **CGAZ**, a single CC-BY 4.0 line covers everything. Case to watch: **ShareAlike** (e.g. JPN CC-BY-SA) requires redistributing the derived boundaries under the same license → mark those assets, or exclude those countries from the fine levels.

```
Data & licenses
• Administrative boundaries © geoBoundaries (CC-BY 4.0) — modified (simplified).
  Runfola, D. et al. (2020), geoBoundaries, PLoS ONE 15(4): e0231866.
• City data © GeoNames (CC-BY 4.0) — modified.
• Map tiles © OpenStreetMap contributors / OpenFreeMap.   ← shown ON the map
```

> Exception: the **tiles** (OpenFreeMap/OSM) require attribution **visible on the map** — carried natively by MapLibre's attribution control, distinct from the zone data. Good practice: replicate the mentions in the header of `build-geo-assets.mjs` + a `NOTICE` next to the committed assets.

## 10. Migration from v1

| File | Action |
| --- | --- |
| `scripts/build-geo-assets.mjs` | **Rewritten**: geoBoundaries source + manifest → leaf layer with embedded hierarchy |
| `static/geo/*` | Replaced: 1 leaf-zones asset + oceans + cities (instead of adm0/adm1/adm1-world/adm2-fr) |
| `lib/data/geo/loadGeoAssets.ts` | Loads `geo_zones` with the hierarchy columns; **drops** `adm1.topojson` |
| `lib/data/geo/attributionSql.ts` | **Collapsed**: 1 `ST_Contains` + ocean fallback; removal of the region/department subqueries/guardrails |
| `lib/data/geo/attributeZones.ts` | Orchestration unchanged (dedup → attribute → enrich) |
| `lib/data/queries/geoQueries.ts` | **Unchanged**: identical output columns (`country`/`region`/`department`/`nearest_city`) |

The consumption interface doesn't move → the Guide sections / Explore views (separate batch) are unaffected.

## 11. Invariants (reminder, unchanged from v1)

1. **No network egress of user data**: coordinates never transmitted; only the static `/geo/*` assets (public reference data) + the DuckDB spatial extension (code) go out.
2. **No persistence** of user data.
3. Boundaries & cities = **public reference data**, not user data.

## 12. Open decisions & risks

1. ~~**DuckDB-WASM RTREE**~~ **Resolved**: validated functional and indispensable (cf. §7). Condition: attribution written as **spatial JOINs** (no correlated subqueries, which don't use the index → OOM).
2. **geoBoundaries vs fine national source**: geoBoundaries as the universal base; possibility to override a country with a more precise national source via the manifest (without changing the runtime).
3. **Default depth**: world ADM0 loaded for all → any point outside a curated country still gets at least the country. Confirm this fallback behavior.
4. **Initial list of curated countries** (ADM2): France first, then? (driven by the manifest).
5. **"Place" level (placeId)**: out of scope, identical to v1 §7.
