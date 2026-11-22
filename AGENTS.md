# Buho — Project instructions

Buho is a web app for visualizing personal data exports (music streaming, location history, messages, Google activity, watch data), **100% client-side**: no user data ever leaves the browser. This is the product's central promise — every contribution must respect it.

## Stack

- **SvelteKit 2 + Svelte 5 (runes)**, adapter-static (static site, no data SSR)
- **DuckDB-WASM**: exports are loaded into in-memory tables (one per module: `plays`, `location_segments`, `messages`, …), all aggregations happen in SQL in the browser
- **D3** for charts, Canvas 2D / WebGL for the dense ones (constellation, maps, races)
- **Tailwind 4**, dark theme
- **Vitest + Testing Library** for tests (colocated as `*.test.ts`)

## Repo layout

All the code lives in `buho-app/`, the SvelteKit application.

## Vocabulary: sources and modules

Two concepts, never mixed:

- **Source** — an export Buho can read (`spotify`, `deezer`, `lastfm`, `google-timeline`, `google-activity`, `garmin`, `strava`, `messenger`, `instagram`, `whatsapp`…). Sources are named after the service.
- **Module** — a dataset with its own table, route and sidebar entry (`listening`, `positions`, `messages`, `activity`, `steps`, `health`). Modules are named after the data. One source can feed several modules (a Garmin export fills `steps`, `health` and `positions`) and one module can be fed by several sources (`plays` takes Spotify, Deezer and Last.fm).

Anything module-level — routes, stores, query files, tables, CSS accents — is named after the module, never the company: `positionsQueries.ts`, `listeningFilterStore`, `step_packets`, `--accent-listening`. `dataStore.loaded` / `isSample` / `clearDemo` are keyed by `ModuleId`; which _sources_ are loaded is `dataStore.inventory`.

## App architecture (`buho-app/src`)

Data flow: drop → `lib/data/import/entries.ts` (files/ZIPs → entries) → `lib/data/sources/registry.ts` (`readDrop` sniffs each file and hands it to the source parser that claims it) → `lib/data/import/runImport.ts` (stores the rows via `db.insert*`, reports what landed where) → query layer → components. `lib/stores/dataStore.svelte.ts` drives it and owns the app state around it (progress, sample flags, what is loaded, geo enrichment, analytics).

