# PRD v2 — Attribution géographique : architecture « zones-feuilles »

> Statut : proposition · Source : exports Google Timeline (table `google_maps_segments`)
> **Relation à la v1** ([prd-google-maps-geo.md](./prd-google-maps-geo.md)) : ce document **remplace** la *logique d'attribution* (v1 §6 schéma, §7 logique) et la *production des assets*. Tout le reste de la v1 — invariants réseau, fond de carte MapLibre, rendu deck.gl, découpage Guide/Explore — **reste valable et inchangé**. La v1 est conservée comme référence de l'approche initiale (patchwork multi-sources).

## 1. Pourquoi cette révision

La v1 attribue chaque point en **recalculant la hiérarchie niveau par niveau au runtime** : un test pays, puis région, puis département, chacun sur des polygones issus de **sources différentes** (Natural Earth 50m pour les pays, NE 10m pour les régions monde, france-geojson pour la France, etc.). Conséquences observées :

- **Frontières non recollées** : des fichiers simplifiés séparément ne coïncident pas → trous (point dans un pays mais aucune région) et incohérences **département ⊄ région** près des limites.
- **Rustines** : buffer côtier, garde-fous spécifiques, dépendance à des particularités locales (ex. côte corse sur-simplifiée éjectant une ville de son département). Non scalable.
- **Pas de hiérarchie matérialisée** : la relation parent→enfant n'existe nulle part comme donnée ; elle est ré-assemblée par `GROUP BY` au query-time en *supposant* la cohérence entre colonnes.
- **Coût runtime** : 4–5 opérations spatiales par position distincte.

Objectif produit identique à la v1 (attribuer chaque point à pays / région / département / ville), mais avec une architecture **universelle, scalable à de nouveaux pays, et plus rapide**.

## 2. Principe directeur

> **Tout le travail complexe est fait au build. Au runtime, on attribue un point à une zone, et la zone porte déjà sa hiérarchie.**

1. Le build produit **une seule couche de « zones-feuilles »** : chaque polygone est l'unité administrative **la plus fine disponible** pour son territoire, et **porte sa hiérarchie complète en colonnes** (`country` / `region` / `department`).
2. L'attribution runtime se réduit à **un seul `ST_Contains`** → une ligne → on lit les colonnes. La cohérence parent↔enfant est **garantie par construction** (tout est sur la même ligne).
3. **Aucune logique spécifique à une région du monde.** Le comportement par pays est piloté par un **manifeste de données**, pas par du code.

## 3. Source unique hiérarchique

Le patchwork multi-sources est la cause racine des problèmes de v1. On bascule sur **geoBoundaries**, source mondiale homogène couvrant tous les niveaux. Deux conditionnements, au choix :

| Conditionnement | Licence | Pour |
| --- | --- | --- |
| **CGAZ** (composite mondial harmonisé) | **1 seule : CC-BY 4.0** | Simplicité max : une citation pour le monde entier |
| **gbOpen** (par pays, source nationale officielle) | par pays, **toutes ouvertes** (Etalab, OGL, Public Domain, CC-BY…), auto-collectables via l'API | Précision officielle + ne télécharger que le pays+niveau du manifeste |

