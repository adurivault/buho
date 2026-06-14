# Buho — Development Guide

**Generated:** 2026-01-31 | **Scan Level:** Deep

## Prerequisites

| Requirement | Version |
|---|---|
| Node.js | >= 18 |
| npm | (bundled with Node) |
| Python (optional) | >= 3.12 |
| UV (optional) | latest |

## Getting Started

### 1. Clone and Install

```bash
git clone https://github.com/adurivault/buho.git
cd buho/buho-app
npm install
```

### 2. Start Development Server

```bash
npm run dev
# Server starts at http://127.0.0.1:3001
# Hot reload is enabled by default
```

### 3. Open in Browser

Navigate to `http://127.0.0.1:3001`. The app loads with demo data by default.

## NPM Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start Observable Framework dev server (port 3001) |
| `npm run build` | Build static site to `dist/` |
| `npm run deploy` | Deploy to Observable Cloud |
| `npm run clean` | Clear Observable cache (`src/.observablehq/cache`) |
| `npm test` | Run Jest tests with ESM support |

## Project Structure for Development

### Adding a New Data Source

1. Create a parser in `src/data/parse<Source>.ts`:
   - Define TypeScript interfaces for raw and parsed data
   - Export a `parse<Source>Data(rawData)` function
   - Sort output chronologically

2. Create demo data in `src/data/demo-<source>.json` (or `.txt`)

3. Create a page in `src/<source>.md`:
   - Add file upload input with `Inputs.file()`
   - Load demo data with `FileAttachment()`
   - Call parser and display visualizations

4. Add a card to `src/index.md`

### Adding a New Visualization

1. **For declarative charts (Plot):** Add a function to `src/visualizations/` that returns `Plot.plot(...)`
2. **For interactive/animated charts (D3):** Create a component in `src/components/` that accepts a container element and returns controls

### Observable Framework Patterns

**Reactive cell pattern:**
```typescript
// In a .md page code block:
const data = FileAttachment("data/demo.json").json();
// This cell re-evaluates when data changes
```

**File upload with fallback to demo:**
```typescript
const file = view(Inputs.file({ label: "Upload", required: false }));
const rawData = file
  ? await file.json()
  : await FileAttachment("data/demo.json").json();
```

**Display pattern:**
```typescript
display(createMyChart(processedData));
```

## Testing

### Running Tests

```bash
cd buho-app
npm test
```

Jest is configured with:
- ESM support via `--experimental-vm-modules`
- ts-jest transform
- Test files: `*.test.ts`, `*.spec.ts`

### Test Data

Test fixtures are in `src/test-data/`:
- `location-history.json` — Sample Google Takeout data

## Build Process

```bash
cd buho-app
npm run build
```

Observable Framework compiles `.md` pages into a static site in `dist/`. The build:
- Processes all TypeScript imports
- Bundles dependencies
- Generates static HTML with embedded JavaScript
- Copies static assets

### Build Output

```
buho-app/dist/
├── index.html
├── google-maps.html
├── whatsapp-chat.html
├── spotify.html
├── _observablehq/          # Framework runtime
├── _import/                # Compiled TypeScript modules
├── _file/                  # Static files (GeoJSON, demo data)
└── static/                 # Icons, images
```

## Deployment

### Observable Cloud (Primary)

```bash
cd buho-app
npm run deploy
```

Deploys to: https://adurivault.observablehq.cloud/buho/

### GitHub Pages (Automatic)

Pushes to `main` trigger the GitHub Actions workflow:
1. Builds with Node 20
2. Deploys `dist/` to GitHub Pages

URL: https://adurivault.github.io/buho/

## Cache Management

Observable Framework caches compiled pages in `src/.observablehq/cache`. If you encounter stale data or build issues:

```bash
npm run clean
```

## Code Style

- **Formatter:** Prettier (configured but no explicit config file found)
- **TypeScript:** Strict mode disabled, no implicit any disabled
- **Modules:** ESM (`"type": "module"` in package.json)
- **Imports:** Use `.js` extensions in import paths (required for ESM)
