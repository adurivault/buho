# Buho — Instructions projet

Buho est une webapp de visualisation de données personnelles (exports Spotify, et à terme Google Maps / WhatsApp), **100% client-side** : aucune donnée utilisateur ne quitte le navigateur. C'est la promesse centrale du produit — toute contribution doit la respecter.

## Stack

- **SvelteKit 2 + Svelte 5 (runes)**, adapter-static (site statique, pas de SSR de données)
- **DuckDB-WASM** : les exports sont chargés dans une table `spotify_plays` en mémoire, toutes les agrégations se font en SQL dans le navigateur
- **Observable Plot + D3** pour les graphes, Canvas 2D pour la constellation
- **Tailwind 4**, thème sombre
- **Vitest + Testing Library** pour les tests (colocalisés en `*.test.ts`)

## Layout du repo

| Chemin | Rôle |
| --- | --- |
| `buho-app/` | L'application SvelteKit (tout le code actif) |
| `docs/` | Documentation générée du projet |

## Architecture de l'app (`buho-app/src`)

Flux de données : upload ZIP → `lib/stores/dataStore.svelte.ts` (JSZip → `lib/data/parseSpotify.ts` → insertion DuckDB) → couche requêtes → composants.

- `lib/data/db.ts` : init DuckDB-WASM, `query<T>(sql, params)` qui renvoie des lignes en camelCase
- `lib/data/queries/` : toutes les requêtes SQL, organisées par thème (artist, track, temporal, behavior, discovery, dimension). `common.ts` porte les helpers de filtres de dates
- `lib/visualizations/plots/` : factories Observable Plot pures (données → élément SVG), même découpage thématique
- `lib/components/sections/` : sections du mode Guide (une visu narrative chacune)
- `lib/components/visualizations/` : composants lourds de l'Explorer (ConstellationChart en Canvas, BarChartSatellite)
- `lib/stores/` : stores Svelte 5 en `.svelte.ts` — `dataStore` (source chargée), `spotifyFilterStore` (plage de dates du Guide), `spotifyExplorerFilters` (filtres multi-dimensions de l'Explorer)

Chaque source de données a deux routes : `/spotify/guide` (narration scrollable ; sections enregistrées dans `routes/spotify/guide/sections.ts`) et `/spotify/explore` (vues coordonnées avec cross-filtering).

## Invariants à respecter

1. **Aucun envoi réseau de données utilisateur.** Tout le traitement reste dans le navigateur.
2. **Pas de persistance** : pas de localStorage, sessionStorage, IndexedDB ni cookies pour les données. C'est vérifié par un test (`lib/stores/stores.test.ts`). Si une persistance opt-in est ajoutée un jour, c'est une décision produit explicite, pas un choix technique.
3. **SQL** : noms de tables/colonnes validés par `validateIdentifier` dans `db.ts` ; privilégier les prepared statements pour les valeurs.
4. Les nombres affichés utilisent `toLocaleString()` sans locale (locale du navigateur). Les tests doivent donc être indépendants de la locale.

## Commandes

```bash
cd buho-app
npm run dev      # serveur de dev Vite
npm test         # suite Vitest complète
npm run check    # svelte-check (types)
npm run build    # build statique
```

## Conventions

- Ne jamais créditer une IA dans les messages de commit (pas de Co-Authored-By, pas de "Generated with…")
- UI en anglais, discussions et docs internes souvent en français