**Couverture (validée via l'API gbOpen)** : ADM0 = **230 pays**, ADM1 = **198**, ADM2 = **180**. Tout point tombe au moins dans un pays ; la plupart ont région et département. Les ~50 sans ADM2 sont des micro-États sans 2ᵉ niveau réel (Monaco, Singapour…) → manifeste à ADM1/ADM0.

| Autres | Décision |
| --- | --- |
| À éviter | **GADM** — plus détaillé mais licence **non-commerciale** → pas redistribuable |
| Villes | **GeoNames `cities5000`** (inchangé v1) — points, « ville la plus proche », *pas* du containment |
| Océans | **Natural Earth** marine polys (domaine public) pour le fallback §6 |

> **Validation FR (geoBoundaries gbOpen — fait)** : ADM1 = 13 régions, ADM2 = 96 départements, source **IGN** (officiel), licence Etalab. Côtes **saines** en non-simplifié (Marseille, Ajaccio, Brest, Nice tous contenus — Ajaccio cassait avec france-geojson « simplifiée »). Cohérence dept⊂région **parfaite** (PIP : 0 orphelin, cf. §5.3).

Une source homogène **pave proprement** (les ADM2 d'un pays s'unissent en son ADM1) → l'essentiel des réconciliations inter-fichiers et des rustines disparaît.

**Reco** : démarrer en **CGAZ** (1 licence) ; basculer un pays vers gbOpen (source nationale) au cas par cas via le manifeste, sans toucher au runtime. Attention au **ShareAlike** (ex. JPN en CC-BY-SA) : si on commit ses frontières dérivées, les marquer CC-BY-SA — ou laisser ces pays en contour seul.

## 4. Modèle de données

### 4.1 Couche-feuilles `geo_zones`

```sql
CREATE TABLE geo_zones (
  zone_id      VARCHAR,   -- identifiant stable de la zone-feuille
  level        VARCHAR,   -- niveau réel de la feuille : 'department' | 'region' | 'country'
  country_code VARCHAR,   -- ISO 3166-1 alpha-3
  country      VARCHAR,   -- hiérarchie embarquée
  region       VARCHAR,   -- NULL si le pays n'a pas ce niveau chargé
  department   VARCHAR,   -- NULL si le pays n'a pas ce niveau chargé
  geom         GEOMETRY
);
```

Exemple (profondeur **variable** selon les données chargées par pays) :

| geom | level | country | region | department |
| --- | --- | --- | --- | --- |
| ▢ | department | France | Île-de-France | Paris |
| ▢ | department | France | Bretagne | Finistère |
| ▢ | region | Espagne | Catalogne | NULL |
| ▢ | country | Brésil | NULL | NULL |

Chaque feuille tuile son territoire ; l'union des feuilles couvre le monde (au moins au niveau pays — cf. §6 fallback).

### 4.2 Villes `geo_cities` (inchangé)

Points GeoNames (`name, country_code, admin1, population, lat, lon, geom = ST_Point`). La « ville » reste une attribution **par plus proche point** (les villes ne pavent pas le plan) — c'est le seul niveau qui *ne* peut *pas* vivre dans la couche-feuilles.

### 4.3 Manifeste de pays (le levier de scalabilité)

Un fichier de config déclaratif pilote la **profondeur chargée par pays** :

```jsonc
{
  "default": "ADM0",        // tout pays non listé → contour pays seul
  "FRA": "ADM2",
  "USA": "ADM2",
  "ESP": "ADM1"
}
```

> **Ajouter un pays = une ligne dans le manifeste + re-run du build.** Zéro changement runtime, zéro logique par région.

### 4.4 Sources fines hors hiérarchie ADM (ex. arrondissements)

Certains niveaux utiles ne sont pas des ADM geoBoundaries — les **arrondissements municipaux** (Paris/Lyon/Marseille) sont sous-communaux (geoBoundaries FR s'arrête à ADM2 = département). On les ajoute comme **feuilles plus fines clippées sur leur parent**, via une source dédiée (data.gouv, ~45 polygones) :

- **Paris** : les 20 arrondissements = exactement le département 75 → ils **remplacent** la feuille « département Paris ».
- **Lyon / Marseille** : les arrondissements ne couvrent que la ville (⊂ département) → insérer les arrondissements **+** remplacer la feuille département par « département **moins** la ville » (`ST_Difference` au build).

La feuille-arrondissement porte alors `country/region/department` + son niveau `arrondissement`. Le runtime reste **un seul `ST_Contains`** — bien plus propre et précis que le hack « plus proche point GeoNames » de l'impl v1 (containment exact, pas de flou ni faux positif). Piloté par le manifeste (override de territoire), donc scalable.

## 5. Pipeline de build (`scripts/build-geo-assets.mjs`, réécrit)

Offline, one-off, ré-exécuté quand on touche au manifeste ou aux sources :

1. **Télécharger** geoBoundaries CGAZ ADM0/ADM1/ADM2 (+ océans Natural Earth, + GeoNames `cities5000`).
2. **Assembler la couche-feuilles** selon le manifeste :
   - pour chaque pays curaté → ses polygones au niveau demandé (ADM2/ADM1) ;
   - pour tous les autres pays → leur polygone ADM0.
   - L'union ne se chevauche pas : un pays curaté est retiré de la couche ADM0 (remplacé par ses feuilles fines).
3. **Embarquer la hiérarchie en colonnes par point-dans-polygone (PIP) au build.** Les features gbOpen ne portent **pas** le nom du parent (attributs = `shapeName/shapeGroup/shapeType` seulement — *validé*). On dérive donc l'ancestralité au build : pour chaque feuille, un point intérieur garanti (`ST_PointOnSurface`) → quel polygone parent (ADM1, ADM0) le contient. **Agnostique aux codes** (INSEE/FIPS/…), donc jamais spécifique à un pays. *Validé FR : 96 départements → **0 orphelin**, chacun dans exactement une région.* (Si on prend un jour une source qui embarque déjà la hiérarchie : simple recopie.)
4. **Simplifier** (mapshaper, Visvalingam, `keep-shapes`) avec **une seule tolérance globale**, arbitrée contre l'objectif mémoire (§8). Pas de réglage par région : un curseur mondial *« ne pas simplifier au point d'éjecter une ville peuplée de sa zone »*.
5. **Océans** : polygones marins nommés (Natural Earth) en couche séparée `ocean`, pour le fallback §6.
6. **Villes** : extraire `cities5000` → JSON plat (inchangé v1).

Sortie : un asset couche-feuilles (TopoJSON), un asset océans, un asset villes — au lieu des 5 fichiers hétérogènes de v1.

## 6. Attribution runtime (`attributeZones` / `attributionSql.ts`, simplifié)

Inchangé : on **déduplique d'abord les positions** (arrondi ~11 m → 10³–10⁴ positions distinctes au lieu de 10⁵–10⁶ points bruts), on attribue les positions distinctes, on rejoint sur les segments.

L'attribution d'une position distincte se réduit à :

```sql
-- 1) Un seul test de containment sur la couche-feuilles → lit la hiérarchie.
SELECT z.country, z.region, z.department
FROM geo_zones z
WHERE ST_Contains(z.geom, pt)
LIMIT 1;

-- 2) Fallback si aucune feuille terrestre (mer / contour grossier) :
--    priorité à la terre ; sinon plus proche pays dans une petite marge ; sinon océan.
--    (échelle de fallback universelle, pas un buffer par région)

-- 3) Ville la plus proche : inchangé (GeoNames, distance, garde-fou rayon, pré-filtre pays).
```

Ce qui **disparaît** par rapport à v1 :
- les tests séparés région / département (et donc l'incohérence dept↔région) ;
- le pré-filtre par pays sur chaque niveau ;
- les rustines par particularité locale.

## 7. Perf & mémoire (objectif : scaler à plusieurs pays)

C'est le seul coût réellement inhérent (il faut les polygones pour attribuer). Mitigations, toutes compatibles avec l'architecture :

- **Un seul `ST_Contains` par position** (au lieu de 4–5) → runtime plus rapide.
- **Index RTREE** sur `geo_zones.geom` (et `geo_cities.geom`) → `ST_Contains` / `ST_DWithin` sous-linéaire même avec beaucoup de feuilles (US counties ≈ 3 200, etc.). ✅ **Validé** : l'RTREE DuckDB-WASM fonctionne et est **indispensable** — sans index, les jointures spatiales sur ~4500 polygones partent en **OOM (3 Go)** ; avec, 100k positions distinctes passent. ⚠️ Prérequis : les requêtes doivent être des **JOINs spatiaux** ; les sous-requêtes corrélées n'utilisent **pas** l'index et OOMaient (corrigé en impl v1).
- **Déduplication des positions** (déjà en place) → nombre de tests borné par les positions distinctes, indépendant du volume brut.
- **Mémoire** : la couche-feuilles ne charge l'ADM2 que pour les pays curatés (le reste = ADM0, ~250 features). On peut **supprimer `adm1.topojson`** (la région est désormais une colonne, plus un polygone à tester). Net mémoire ≈ neutre voire meilleur que v1.

## 8. Simplification : un seul curseur global

La précision se règle par **une tolérance de simplification mondiale**, arbitrée contre la mémoire/bande passante. Contrainte universelle : préserver le containment des **lieux peuplés** (une ville ne doit pas tomber hors de sa zone après simplification). Aucune exception codée par région.

## 9. Sources & licences (exigence produit)

CC-BY impose une attribution comportant : **nom de la source**, **lien**, **nom + lien de la licence**, et **indication que les données sont modifiées** (on simplifie). Satisfait par une **section dédiée « Data & licenses »** dans l'UI (FAQ / About) — pas besoin de l'afficher sur chaque écran.

En **gbOpen**, chaque pays a sa licence nationale (toutes ouvertes) ; l'API renvoie `boundaryLicense` + `boundarySource` par pays → le build **auto-génère** les crédits des pays chargés (zéro saisie manuelle). En **CGAZ**, une seule ligne CC-BY 4.0 couvre le tout. Cas à surveiller : **ShareAlike** (ex. JPN CC-BY-SA) impose de redistribuer les frontières dérivées sous la même licence → marquer ces assets, ou exclure ces pays des niveaux fins.

```
Data & licenses
• Administrative boundaries © geoBoundaries (CC-BY 4.0) — modified (simplified).
  Runfola, D. et al. (2020), geoBoundaries, PLoS ONE 15(4): e0231866.
• City data © GeoNames (CC-BY 4.0) — modified.
• Map tiles © OpenStreetMap contributors / OpenFreeMap.   ← affiché SUR la carte
```

> Exception : les **tuiles** (OpenFreeMap/OSM) imposent une attribution **visible sur la carte** ; portée nativement par le contrôle d'attribution MapLibre, distincte des données de zones. Bonne pratique : répliquer les mentions dans l'en-tête de `build-geo-assets.mjs` + un `NOTICE` à côté des assets commités.

## 10. Migration depuis v1

| Fichier | Action |
| --- | --- |
| `scripts/build-geo-assets.mjs` | **Réécrit** : source geoBoundaries + manifeste → couche-feuilles à hiérarchie embarquée |
| `static/geo/*` | Remplacés : 1 asset zones-feuilles + océans + villes (au lieu de adm0/adm1/adm1-world/adm2-fr) |
| `lib/data/geo/loadGeoAssets.ts` | Charge `geo_zones` avec les colonnes hiérarchie ; **drop** `adm1.topojson` |
| `lib/data/geo/attributionSql.ts` | **Collapse** : 1 `ST_Contains` + fallback océan ; suppression des sous-requêtes région/département/garde-fous |
| `lib/data/geo/attributeZones.ts` | Orchestration inchangée (dedup → attribuer → enrichir) |
| `lib/data/queries/geoQueries.ts` | **Inchangé** : colonnes de sortie identiques (`country`/`region`/`department`/`nearest_city`) |

L'interface de consommation ne bouge pas → les sections Guide / vues Explore (lot séparé) ne sont pas impactées.

## 11. Invariants (rappel, inchangés v1)

1. **Aucun envoi réseau de données utilisateur** : coordonnées jamais transmises ; seuls partent les assets `/geo/*` statiques (données de référence publiques) + l'extension spatiale DuckDB (du code).
2. **Pas de persistance** des données utilisateur.
3. Frontières & villes = **données de référence publiques**, pas des données utilisateur.

## 12. Décisions ouvertes & risques

1. ~~**RTREE DuckDB-WASM**~~ **Résolu** : validé fonctionnel et indispensable (cf. §7). Condition : attribution écrite en **JOINs spatiaux** (pas de sous-requêtes corrélées, qui n'utilisent pas l'index → OOM).
2. **geoBoundaries vs source nationale fine** : geoBoundaries comme socle universel ; possibilité de surcharger un pays par une source nationale plus précise via le manifeste (sans changer le runtime).
3. **Profondeur par défaut** : ADM0 mondial chargé pour tous → tout point hors pays curaté reçoit au moins le pays. Confirmer ce comportement de fallback.
4. **Liste initiale des pays curatés** (ADM2) : France d'abord, puis ? (piloté par le manifeste).
5. **Niveau « lieu » (placeId)** : hors périmètre, identique à v1 §7.
