# PRD — Visualisation géographique Google Maps

> Statut : proposition · Source : exports Google Timeline (déjà parsés dans `google_maps_segments`)
> Périmètre : carte interactive + attribution de chaque point à des zones géographiques multi-échelles.

## 1. Contexte & objectif

Buho visualise des données personnelles **100% côté navigateur** : aucune donnée utilisateur ne sort. Les exports Google Timeline sont déjà chargés dans la table DuckDB `google_maps_segments` (voir `lib/data/parseGoogleMaps.ts`). Les routes `/google-maps/guide` (narration) et `/google-maps/explore` (vues coordonnées) existent mais sont vides côté visualisation.

Objectif de cet incrément :

1. **Afficher** les points GPS sur un fond de carte élégant, zoomable, interactif, gratuit.
2. **Attribuer** chaque point à des zones géographiques à plusieurs échelles : pays → région → département → ville → lieu (place).

## 2. Promesse produit & invariants (non négociables)

- **Aucun envoi réseau de données utilisateur.** Les coordonnées GPS ne quittent jamais le navigateur. → Toute API de reverse-geocoding en ligne (Nominatim, Google, Mapbox) est **exclue**. L'attribution des zones se fait **en local**.
- **Pas de persistance** des données utilisateur (ni localStorage, IndexedDB, etc.).
- Distinction clé : les **frontières administratives** et les **villes** sont des **données de référence publiques**, pas des données utilisateur. Les servir en statique (CDN/hébergement) ne touche pas l'invariant — c'est comme servir le bundle JS.
- Nuances réseau acceptées, à documenter (voir §9) : les tuiles du fond de carte révèlent le *viewport* (pas les données) au fournisseur de tuiles ; l'extension spatiale DuckDB est téléchargée au runtime (du *code*, pas des données).

## 3. Décisions techniques arrêtées

| Sujet | Décision | Vérifié |
| --- | --- | --- |
| Calcul des zones | **DuckDB spatial** (`ST_Contains` pour les polygones, `ST_Distance` pour la ville la plus proche), 100% en SQL dans le navigateur | ✅ `LOAD spatial` OK sur DuckDB-WASM **v1.4.3** (bundle du projet) ; `ST_Contains` et `ST_GeomFromGeoJSON` validés |
| Fond de carte | **MapLibre GL JS** + tuiles **OpenFreeMap** (gratuit, sans clé, sans quota), style sombre | — |
| Rendu des points | **deck.gl** en overlay (un export Timeline = 10⁵–10⁶ points) | — |
| Niveau admin le plus fin | **Département / comté (ADM2)** ; la commune (polygones) est hors périmètre v1 | — |
| Niveau « ville » | **Ville la plus proche** via points GeoNames `cities5000` (pas de polygones communes) | — |

## 4. Sources de données

Tout est **eager** (chargé une fois, pas de lazy-loading) : on reste sous ADM2, donc les volumes tiennent.

