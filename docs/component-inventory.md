# Buho — Component Inventory

**Generated:** 2026-01-31 | **Scan Level:** Deep

## Overview

Buho has two categories of visualization components:
1. **Custom D3 Components** — Imperative, stateful components with animation and interaction
2. **Plot Specification Functions** — Declarative functions returning Observable Plot configurations

## Custom D3 Components (`components/`)

### Bar Chart Race (`barChartRace.ts`)

**Purpose:** Animated horizontal bar chart showing cumulative hours by region over time.

| Property | Value |
|---|---|
| **Export** | `createBarChartRace(container, keyframes, options)` |
| **Input** | `BarChartKeyframe[]`, `BarChartRaceOptions` |
| **Output** | `{ play, stop }` controls |
| **Animation** | D3 transitions, frame-by-frame with interpolated values |
| **Features** | Play/stop button, dynamic axis scaling, text tweening, enter/exit animations |

**Options:** `topN` (10), `barHeight` (48), `frameDuration` (50ms), `colorScale`, `title`

---

### Interactive Map (`interactiveMap.ts`)

**Purpose:** Leaflet map displaying location segments as circle markers with popups.

| Property | Value |
|---|---|
| **Export** | `createInteractiveMap(container, segments, options)` |
| **Input** | `Segment[]`, `MapOptions` |
| **Output** | `{ map, updateMarkers }` |
| **Tile Layer** | CartoDB Positron (light, minimal style) |
| **Renderer** | Canvas (L.canvas for performance with many points) |
| **Features** | Auto-fit bounds, popup with duration/location info, filter by segment type |

**Options:** `height` (500), `showMovingSegments`, `showStationarySegments`, `pointRadius` (2.5), `pointOpacity` (0.4)

---

### Daily Journey Radar (`dailyJourneyRadar.ts`)

**Purpose:** Animated radar chart showing daily movement patterns relative to home location.

| Property | Value |
|---|---|
| **Export** | `createDailyJourneyRadar(container, journeys, homeClusters, options)` |
| **Input** | `DailyJourney[]`, `HomeCluster[]`, options |
| **Output** | `{ play, stop, setFilter }` controls |
| **Features** | Concentric distance grid, cardinal directions, animated path drawing, trail history, cluster filtering |

**Options:** `width` (600), `height` (600), `frameDuration` (200ms), `maxTrails` (50), `scaleKm` (auto from 95th percentile)

---

### Daily Journey Small Multiples (`dailyJourneySmallMultiples.ts`)

**Purpose:** Grid of miniature radar charts, one per day, showing movement patterns.

| Property | Value |
|---|---|
| **Export** | `createDailyJourneySmallMultiples(container, journeys, options)` |
| **Input** | `DailyJourney[]`, options |
| **Output** | `{ update }` function |
| **Features** | Responsive grid layout, closed path with fill, tooltips, max 625 cells (25x25) |

**Options:** `cellSize` (24), `maxCols` (25), `maxRows` (25), `scaleKm` (20), `showDates` (false)

---

### Calendar Transform (`calendar.ts`)

**Purpose:** Layout transform that positions data in a year/week calendar grid for Observable Plot.

| Property | Value |
|---|---|
| **Export** | `calendar({ date, inset, ...options })` |
| **Input** | Date accessor function, Plot options |
| **Output** | Plot mark options with `fy` (year), `x` (week), `y` (day of week) transforms |

## Plot Specification Functions (`visualizations/locationPlots.ts`)

All functions return `Plot.plot(...)` results (SVG elements).

### Geographic Plots

| Function | Title | Type | Color Scheme |
|---|---|---|---|
| `createCountryMapPlot` | Country choropleth | Geo projection (equirectangular) | Greens (log) |
| `createDepartmentMapPlot` | Department choropleth (count) | Geo projection (orthographic) | Greens (log) |
| `createDepartmentDurationPlot` | Time by department (days) | Geo projection (orthographic) | Greens (log) |
| `createArrondissementPlot` | Arrondissement choropleth | Geo projection (orthographic) | Reds (log) |

### Temporal Plots

| Function | Title | Type |
|---|---|---|
| `createSegmentsByTimeOfDayPlot` | Segments by time of day | Dot plot (1152x1152) |
| `createSegmentsByDepartmentPlot` | By time colored by dept | Dot plot (1152x1152) |

### Calendar Plots

| Function | Title | Color |
|---|---|---|
| `createDepartmentCalendar` | Main location by day | Department color scale |
| `createDistanceCalendar` | Distance per day | Reds (log) |
| `createTravelRadiusCalendar` | Travel radius per day | Oranges (log) |

### Distance Plots

| Function | Title | Type |
|---|---|---|
| `createWeeklyDistancePlot` | Distance per week | Bar chart (weekly bins) |
| `createCumulativeDistancePlot` | Cumulative distance | Area chart |
| `createDailyTravelRadiusPlot` | Daily travel radius | Line + dot |
| `createTravelRadiusDistribution` | Radius distribution | Histogram (25 bins) |

### Home Distance Plots

| Function | Title | Type |
|---|---|---|
| `createHomeDistanceByTimePlot` | Distance from home by time | Scatter (log Y) |
| `createRadialHomeDistancePlot` | Radial view by time | Polar scatter (600x600) |

## Configuration Components (`config/colorScales.ts`)

| Export | Purpose |
|---|---|
| `createRegionColorScales(timeline)` | Creates stable ordinal color scales for departments, countries, arrondissements. Uses D3 schemeTableau10, schemeCategory10, schemeSet3. |

## Utility Functions (`utils/formatDuration.ts`)

| Function | Example Output | Use Case |
|---|---|---|
| `formatDurationShort(seconds)` | `2a 3m 5j 12h` | Compact displays (French) |
| `formatDurationFull(seconds)` | `2 ans 3 jours 12 heures` | Tooltips (French) |
| `formatDurationShortEN(seconds)` | `2y 3mo 5d 12h` | Compact displays (English) |
| `formatDurationFullEN(seconds)` | `2 years 3 days 12 hours` | Tooltips (English) |
| `hoursToSeconds(hours)` | `3600` | Conversion |
| `parseDurationToHours(text)` | `8760` | Parse formatted strings back |
