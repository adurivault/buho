# Buho — Deployment Guide

**Generated:** 2026-01-31 | **Scan Level:** Deep

## Hosting Overview

Buho is deployed as a static site to two targets:

| Target | Method | URL | Trigger |
|---|---|---|---|
| **Observable Cloud** | Manual CLI deploy | https://adurivault.observablehq.cloud/buho/ | `npm run deploy` |
| **GitHub Pages** | GitHub Actions CI/CD | https://adurivault.github.io/buho/ | Push to `main` |

## Build

```bash
cd buho-app
npm ci          # Install exact dependencies
npm run build   # Build static site → dist/
```

**Output:** `buho-app/dist/` — self-contained static site with all assets bundled.

**Base path:** `/buho/` (configured in `observablehq.config.js`)

## Observable Cloud Deployment (Primary)

```bash
cd buho-app
npm run deploy
```

This uses Observable Framework's built-in deploy command. Requires Observable Cloud authentication (configured via `observable login`).

## GitHub Pages Deployment (Automatic)

### Workflow: `.github/workflows/deploy.yml`

**Triggers:**
- Push to `main` branch
- Manual workflow dispatch

**Pipeline steps:**

| Step | Action |
|---|---|
| 1 | Checkout repository |
| 2 | Setup Node 20 with npm cache (`buho-app/package-lock.json`) |
| 3 | `npm ci` in `buho-app/` |
| 4 | `npm run build` in `buho-app/` |
| 5 | Configure GitHub Pages |
| 6 | Upload `buho-app/dist/` as Pages artifact |
| 7 | Deploy to GitHub Pages environment |

**Permissions:** `contents: read`, `pages: write`, `id-token: write`

**Concurrency:** Group `"pages"`, no cancel-in-progress

## Environment Variables

No environment variables are required. The application is entirely client-side with no secrets, API keys, or backend configuration.

## Analytics

Umami analytics is configured via a script tag in the page head:
- **Provider:** Umami (cloud.umami.is)
- **Website ID:** `a4eb803f-ed09-4064-830e-c846f578884d`
- **Configuration:** Set in `observablehq.config.js` → `head` property

## Infrastructure Requirements

- **None.** The app is a static site served from CDN (Observable Cloud or GitHub Pages).
- No database, no backend, no server-side processing.
- All computation happens client-side in the user's browser.
