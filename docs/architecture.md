# Buho — Architecture Document

**Generated:** 2026-01-31 | **Scan Level:** Deep

## Architecture Overview

Buho follows a **static site + client-side processing** architecture. There is no backend server or database. The application is built as a set of reactive markdown pages using Observable Framework, with all data processing happening in the browser.

```
┌────────────────────────────────────────────────────┐
│                   Browser (Client)                  │
│                                                     │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────┐│
│  │  index.md    │  │ google-maps  │  │ spotify   ││
│  │  (Home Page) │  │ .md          │  │ .md       ││
│  └──────────────┘  └──────┬───────┘  └─────┬─────┘│
│                           │                 │      │
│  ┌────────────────────────┴─────────────────┘      │
│  │           Data Processing Layer                  │
│  │  ┌──────────────┐ ┌──────────────┐              │
│  │  │parseLocations│ │parseSpotify  │              │
│  │  │parseConvers. │ │locationAggr. │              │
│  │  └──────────────┘ └──────────────┘              │
│  │                                                  │
│  │           Visualization Layer                    │
│  │  ┌──────────────┐ ┌──────────────┐              │
│  │  │ components/  │ │visualizations│              │
│  │  │ (D3, Leaflet)│ │ (Plot specs) │              │
│  │  └──────────────┘ └──────────────┘              │
│  │                                                  │
│  │  ┌──────────────┐ ┌──────────────┐              │
│  │  │ GeoJSON      │ │ Demo Data    │              │
│  │  │ boundaries   │ │ (bundled)    │              │
│  │  └──────────────┘ └──────────────┘              │
│  └──────────────────────────────────────────────────│
└────────────────────────────────────────────────────┘
         │ (static build output)
         ▼
┌────────────────────┐  ┌────────────────────┐
│ Observable Cloud   │  │ GitHub Pages       │
│ (primary hosting)  │  │ (backup hosting)   │
└────────────────────┘  └────────────────────┘
```

## Data Flow

### Google Location History Pipeline

```
User uploads JSON file
        │
        ▼
parseTimeline(jsonData)
  → Sorts entries by startTime
  → Converts visit/activity/timelinePath to Segment[]
  → Fills missing distances between timelinePath points
        │
        ▼
enhanceTimeline(segments, countries, depts, arrondissements)
  → Point-in-polygon for each segment location
  → Adds country, departement, arrondissement fields
        │
        ▼
Aggregation functions:
  → getDurationByRegion() → Map<region, seconds>
  → getDailyStats() → DailyStats[]
  → prepareBarChartRaceData() → BarChartKeyframe[]
  → clusterHomeLocations() → HomeCluster[]
  → extractDailyJourneys() → DailyJourney[]
        │
        ▼
Visualization components render charts, maps, calendars
```

### WhatsApp Pipeline

```
User uploads .txt file → parseChat() → Message[] → parseConversation() → charts
```

### Spotify Pipeline

```
User uploads JSON files → parseSpotifyData() → SpotifyPlay[] → charts
```

## Component Architecture

### Layer 1: Pages (Markdown)
Observable Framework pages (`.md` files) serve as both the UI layout and the reactive data pipeline. Each page:
- Defines file input widgets (`Inputs.file()`)
- Loads demo data via `FileAttachment()`
- Calls parsers and aggregation functions
- Renders visualizations by calling component/plot functions

### Layer 2: Data Parsers (`data/`)
Pure functions that transform raw data formats into typed structures. Key types:
- `Segment` — Unified location timeline entry (stationary or moving)
- `SpotifyPlay` — Single Spotify play event
- `Message` — WhatsApp message

### Layer 3: Aggregation (`data/locationAggregations.ts`)
Functions that compute derived datasets from parsed data:
- Region aggregation (country/dept/arrondissement)
- Daily home base detection (3am position)
- Travel radius calculation
- Calendar data preparation

### Layer 4: Visualization Components (`components/`, `visualizations/`)
Two categories:
1. **Custom D3 components** (`components/`): Imperative, stateful — bar chart race, interactive map, daily journey radar, small multiples
2. **Plot specifications** (`visualizations/`): Declarative — return Observable Plot configurations

### Layer 5: Configuration (`config/`)
Shared configuration like color scales to ensure visual consistency across charts.

### Layer 6: Utilities (`utils/`)
Pure utility functions (duration formatting, conversion helpers).

## State Management

Observable Framework uses **reactive cells** rather than a traditional state management pattern:

- Each code block in a `.md` page is a reactive cell
- When a cell's dependencies change (e.g., file upload, date slider), it re-executes
- No Redux, Context API, or similar — the framework handles reactivity natively
- `view()` wraps interactive inputs to create reactive values

**Key reactive patterns used:**
- File upload → triggers data re-parsing → cascades to all dependent visualizations
- Date range slider → filters timeline → updates all charts
- Demo/user data toggle via `Inputs.file({ required: false })`

## Geographic Enrichment

Three levels of geographic attribution via point-in-polygon:

| Level | GeoJSON File | Property | Scope |
|---|---|---|---|
| Country | `countries.geojson` | `name` | Worldwide |
| Department | `departements.geojson` | `nom` | France only |
| Arrondissement | `arrondissements.geojson` | `l_ar` | Paris only |

Attribution rule: segment location → check if point falls within each polygon → assign most specific match.

## Build & Deployment

### Build Process
```bash
cd buho-app && npm run build
# → Observable Framework compiles .md pages to static HTML/JS
# → Output: buho-app/dist/
```

### Deployment

| Target | Method | URL |
|---|---|---|
| Observable Cloud | `npm run deploy` (manual) | https://adurivault.observablehq.cloud/buho/ |
| GitHub Pages | GitHub Actions on push to main | https://adurivault.github.io/buho/ |

### CI/CD Pipeline

GitHub Actions workflow (`.github/workflows/deploy.yml`):
1. Checkout code
2. Setup Node 20 with npm cache
3. `npm ci` in `buho-app/`
4. `npm run build` in `buho-app/`
5. Upload `buho-app/dist/` as Pages artifact
6. Deploy to GitHub Pages

## Testing Strategy

- **Framework:** Jest with ts-jest and ESM support
- **Command:** `npm test` (uses `--experimental-vm-modules` flag)
- **Test location:** `buho-app/src/test-data/` for fixtures
- **Coverage:** Unit tests for data parsers

## Configuration

### Observable Framework (`observablehq.config.js`)

| Setting | Value |
|---|---|
| Title | Buho |
| Base path | /buho/ |
| Dev port | 3001 |
| Theme | cotton, wide |
| Source root | src |
| Pager | Disabled |
| Analytics | Umami |

### TypeScript (`tsconfig.json`)

| Setting | Value |
|---|---|
| Target | ESNext |
| Module | ESNext |
| Strict | false |
| noImplicitAny | false |
| Module resolution | node |
