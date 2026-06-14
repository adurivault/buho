# Buho — Project Overview

**Generated:** 2026-01-31 | **Scan Level:** Deep | **Document Language:** English

## Executive Summary

Buho is a personal data visualization web application built with Observable Framework. Users upload their own data exports (Google Takeout location history, WhatsApp chat exports, Spotify listening history) and receive interactive graphs, maps, and analytical insights. The app runs entirely client-side with no backend — all data processing happens in the browser.

**Live application:** https://adurivault.observablehq.cloud/buho/

## Project Identity

| Attribute | Value |
|---|---|
| **Name** | Buho |
| **Type** | Web Application (Static Site) |
| **Repository** | Monolith |
| **Primary Language** | TypeScript |
| **Framework** | Observable Framework v1.12.0 |
| **Architecture** | Reactive notebook-style pages with modular components |
| **Hosting** | Observable Cloud + GitHub Pages (backup) |

## Technology Stack

| Category | Technology | Version | Purpose |
|---|---|---|---|
| **Framework** | Observable Framework | ^1.12.0 | Reactive markdown pages, build tooling, dev server |
| **Visualization** | Observable Plot | ^0.6.16 | Declarative chart generation (bar, line, calendar, geo) |
| **Visualization** | D3.js | ^7.9.0 | Low-level data manipulation and custom visualizations |
| **Mapping** | Leaflet | ^1.9.4 | Interactive maps with tile layers |
| **Mapping** | Leaflet.markercluster | ^1.5.3 | Clustering markers on maps |
| **Geospatial** | Turf.js | ^7.1.0 | Point-in-polygon, distance calculations |
| **Language** | TypeScript | ^5.7.2 | Type-safe JavaScript |
| **Testing** | Jest + ts-jest | ^29.7.0 | Unit testing with ESM support |
| **Formatting** | Prettier | ^3.3.3 | Code formatting |
| **Runtime** | Node.js | >=18 | Build and dev server |

### Secondary Stack (Python)

| Category | Technology | Version | Purpose |
|---|---|---|---|
| **Language** | Python | >=3.12 | Utility scripts |
| **CLI** | Typer | ^0.12.5 | CLI framework |
| **Package Manager** | UV | - | Python dependency management |

## Data Sources

Buho processes three types of personal data exports:

### 1. Google Takeout — Location History
- **Format:** JSON array of timeline entries (visit, activity, timelinePath)
- **Parser:** `parseLocations.ts` → `Segment[]` unified timeline
- **Enrichment:** Geographic tagging via point-in-polygon against GeoJSON boundaries
- **Visualizations:** Interactive map, choropleth maps, calendars, bar chart race, daily journey radar, travel radius charts

### 2. WhatsApp — Chat Export
- **Format:** Plain text (WhatsApp export format with timestamps)
- **Parser:** `parseConversation.ts` → `Message[]`
- **Visualizations:** Message frequency charts, sender analysis

### 3. Spotify — Streaming History
- **Format:** JSON from Spotify Takeout (extended streaming history)
- **Parser:** `parseSpotify.ts` → `SpotifyPlay[]`
- **Visualizations:** Listening patterns, platform breakdown, artist/track analysis

## Architecture Pattern

Observable Framework uses a **reactive notebook paradigm**:

1. **Pages** are Markdown files (`.md`) containing embedded TypeScript code blocks
2. Each code block is a **reactive cell** that re-executes when its dependencies change
3. `FileAttachment()` loads static assets (demo data, GeoJSON boundaries)
4. `Inputs.file()` provides reactive file upload widgets
5. The framework handles hot-reloading, routing, and static site generation

**Key architectural decisions:**
- All processing is client-side (no server, no database)
- Demo data is bundled for immediate visualization without user upload
- GeoJSON boundary files (countries, departments, arrondissements) are loaded as static assets
- Components are pure functions returning DOM elements or Plot specifications
