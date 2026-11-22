# Buho — Project instructions

Buho is a web app for visualizing personal data exports (music streaming, location history, messages, Google activity, watch data), **100% client-side**: no user data ever leaves the browser. This is the product's central promise — every contribution must respect it.

## Stack

All the code lives in `buho-app/`.

- **SvelteKit 2 + Svelte 5 (runes)**, adapter-static (static site, no data SSR)
- **DuckDB-WASM**: exports are loaded into in-memory tables (one per module), all aggregations happen in SQL in the browser
- **D3** for charts, Canvas 2D / WebGL for the dense ones
- **Tailwind 4**
- **Vitest + Testing Library**, tests colocated as `*.test.ts` (`*.headless.test.ts` run against real DuckDB)

## Vocabulary: sources and modules

Two concepts, never mixed:

- **Source** — an export Buho can read (`spotify`, `deezer`, `lastfm`, `google-timeline`, `google-activity`, `garmin`, `strava`, `messenger`, `instagram`, `whatsapp`…). Named after the service.
- **Module** — a dataset with its own table, route and sidebar entry (`listening`, `positions`, `messages`, `activity`, `steps`, `health`). Named after the data. One source can feed several modules (Garmin fills `steps`, `health` and `positions`) and one module can be fed by several sources.

Anything module-level — routes, stores, query files, tables, CSS tokens — is named after the module, never the company: `/positions`, `positionsQueries.ts`, `listeningFilterStore`, `--accent-listening`.

## Architecture (`buho-app/src/lib`)

Data flow: drop → `data/import/entries.ts` (files/ZIPs → entries) → `data/sources/registry.ts` (each file goes to the source parser that claims it) → `data/import/runImport.ts` (stores the rows) → queries → components. `stores/dataStore.svelte.ts` drives it and owns the app state around it.

- `data/modules.ts`: `DATA_MODULES`, the app's spine — the sidebar and the /sources page render from it
- `data/sources/`: one folder per source. Adding a source = one folder + one line in `registry.ts` + its entries in `catalog.ts` (what it contributes) and `storage.ts` (where its rows land). Text-based sources ship a small **invented** export in `<source>/fixtures/` — never a real one, and no real names, places or IPs in tests either
- `data/formats/`: decoders shared by sources (FIT, XLSX, gunzip)
- `data/db/`: the DuckDB layer — `client.ts` (connection, `query<T>()`), `staging.ts` (the one append-with-dedupe path), one file per table
- `data/queries/`: all SQL, per module, plus `calendarQueries` across modules
- `data/geo/`: zone attribution and the derived `position_days` table
- `visualizations/d3/`: chart factories; `chart.ts` is the shared chart style
- `components/`: guide sections, the Explorers' heavy visualizations, shared UI
- `calendar/`: what the cross-module calendar derives from `calendarQueries`. A record belongs to the calendar day of its stored wall-clock time (the `date` column every table has), the same day as on the module pages
- `explorer/`: the Explorers' cross-filter and search; `data/sql/search.ts` restates the search rules for DuckDB, held to them by a test
- `export/`: charts to PNG / MP4 / GIF, encoded in the tab
- `stores/`: Svelte 5 stores (`.svelte.ts`)

Each module has `/<module>/explore` (coordinated views with cross-filtering) and, for some, `/<module>/guide` (scrollable narration).

## Invariants

1. **No network egress of user data.** All processing stays in the browser.
2. **No persistence** of user data: no localStorage, sessionStorage, IndexedDB or cookies (enforced by ESLint and `stores/stores.test.ts`). Adding any would be a product decision, not a technical one. The service worker only caches the app's own files, for offline use.
3. **SQL**: identifiers go through `validateIdentifier` (`db/client.ts`); values through prepared statements.
4. Displayed numbers use `toLocaleString()` with no locale, so tests must be locale-independent.
5. **Charts paint in tokens**, never colour literals: the `--chart-*` roles, a module's `--fill-*` (areas, bars) / `--peak-*` (dots, lines) / `--accent-*` (text, UI), and the categorical palette (`utils/dimensionColors.ts`). An element with `data-module="<id>"` sets `--module-accent`, `--module-soft`, `--module-fill` and `--module-peak` for its subtree; canvas reads them through `themeColors.ts`.

## Commands

```bash
cd buho-app
npm run dev      # Vite dev server
npm test         # full Vitest suite (test:unit / test:headless for one side)
npm run check    # svelte-check (types)
npm run lint     # ESLint
npm run format   # Prettier (CI runs format:check)
npm run build    # static build
```

## Conventions

- **English everywhere**: code, comments, identifiers, docs, commit messages, UI strings.
