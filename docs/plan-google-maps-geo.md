# Plan d'implémentation — Attribution géographique des points

> Périmètre : **uniquement** rattacher chaque point GPS à ses zones (pays / région / département / ville). Le fond de carte, les tuiles et le rendu sont **hors scope** ici (voir PRD §8).
> Référence : [prd-google-maps-geo.md](./prd-google-maps-geo.md). Décisions arrêtées : DuckDB spatial (vérifié v1.4.3), tout eager, plus fin = ADM2, ville = plus proche via GeoNames `cities5000`.

## Principe directeur (perf)

On **ne** lance **pas** le point-in-polygon sur les 10⁵–10⁶ points bruts. On déduplique d'abord les positions (arrondi à ~110 m), on attribue les **positions distinctes** (typiquement 10³–10⁴), puis on rejoint sur les segments. Ça rend les joins tractables **sans dépendre de l'index RTREE** (non vérifié à ce jour), et ça reste valable jusqu'à l'échelle département.

## Dépendances

- **Runtime** : `topojson-client` (ré-explosion TopoJSON → GeoJSON, minuscule).
- **Build/dev** : `mapshaper` (simplification + conversion ; en `devDependencies` ou via `npx`).
- Aucune dépendance carte ici (deck.gl / MapLibre = autre lot).

## Carte des fichiers

| Fichier | Nature | Rôle |
| --- | --- | --- |
| `buho-app/scripts/build-geo-assets.mjs` | nouveau (offline) | Télécharge, simplifie, normalise → `static/geo/` |
| `buho-app/static/geo/adm0.topojson` | asset généré | Pays (Natural Earth, monde) |
| `buho-app/static/geo/adm1.topojson` | asset généré | Régions/états (Natural Earth, monde) |
| `buho-app/static/geo/adm2-fr.topojson` | asset généré | Départements FR (geoBoundaries / france-geojson) |
| `buho-app/static/geo/cities5000.json` | asset généré | Villes GeoNames (name, lat, lon, country, admin1, pop) |
| `buho-app/src/lib/data/geo/loadGeoAssets.ts` | nouveau | Charge `geo_zones` + `geo_cities` dans DuckDB |
| `buho-app/src/lib/data/geo/attributeZones.ts` | nouveau | Déduplique, attribue, enrichit `google_maps_segments` |
| `buho-app/src/lib/data/db.ts` | modifié | `loadSpatial()` (INSTALL/LOAD spatial, lazy) |
| `buho-app/src/lib/stores/dataStore.svelte.ts` | modifié | Hook après `insertLocationSegments` |
| `buho-app/src/lib/data/queries/geo.ts` | nouveau | Requêtes de consommation (top pays, villes, etc.) |
| `buho-app/src/lib/data/geo/attributeZones.integration.manual.ts` | nouveau | Test bout-en-bout (voir §Tests) |

---

## Étape 0 — Préparer les assets (offline, one-off)

`scripts/build-geo-assets.mjs` (lancé à la main, ré-exécuté quand on ajoute un pays) :

1. **Télécharger** : Natural Earth ADM0 + ADM1 ; geoBoundaries/france-geojson ADM2 FR ; GeoNames `cities5000.zip`.
2. **Simplifier** (mapshaper, Visvalingam, agressif — précision ~quelques centaines de m OK) :
   ```bash
   mapshaper ne_10m_admin_0_countries.shp \
     -simplify visvalingam 8% keep-shapes -clean \
     -o format=topojson static/geo/adm0.topojson
   ```
3. **Normaliser les propriétés** dès le build pour que le runtime soit source-agnostique → chaque feature porte `{ country_code (ISO3), zone_id, name }`. (Natural Earth : `ADM0_A3`/`ADMIN` ; ADM1 : `adm0_a3`/`name` ; geoBoundaries : `shapeISO`/`shapeName`.)
4. **Villes** : extraire de `cities5000.txt` (TSV) les colonnes utiles → `cities5000.json` `[{name, lat, lon, country_code(ISO3), admin1, population}]`.