- `lib/data/modules.ts`: the list of modules (`DATA_MODULES`) — the app's spine; the sidebar and the /sources matrix render from it, and `section` is always `/${id}`
- `lib/data/sources/`: one folder per source (`parser.ts` registered in `registry.ts`, plus `parse.ts`, `types.ts` and helpers as needed). `catalog.ts` says what each source contributes, `storage.ts` where its rows land (both checked against each other by `catalog.test.ts`). Adding a source = one folder + one line in `registry.ts` + its catalog/storage entries. Text-based sources ship a small invented export in `<source>/fixtures/` (loaded with `fixtures.testutil.ts`, kept valid by `fixtures.test.ts`) — never a real one
- `lib/data/formats/`: generic decoders shared by sources (FIT, XLSX, gunzip)
- `lib/data/import/`: drop handling shared by every source (entries, the `runImport` pipeline, message row building, import errors)
- `lib/data/db/`: the DuckDB layer, imported as `#lib/data/db/index.ts`. `client.ts` owns the connection and generic helpers (`query<T>(sql, params)` returning rows in camelCase); `staging.ts` is the one append-with-dedupe path every import takes; one file per table (`plays`, `positions`, `steps`, `health`, `messages`, `activity`) holds its schema, natural key and insert
- `lib/data/queries/`: all SQL queries — per module (`positionsQueries`, `stepsQueries`, `healthQueries`, `messageQueries`, `activityQueries`), for listening per theme (artist, track, temporal, behavior, discovery), and across modules for the calendar (`calendarQueries`). `common.ts` holds the date-filter helpers
- `lib/data/geo/`: zone attribution and the derived `position_days` table
- `lib/visualizations/d3/`: the chart factories (data → DOM element: legend, SVG, tooltip), by module (`listeningCharts`, `messageCharts`, `metricScatter`, `ridgeline`…). `chart.ts` is the one chart style they share — the `--chart-*` colour roles, axes and gridlines, legends, the tooltip, mark specs, the sequential ramp from a module's tint to its peak.
- `lib/components/sections/`: Guide-mode sections (one narrative viz each)
- `lib/components/visualizations/`: the Explorers' heavy components (ConstellationChart on Canvas, DimensionPie, SunburstExplorer, LocationMap) and, under `guide/`, the guides' animated ones
- `lib/calendar/`: what the cross-module calendar derives from `calendarQueries` — each day's height on its module's lane scale, which the lanes and their projections, the week calendar, the parallel coordinates and the RadViz all draw (`scales.ts`), where each lane and column sits, with the week calendar laid on the lanes' days (`lanes.ts`), the one order the calendar lists modules in (`CALENDAR_ORDER`, `figures.ts`), the module each day stood out in (`days.ts`), the year picker's glyphs (`years.ts`), heart-rate zones cut at the health explorer's own bands, and each day's heartbeats with the hours off the wrist filled at the usual rate for that hour, which health is ranked on (`zones.ts`, with `visualizations/healthRamp.ts`), the year laid round a clock, each day a spoke from midnight to midnight, from each module's quarter-hours (`clock.ts`), the selected day's tracks (`timeline.ts`). Every record sits on the calendar day, midnight to midnight, of its stored wall-clock time — the `date` column every table has — so a day there is the same day as on the module pages
- `lib/explorer/`: what the Explorers share — the cross-filter over their in-memory points (`crossfilter.ts`) and the search box (`search.ts`: folding, matching, marking the points). The listening Explorer also narrows in SQL, so `lib/data/sql/search.ts` restates the same rules for DuckDB, and a headless test holds the two to each other
- `lib/export/`: turning a chart into a file — PNG stills, MP4 clips (WebCodecs, with `MediaRecorder` behind it), GIFs. Everything is encoded in the tab, so the share button never becomes an upload
- `lib/stores/`: Svelte 5 stores as `.svelte.ts` — `dataStore` (what is loaded, imports, removal), `listeningFilterStore` (Listening guide date range), `<module>ExplorerFilters` (each Explorer's multi-dimension filters, all instances of `ExplorerFiltersStore`)

Each module has `/<module>/explore` (coordinated views with cross-filtering) and, for some, `/<module>/guide` (scrollable narration). **A route is named after the data, never the company the export came from**: `/listening`, `/positions`, `/messages`, `/activity`, `/steps`, `/health`.

## Invariants to respect

1. **No network egress of user data.** All processing stays in the browser.
2. **No persistence**: no localStorage, sessionStorage, IndexedDB, or cookies for data. This is enforced by ESLint (`no-restricted-globals` in `eslint.config.js`) and checked by a test (`lib/stores/stores.test.ts`). If opt-in persistence is ever added, it's an explicit product decision, not a technical choice. The one thing kept between visits is the app's own files: `src/service-worker/index.ts` caches pages, code and the DuckDB engine (what it fetches is `lib/offline.ts`) so Buho works offline. It never sees user data, since a dropped file is not a request. A new deploy reaches a visitor once all their Buho tabs are closed.
3. **SQL**: table/column names validated by `validateIdentifier` in `db/client.ts`; prefer prepared statements for values.
4. Displayed numbers use `toLocaleString()` with no locale (browser locale). Tests must therefore be locale-independent.
5. **Charts paint in tokens.** Colours come from the `--chart-*` roles, the module marks and the categorical palette (`utils/dimensionColors.ts`), never a literal: SVG takes the CSS variables, canvas and WebGL read them through `themeColors.ts`. A module's marks take `--fill-*` (areas, runs of bars) or `--peak-*` (dots, lines, ticks, the strong end of a ramp); `--accent-*` is for text and UI. Components and pages read them through the module scope: an element with `data-module="<id>"` (each module's layout shell, a row in a list of modules, a chart about one module) sets `--module-accent`, `--module-soft`, `--module-fill` and `--module-peak` for its subtree, neutral outside any module; canvas code reads `fillColor(id)` / `peakColor(id)`. Tests keep hex literals out of `lib/visualizations/d3/` and module names out of the colours in `lib/components/` and `routes/` (`moduleScope.test.ts`).

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

- **English everywhere.** All code, comments, identifiers, docs, commit messages, and UI strings must be in English. Spoken/written discussion with the maintainer may be in French, but nothing committed to the repo should be.
- Never credit an AI in commit messages (no Co-Authored-By, no "Generated with…")
