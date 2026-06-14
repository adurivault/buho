# Buho — Source Tree Analysis

**Generated:** 2026-01-31 | **Scan Level:** Deep

## Project Root

```
buho/
├── buho-app/                    # Main Observable Framework application
│   ├── src/                     # Source root (configured in observablehq.config.js)
│   │   ├── components/          # Reusable visualization components
│   │   ├── config/              # Application configuration
│   │   ├── data/                # Data parsers, demo data, GeoJSON files
│   │   ├── utils/               # Utility functions
│   │   ├── visualizations/      # Complex visualization builders
│   │   ├── static/              # Static assets (icons, images)
│   │   ├── test-data/           # Test fixtures
│   │   ├── index.md             # Home page (entry point)
│   │   ├── google-maps.md       # Google Location History page
│   │   ├── whatsapp-chat.md     # WhatsApp Chat Analysis page
│   │   └── spotify.md           # Spotify Listening History page
│   ├── package.json             # NPM dependencies and scripts
│   ├── tsconfig.json            # TypeScript configuration
│   ├── jest.config.js           # Jest test configuration
│   ├── observablehq.config.js   # Observable Framework config
│   └── README.md                # Framework-specific README
├── data/                        # User data files (git-ignored)
├── notebooks/                   # Jupyter notebooks
├── .github/workflows/           # CI/CD
│   └── deploy.yml               # GitHub Pages deployment
├── docs/                        # Generated documentation (this folder)
├── CLAUDE.md                    # Development session notes
├── README.md                    # Project README
└── pyproject.toml               # Python utilities config
```

## Critical Directories

### `buho-app/src/components/` — Visualization Components

Reusable, self-contained visualization components that accept data and return DOM elements.

| File | Description | Dependencies |
|---|---|---|
| `barChartRace.ts` | Animated bar chart race with play/stop controls | D3, formatDuration |
| `calendar.ts` | Calendar layout transform for Observable Plot | D3-time, Plot |
| `dailyJourneyRadar.ts` | Animated radar chart showing daily movement patterns | D3, parseLocations types |
| `dailyJourneySmallMultiples.ts` | Grid of small radar charts (one per day) | D3, parseLocations types |
| `interactiveMap.ts` | Leaflet map with canvas renderer for large datasets | Leaflet, parseLocations types |

### `buho-app/src/data/` — Data Layer

Contains parsers, aggregation functions, demo data, and GeoJSON boundary files.

| File | Description |
|---|---|
| `parseLocations.ts` | **Core parser** — Google Takeout → `Segment[]` unified timeline. Also contains `enhanceTimeline`, clustering, journey extraction. |
| `parseConversation.ts` | WhatsApp chat text → `Message[]` |
| `parseSpotify.ts` | Spotify JSON → `SpotifyPlay[]` |
| `locationAggregations.ts` | Region aggregation, home base calculation, calendar data preparation |
| `demo-location-history.json` | Demo Google Takeout data (bundled) |
| `demo-whatsapp-chat.txt` | Demo WhatsApp export (bundled) |
| `demo-spotify.json` | Demo Spotify data (bundled) |
| `countries.geojson` | World country boundaries |
| `departements.geojson` | French department boundaries |
| `arrondissements.geojson` | Paris arrondissement boundaries |

### `buho-app/src/visualizations/` — Plot Factories

Functions that create Observable Plot specifications from processed data.

| File | Functions |
|---|---|
| `locationPlots.ts` | 13 plot functions: segment scatter plots, choropleth maps (country/dept/arrondissement), calendar views (location/distance/travel radius), distance charts, radial home distance plots |

### `buho-app/src/config/` — Configuration

| File | Description |
|---|---|
| `colorScales.ts` | Stable ordinal color scales for departments, countries, arrondissements |

### `buho-app/src/utils/` — Utilities

| File | Description |
|---|---|
| `formatDuration.ts` | Duration formatting in French and English (short/full), hours↔seconds conversion |

## Entry Points

| Entry Point | Type | Description |
|---|---|---|
| `src/index.md` | Page | Home page with data source cards |
| `src/google-maps.md` | Page | Google Takeout location visualization |
| `src/whatsapp-chat.md` | Page | WhatsApp chat analysis |
| `src/spotify.md` | Page | Spotify listening analysis |
| `observablehq.config.js` | Config | App title, theme, base path, analytics |

## Key Type Definitions

All defined in `parseLocations.ts`:

- **`Segment`** — Core data type: location + time range + duration + geographic enrichment
- **`BarChartKeyframe`** — Data for animated bar chart race
- **`HomeCluster`** — Clustered home locations (3am positions)
- **`DailyJourney`** — Daily movement path with relative coordinates
- **`DailyStats`** — Per-day aggregated statistics
