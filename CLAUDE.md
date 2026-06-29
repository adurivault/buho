# Buho — Project instructions

Buho is a web app for visualizing personal data (Spotify exports, and eventually Google Maps / WhatsApp), **100% client-side**: no user data ever leaves the browser. This is the product's central promise — every contribution must respect it.

## Stack

- **SvelteKit 2 + Svelte 5 (runes)**, adapter-static (static site, no data SSR)
- **DuckDB-WASM**: exports are loaded into an in-memory `spotify_plays` table, all aggregations happen in SQL in the browser
- **Observable Plot + D3** for charts, Canvas 2D for the constellation
- **Tailwind 4**, dark theme
- **Vitest + Testing Library** for tests (colocated as `*.test.ts`)

## Repo layout

| Path | Role |
| --- | --- |
| `buho-app/` | The SvelteKit application (all active code) |
| `docs/` | Generated project documentation |

## App architecture (`buho-app/src`)

Data flow: ZIP upload → `lib/stores/dataStore.svelte.ts` (JSZip → `lib/data/parseSpotify.ts` → DuckDB insertion) → query layer → components.

- `lib/data/db.ts`: DuckDB-WASM init, `query<T>(sql, params)` returning rows in camelCase
- `lib/data/queries/`: all SQL queries, organized by theme (artist, track, temporal, behavior, discovery, dimension). `common.ts` holds the date-filter helpers
- `lib/visualizations/plots/`: pure Observable Plot factories (data → SVG element), same thematic split
- `lib/components/sections/`: Guide-mode sections (one narrative viz each)
- `lib/components/visualizations/`: the Explorer's heavy components (ConstellationChart on Canvas, BarChartSatellite)
- `lib/stores/`: Svelte 5 stores as `.svelte.ts` — `dataStore` (loaded source), `spotifyFilterStore` (Guide date range), `spotifyExplorerFilters` (the Explorer's multi-dimension filters)

Each data source has two routes: `/spotify/guide` (scrollable narration; sections registered in `routes/spotify/guide/sections.ts`) and `/spotify/explore` (coordinated views with cross-filtering).

## Invariants to respect

1. **No network egress of user data.** All processing stays in the browser.
2. **No persistence**: no localStorage, sessionStorage, IndexedDB, or cookies for data. This is checked by a test (`lib/stores/stores.test.ts`). If opt-in persistence is ever added, it's an explicit product decision, not a technical choice.
3. **SQL**: table/column names validated by `validateIdentifier` in `db.ts`; prefer prepared statements for values.
4. Displayed numbers use `toLocaleString()` with no locale (browser locale). Tests must therefore be locale-independent.

## Commands

```bash
cd buho-app
npm run dev      # Vite dev server
npm test         # full Vitest suite
npm run check    # svelte-check (types)
npm run build    # static build
```

## Conventions

- **English everywhere.** All code, comments, identifiers, docs, commit messages, and UI strings must be in English. Spoken/written discussion with the maintainer may be in French, but nothing committed to the repo should be.
- Never credit an AI in commit messages (no Co-Authored-By, no "Generated with…")