| Couche | Source | Échelle | ~# features | Poids (trimé + gzip) | Licence |
| --- | --- | --- | --- | --- | --- |
| Pays (ADM0) | Natural Earth | monde | ~250 | ~50–120 Ko | Domaine public |
| Région (ADM1) | Natural Earth | monde | ~3 600 | ~0,5–2 Mo | Domaine public |
| Département / comté (ADM2) | geoBoundaries (ou sources nationales : `france-geojson`, US Census) | pays curatés (FR d'abord, puis UK/US/DE/ES/IT) | variable | quelques Mo | CC-BY (créditer) / domaine public |
| Ville | GeoNames `cities5000` | monde | ~52 000 | ~1,5–2 Mo | CC-BY (créditer) |

Notes :
- Les frontières sont transportées en **TopoJSON** (~80% plus léger que GeoJSON), ré-exploé côté client avec `topojson-client`, puis donné à `ST_GeomFromGeoJSON`. Le cas lourd (futures communes) passerait en **GeoParquet**.
- **Simplification agressive assumée** (mapshaper / Visvalingam) : pour du point-in-polygon, une erreur de quelques centaines de mètres au bord d'une zone est sans conséquence sur des analytics perso.
- GeoNames porte `name, lat, lon, country, admin1, population` → la ville la plus proche fournit *gratuitement* région + population (pour la narration).

## 5. Flux de données

```
export ZIP → parseGoogleMaps → google_maps_segments (lat/lon, déjà en place)
                                        │
        (assets statiques)              │  init / au chargement de la source
  geo_zones (ADM0/1/2)  ─────────┐      ▼
  geo_cities (cities5000) ───────┴─►  spatial joins (DuckDB)
                                        │
                                        ▼
                              segment_geo : pour chaque point →
                              country / region / department / nearest_city / place_id
                                        │
                         ┌──────────────┴───────────────┐
                         ▼                               ▼
                /google-maps/guide              /google-maps/explore
              (sections narratives)        (carte MapLibre + cross-filtering)
```

## 6. Schéma DuckDB

```sql
-- Polygones administratifs (chargés depuis les assets au runtime)
CREATE TABLE geo_zones (
  level        VARCHAR,   -- 'country' | 'region' | 'department'
  country_code VARCHAR,   -- ISO 3166-1 alpha-3
  zone_id      VARCHAR,   -- identifiant stable de la zone
  name         VARCHAR,
  geom         GEOMETRY
);

-- Points villes (GeoNames cities5000)
CREATE TABLE geo_cities (
  name         VARCHAR,
  country_code VARCHAR,
  admin1       VARCHAR,
  population   INTEGER,
  lat          DOUBLE,
  lon          DOUBLE,
  geom         GEOMETRY   -- ST_Point(lon, lat)
);

-- Résultat enrichi, calculé une fois après le chargement de la source
CREATE TABLE segment_geo (
  segment_id   BIGINT,    -- rowid stable de google_maps_segments
  country      VARCHAR,
  region       VARCHAR,
  department   VARCHAR,   -- NULL hors pays curatés
  nearest_city VARCHAR,   -- NULL au-delà du rayon max
  city_km      DOUBLE,
  place_id     VARCHAR    -- repris de l'export (stationary uniquement)
);
```

## 7. Logique d'attribution

### Zones administratives (pays / région / département)
Spatial join `ST_Contains(zone.geom, ST_Point(lon, lat))` par niveau. Valable pour **tous** les points, y compris en trajet.

### Ville la plus proche
1. Pré-filtrer les villes candidates **au pays du point** (déjà connu via le join ADM0) → de 52k villes à quelques dizaines/centaines.
2. `ST_Distance` (ou `ST_Distance_Sphere` pour annoncer « à 12 km de Lyon »), garder le min.
3. **Garde-fou** : si la ville la plus proche est au-delà d'un **rayon max** (proposition : 30 km), `nearest_city = NULL` (zone rurale) — sinon un point en pleine campagne se rattache trompeusement à une ville lointaine.

### Lieux (places)
L'export ne porte que `placeId` (opaque) + `semanticType` (Home/Work…) sur les segments `stationary`. **La résolution `placeId → nom/adresse` passe par la Places API → réseau → interdit.** Donc, côté client, un « lieu » se limite à :
- les libellés sémantiques de l'export (Home/Work) ;
- le `placeId` comme **clé de regroupement opaque** (« tu es allé 47× à ce lieu », sans nom) ;
- le niveau ville (ci-dessus) comme substitut au lieu nommé.

**Option (phase ultérieure) — backfill du `placeId`** sur les points sans place, par voisinage **temporel + spatial** : si un point est encadré par deux visits du **même** lieu → on propage ce lieu (trou dans un séjour) ; sinon on ne « snappe » que les extrémités proches d'une visit ; sinon `NULL` (en trajet). Implémentable en window functions (`LAST_VALUE(... IGNORE NULLS)`). À ne faire que si la valeur produit est avérée.

## 8. Fond de carte & rendu

- **MapLibre GL JS** + style sombre, source **OpenFreeMap** (zéro config, zéro clé).
- **deck.gl** `ScatterplotLayer` en overlay pour les points bruts ; agrégations (heatmap/hexbin) pour les vues d'ensemble.
- L'`/explore` reste cohérent avec le pattern Spotify : cross-filtering entre la carte et les autres vues (filtres dans un store dédié, type `googleMapsExplorerFilters`).
- **Évolution privacy (optionnelle)** : remplacer OpenFreeMap par **Protomaps `.pmtiles`** auto-hébergé en statique → même le viewport ne fuite plus. Changement de config, pas d'architecture.

## 9. Découpage en lots

**Phase 1 — MVP carte + zonage grossier**
- Fond MapLibre + OpenFreeMap, points en deck.gl.
- `geo_zones` ADM0/ADM1 (Natural Earth, monde, eager) + `geo_cities` (GeoNames cities5000).
- `segment_geo` : country + region + nearest_city.
- Premières sections Guide + carte Explore.

**Phase 2 — départements + lieux**
- ADM2 pour pays curatés (FR, puis UK/US/DE/ES/IT).
- Agrégation par `placeId` (fréquentation) + libellés Home/Work.

**Phase 3 — optionnel / si valeur avérée**
- Backfill `placeId` sur les points de trajet/séjour.
- Polygones communes (lazy-par-pays, GeoParquet) pour la vraie précision FR.
- Tuiles Protomaps auto-hébergées + extension spatiale auto-hébergée (offline complet).

## 10. Risques & points à vérifier

- **Perf du spatial join à grande échelle** : N points × polygones. OK à l'échelle pays/région/département. **Index RTREE DuckDB à valider** uniquement si on passe aux communes (phase 3) — non testé à ce jour.
- **Extension spatiale = fetch CDN au runtime** (~quelques Mo depuis `extensions.duckdb.org`). N'enfreint pas l'invariant (code, pas données) mais suppose d'être en ligne au premier chargement. Mitigation : auto-héberger le `.duckdb_extension.wasm` (phase 3).
- **Tuiles = viewport visible par le fournisseur.** Acceptable, à documenter ; Protomaps le supprime (phase 3).
- **Volume mémoire navigateur** : `cities5000` (~52k points) + ADM1 monde + ADM2 pays curatés, à charger en plus des tables existantes. À surveiller, attendu raisonnable (< quelques Mo en mémoire géométrique).
- **Attribution licences** : créditer geoBoundaries et GeoNames (CC-BY) dans l'app.

## 11. Décisions produit ouvertes

1. **Niveau admin le plus fin v1 = département (ADM2)** — confirmé ? (la commune reste hors périmètre).
2. **Liste des pays curatés** pour l'ADM2 au-delà de la France.
3. **Rayon max** de rattachement « ville la plus proche » (proposition : 30 km).
4. Faut-il **Home/Work** dès la phase 2, ou se contenter du regroupement opaque par `placeId` ?