> Les téléchargements bruts ne sont **pas** commités (volumineux) ; seuls les fichiers `static/geo/*` simplifiés le sont. Documenter sources + licences (geoBoundaries & GeoNames = CC-BY → créditer dans l'app).

**Checkpoint** : tailles `static/geo/*` conformes au PRD §4 (adm0 ~100 Ko, adm1 ~1-2 Mo, cities ~1,5-2 Mo).

---

## Étape 1 — Charger l'extension spatiale (lazy)

Dans `db.ts`, fonction dédiée appelée **seulement** sur le chemin Google Maps (les users Spotify ne paient pas le fetch CDN) :

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

**Checkpoint** : `SELECT ST_Contains(ST_GeomFromText('POLYGON((2 48,3 48,3 49,2 49,2 48))'), ST_Point(2.35,48.85))` → `true` (déjà validé hors app).

---

## Étape 2 — Charger les tables de référence (`geo_zones`, `geo_cities`)

`loadGeoAssets.ts` — idempotent (données de référence, indépendantes de l'user ; charger une fois par session) :

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

Insertion : réutiliser le pattern `registerFileText` + `read_json_auto` d'`insertData`, vers une table de staging `(…, geom_text VARCHAR)`, puis :
```sql
INSERT INTO geo_zones SELECT level, country_code, zone_id, name, ST_GeomFromGeoJSON(geom_text) FROM _staging;
```
`geo_cities` : même topo, géométrie `ST_Point(lon, lat)`.

**Checkpoint** : `SELECT level, count(*) FROM geo_zones GROUP BY 1` cohérent (~250 / ~3600 / ~101) ; `SELECT count(*) FROM geo_cities` ≈ 52k.

---

## Étape 3 — Attribuer (`attributeZones.ts`)

Rejoué à **chaque upload** (dépend des données user). Trois sous-étapes en SQL.

**3a. Positions distinctes** (la clé perf) :
```sql
CREATE OR REPLACE TABLE segment_locations AS
SELECT DISTINCT round(lat,3) AS lat_k, round(lon,3) AS lon_k
FROM google_maps_segments WHERE lat IS NOT NULL AND lon IS NOT NULL;
```

**3b. Attribution des positions distinctes** (pays d'abord, puis région/département pré-filtrés par pays ; ville pré-filtrée par pays + garde-fou rayon) :
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
) city ON city.km <= 30;   -- rayon max → sinon nearest_city = NULL
```

**3c. Enrichir les segments** (ALTER + UPDATE…FROM, join sur les positions arrondies) :
```sql
ALTER TABLE google_maps_segments ADD COLUMN country VARCHAR;      -- + region, department, nearest_city, city_km
UPDATE google_maps_segments s
SET country=lz.country, region=lz.region, department=lz.department,
    nearest_city=lz.nearest_city, city_km=lz.city_km
FROM location_zones lz
WHERE round(s.lat,3)=lz.lat_k AND round(s.lon,3)=lz.lon_k;
```
`place_id` est déjà une colonne des segments → rien à faire pour les lieux à ce stade (cf. PRD §7, backfill = phase ultérieure).

**Checkpoint** : `SELECT count(*) total, count(country) attribués, count(nearest_city) avec_ville FROM google_maps_segments` → taux d'attribution pays ≈ 100%, ville raisonnable. Inspecter quelques lignes connues (un point à Paris → France / Île-de-France / Paris / Paris).

---

## Étape 4 — Brancher dans le flux

`dataStore.svelte.ts`, après `insertLocationSegments(...)`, sur le chemin Google Maps uniquement :
```ts
await loadSpatial();
await loadGeoAssets();     // idempotent
await attributeZones();
```
Exposer un état (`geoAttributionReady`) pour que les sections sachent que les colonnes sont prêtes.

## Étape 5 — Couche requêtes (`queries/geo.ts`)

Requêtes camelCase via `query<T>()`, par ex. :
- `topCountries()` — durée/visites par `country`.
- `topCities()` — par `nearest_city` (+ `population`, `city_km`).
- `regionBreakdown(country)` — répartition régions/départements d'un pays.
- `timeAbroad()` — part du temps hors pays de résidence.

Ces requêtes alimenteront les sections `/google-maps/guide` et les vues `/google-maps/explore` (lot séparé).

## Tests & vérification

- **SQL spatial en headless** : contrairement au pipeline worker (skip en JSDOM), le bundle **`duckdb-node-blocking.cjs`** charge `spatial` en Node (démontré pendant la vérif). On peut donc écrire un **vrai test automatisé** de l'attribution sur un mini-jeu de positions (Paris, Londres, New York, un point en mer) + un mini-`geo_zones`/`geo_cities` synthétique. À cadrer dans `attributeZones.integration.manual.ts` (ou un harness Node dédié).
- **Unitaires purs** : mapping des propriétés au build, expression d'arrondi, logique de garde-fou rayon.
- **Invariant réseau** : `npm test` (le test existant `stores.test.ts` garde l'absence de persistance) ; vérifier qu'aucun appel ne part avec des coordonnées (seuls partent : assets `/geo/*` statiques + extension `extensions.duckdb.org`).
- `npm run check` (types).

## Séquencement conseillé

1. Étape 0 (assets FR + monde) → 2. loadSpatial → 3. loadGeoAssets → 4. attributeZones (pays seul d'abord, checkpoint) → 5. ajouter région → département → ville → 6. brancher dataStore → 7. queries/geo.ts.

Chaque cran a un checkpoint SQL vérifiable avant d'ajouter le niveau suivant.

## Décisions (tranchées) & implémentation

1. Plus fin v1 = **département** (commune = phase 3 ultérieure).
2. ADM2 = **France uniquement**.
3. Rayon max ville = **30 km** (`NEAREST_CITY_MAX_KM`).
4. Dédup des positions = **4 décimales (~11 m)** (`DEDUP_DECIMALS`). L'arrondi n'est qu'une clé de join : `google_maps_segments.lat/lon` restent intacts pour le placement précis sur carte.

État : **implémenté et testé** (`npm test` → headless DuckDB spatial via le bundle `duckdb-node-blocking` ; `npm run check` clean). Assets générés dans `static/geo/` (adm0 236 Ko, adm1 99 Ko, adm2-fr 205 Ko, cities5000 6,4 Mo / 64k villes).

Deux pièges révélés par la validation sur données réelles (encodés dans le code) :

- **Côtes :** les fichiers `…-version-simplifiee.geojson` de france-geojson sur-simplifient les côtes (un point à Ajaccio tombait hors de Corse-du-Sud). On part du fichier **complet** et on simplifie nous-mêmes à 20% (préserve Ajaccio/Nice/Brest/Biarritz). Idem ADM0 monde à 25% (sinon Marseille hors de France).
- **Arrondissements :** GeoNames liste les arrondissements/quartiers (Paris 04, Marseille 02, Sol) comme des points codés `PPL` (comme de vraies villes), à population élevée → ils gagnent le « plus proche ». Fix : parmi les villes d'un même cluster (`d_min + CITY_CLUSTER_KM = 5 km`), on prend la **plus peuplée** (collapse les sous-divisions vers Paris/Madrid/Marseille, garde les voisines distinctes comme Versailles).

Reste hors périmètre (non bloquant) : `cities5000.json` pèse 6,4 Mo non compressé (≈1,5–2 Mo gzip au transport) — à optimiser plus tard (arrondir les coords, ou Parquet) si le poids commité gêne.
