# Buho — Project Documentation Index

**Generated:** 2026-01-31 | **Scan Level:** Deep | **Mode:** Initial Scan

## Project Overview

- **Type:** Monolith (single web application)
- **Primary Language:** TypeScript
- **Framework:** Observable Framework v1.12.0
- **Architecture:** Reactive notebook-style pages with modular visualization components
- **Live URL:** https://adurivault.observablehq.cloud/buho/

### Quick Reference

- **Tech Stack:** Observable Framework, D3.js, Observable Plot, Leaflet, Turf.js, TypeScript
- **Entry Point:** `buho-app/src/index.md`
- **Architecture Pattern:** Static site with client-side data processing
- **Data Sources:** Google Takeout (location), WhatsApp (chat), Spotify (streaming history)
- **Build:** `cd buho-app && npm run build`
- **Dev Server:** `cd buho-app && npm run dev` → http://127.0.0.1:3001

## Generated Documentation

- [Project Overview](./project-overview.md)
- [Architecture](./architecture.md)
- [Source Tree Analysis](./source-tree-analysis.md)
- [Component Inventory](./component-inventory.md)
- [Data Models](./data-models.md)
- [Development Guide](./development-guide.md)
- [Deployment Guide](./deployment-guide.md)

## Existing Documentation

- [README.md](../README.md) — Brief project description and live app link
- [CLAUDE.md](../CLAUDE.md) — Development session notes (Jan 2025): UX improvements, data structure refactoring, migration to Segment type
- [buho-app/README.md](../buho-app/README.md) — Observable Framework setup guide and project structure

## Application Pages

| Page | File | Description |
|---|---|---|
| Home | `src/index.md` | Landing page with data source cards |
| Google Maps | `src/google-maps.md` | Location history visualization (maps, calendars, charts) |
| WhatsApp | `src/whatsapp-chat.md` | Chat analysis (message frequency, sender stats) |
| Spotify | `src/spotify.md` | Listening history analysis |

## Getting Started

1. **Install:** `cd buho-app && npm install`
2. **Run:** `npm run dev` → opens at http://127.0.0.1:3001
3. **Use:** The app loads with demo data. Upload your own exports to see your data.
4. **Build:** `npm run build` → static site in `dist/`
5. **Deploy:** Push to `main` for automatic GitHub Pages deployment
