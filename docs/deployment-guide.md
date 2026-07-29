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
- **Provider:** Umami Cloud (cloud.umami.is), cookieless — no consent banner needed
- **Website ID:** `a4eb803f-ed09-4064-830e-c846f578884d`
- **Configuration:** `buho-app/src/app.html` → `<head>`. `data-domains` restricts
  reporting to the production host, so localhost and previews stay out.

Custom events go through `buho-app/src/lib/analytics.ts`, which appends the page
context (`source` = spotify / google-maps, `mode` = guide / explore) to every
event, throttles continuous interactions and caps a page load at 300 events —
the Umami Cloud free tier counts pageviews *and* events against 100k/month.

| Event | Fired when | Key properties |
|---|---|---|
| `import-open` | Import dialog opened | `replace` |
| `import-step` | A dialog step is reached | `step`, `platform` |
| `import-file-picked` | File picker opened from the dialog | — |
| `upload` | Import succeeded | `files`, `format`, `rows`, `ms` |
| `upload-error` | Import failed | `reason` (closed set), `ms` |
| `geo-enrich` | Timeline zone attribution finished | `status`, `ms` |
| `demo-load` | Demo dataset loaded | — |
| `source-nav` | Guide ↔ Explore switch | `to` |
| `section-view` | A guide section is scrolled into view (once) | `section` |
| `filter-set` / `filter-remove` | An Explorer filter changes | `dimension`, `origin`, `dimOrigin`, `values` |
| `filter-clear` | "Clear all filters" | `combo`, `dimensions` |
| `filter-combo` | The set of active dimensions | `combo` |
| `viz-control` | A chart control is used | `viz`, `control`, `vizControl`, `value` |
| `js-error` / `promise-rejection` | Uncaught failures | `name`, `file` |

**No property ever carries user data**: only dimension keys, control ids, coarse
buckets and closed-set codes. Error messages and file names are never sent.

Umami breaks each property down on its own and cannot cross two custom
properties (issue umami-software/umami#4066). So the cross-cuts that matter are
pre-composed into a single value — `dimOrigin` (`artist@sunburst`), `vizControl`
(`day-race-map@color-mode`), `combo` (`artist+year`) — while the raw components
stay as separate properties for the one-dimension views. To scope any event to a
surface, filter the dashboard by page path (`/google-maps/explore`).

## Infrastructure Requirements

- **None.** The app is a static site served from CDN (Observable Cloud or GitHub Pages).
- No database, no backend, no server-side processing.
- All computation happens client-side in the user's browser.
