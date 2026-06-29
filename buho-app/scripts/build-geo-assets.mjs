/**
 * Offline, one-off pipeline that produces the geographic reference assets in
 * static/geo/. Re-run when the manifest or sources change.
 *
 *   node scripts/build-geo-assets.mjs        (or: npm run build:geo)
 *
 * v2 "leaf-zones" model: ONE layer where each polygon is the finest admin unit
 * of its territory and carries its full hierarchy in columns
 * (country/region/department/arrondissement). Runtime attribution is then a
 * single ST_Contains that reads the columns (see attributionSql.ts).
 *
 * Outputs:
 *   static/geo/geo_zones.topojson  leaf layer (hierarchy embedded)
 *   static/geo/ocean.topojson      oceans & seas (Natural Earth marine polys)
 *   static/geo/cities5000.json     cities > 5000 hab. (GeoNames)
 *   static/geo/NOTICE.txt          source/licence credits
 *
 * Sources (driven by scripts/geo-manifest.json):
 *   world default ADM1/ADM0  Natural Earth (public domain)
 *   curated countries        geoBoundaries gbOpen (national official sources)
 *   FR municipal arrondissements  OpenDataSoft georef-france (IGN/INSEE, open)
 *   oceans                   Natural Earth marine polys (public domain)
 *   cities                   GeoNames cities5000 (CC-BY)
 *
 * Hierarchy is embedded at build: from the source attributes when present, else
 * by point-in-polygon (ST_PointOnSurface → ST_Contains) against a parent layer.
 * Raw downloads are NOT committed; only the simplified outputs are.
 */
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import mapshaper from 'mapshaper';

const require = createRequire(import.meta.url);
const duckdb = require('@duckdb/duckdb-wasm/dist/duckdb-node-blocking.cjs');

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'static/geo');
// Download/work cache OUTSIDE static/ (so a failed build never leaves raw
// downloads in the served dir). Persists across runs; removed on success.
const TMP = resolve(ROOT, '.geo-build-cache');
mkdirSync(OUT, { recursive: true });
mkdirSync(TMP, { recursive: true });

const MANIFEST = JSON.parse(readFileSync(resolve(ROOT, 'scripts/geo-manifest.json'), 'utf8'));

const NE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson';
const GEONAMES = 'https://download.geonames.org/export/dump/cities5000.zip';
const ODS = 'https://public.opendatasoft.com/api/explore/v2.1/catalog/datasets';

async function fetchJson(url) {
  // Disk cache (TMP) so re-runs while iterating don't re-download.
  const cache = resolve(TMP, createHash('md5').update(url).digest('hex') + '.json');
  if (existsSync(cache)) return JSON.parse(readFileSync(cache, 'utf8'));
  console.log('↓', url.length > 90 ? url.slice(0, 90) + '…' : url);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  const j = await res.json();
  writeFileSync(cache, JSON.stringify(j));
  return j;
}

/** Run a build-time DuckDB statement, surfacing the SQL message cleanly (no wasm dump). */
function duck(label, sql) {
  try { return conn.query(sql); }
  catch (e) { console.error(`\n✗ DuckDB [${label}]: ${String(e.message || e).slice(0, 400)}`); process.exit(1); }
}

/** geoBoundaries gbOpen: API metadata → download GeoJSON (+ capture licence). */
const credits = [];
async function gbOpen(iso, level) {
  const meta = await fetchJson(`https://www.geoboundaries.org/api/current/gbOpen/${iso}/${level}/`);
  credits.push(`${iso} ${level}: ${meta.boundarySource} — ${meta.boundaryLicense}`);
  return fetchJson(meta.gjDownloadURL);
}

const titleCase = (s) => s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

// --- DuckDB assembly -------------------------------------------------------

let conn;
function initDuck() {
  const DIST = resolve(ROOT, 'node_modules/@duckdb/duckdb-wasm/dist');
  const bundles = {
    mvp: { mainModule: resolve(DIST, 'duckdb-mvp.wasm'), mainWorker: null },
    eh: { mainModule: resolve(DIST, 'duckdb-eh.wasm'), mainWorker: null },
  };
  return duckdb.createDuckDB(bundles, new duckdb.VoidLogger(), duckdb.NODE_RUNTIME).then(async (db) => {
    await db.instantiate(() => {});
    conn = db.connect();
    conn.query('LOAD spatial');
    conn.query("SET preserve_insertion_order = false");
  });
}

/** Load a GeoJSON FeatureCollection into a table; `cols` maps table column → property key. */
function loadLayer(table, gj, cols) {
  const rows = gj.features
    .filter((f) => f.geometry)
    .map((f) => {
      const r = { geom_text: JSON.stringify(f.geometry) };
      for (const [col, key] of Object.entries(cols)) {
        // OpenDataSoft returns multi-value fields as arrays (e.g. ["Paris"]); flatten.
        const v = f.properties?.[key];
        r[col] = Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
      }
      return r;
    });
  const p = resolve(TMP, `${table}.json`);
  writeFileSync(p, JSON.stringify(rows));
  const colDefs = Object.keys(cols).map((c) => `${c} VARCHAR`).join(', ');
  const colList = Object.keys(cols).join(', ');
  conn.query(`CREATE OR REPLACE TABLE ${table} AS
    SELECT ${colList}, ST_GeomFromGeoJSON(geom_text) AS geom FROM read_json_auto('${p}')`);
  return conn.query(`SELECT count(*) n FROM ${table}`).toArray()[0].toJSON().n;
}

async function buildLeafLayer() {
  await initDuck();

  // Parents + world default (Natural Earth).
  const ne0 = await fetchJson(`${NE}/ne_50m_admin_0_countries.geojson`);
  console.log('  ne0:', loadLayer('ne0', ne0, { country_code: 'ADM0_A3', country: 'ADMIN' }), 'countries');
  const ne1 = await fetchJson(`${NE}/ne_10m_admin_1_states_provinces.geojson`);
  console.log('  ne1:', loadLayer('ne1', ne1, { country_code: 'adm0_a3', region: 'name' }), 'world regions');

  // Curated countries (gbOpen). FR = ADM1 region parent + ADM2 department leaves.
  const fr1 = await gbOpen('FRA', 'ADM1');
  console.log('  fr1:', loadLayer('fr1', fr1, { region: 'shapeName' }), 'FR regions');
  const fr2 = await gbOpen('FRA', 'ADM2');
  console.log('  fr2:', loadLayer('fr2', fr2, { department: 'shapeName' }), 'FR departments');

  // FR municipal arrondissements (OpenDataSoft) — hierarchy already in attributes.
  const arrGj = await fetchJson(
    `${ODS}/georef-france-commune-arrondissement-municipal/exports/geojson?where=com_arm_name%20like%20%22Arrondissement%22&limit=-1`,
  );
  credits.push('FR arrondissements: OpenDataSoft georef-france (IGN/INSEE) — Open Licence / Licence Ouverte');
  console.log('  arr:', loadLayer('arr', arrGj, { arrondissement: 'com_arm_name', region: 'reg_name', department: 'dep_name' }), 'arrondissements');

  // Assemble the single leaf layer. Hierarchy: world via the adm0_a3 code in NE
  // ADM1; FR region by PIP against fr1; arrondissements carry their own.
  duck('leaves', `
    CREATE OR REPLACE TABLE leaves AS
    -- world ADM1 regions (France handled below)
    SELECT 'region' AS level, n1.country_code, n0.country AS country, n1.region, NULL AS department, NULL AS arrondissement, n1.geom
    FROM ne1 n1 LEFT JOIN ne0 n0 ON n0.country_code = n1.country_code
    WHERE n1.country_code <> 'FRA'
    UNION ALL
    -- countries with no ADM1 → country outline
    SELECT 'country', n0.country_code, n0.country, NULL, NULL, NULL, n0.geom
    FROM ne0 n0 WHERE n0.country_code NOT IN (SELECT DISTINCT country_code FROM ne1)
    UNION ALL
    -- FR departments not split by arrondissements; region by PIP
    SELECT 'department', 'FRA', 'France',
           (SELECT r.region FROM fr1 r WHERE ST_Contains(r.geom, ST_PointOnSurface(d.geom)) LIMIT 1),
           d.department, NULL, d.geom
    FROM fr2 d WHERE d.department NOT IN (SELECT DISTINCT department FROM arr)
    UNION ALL
    -- FR departments split by arrondissements: department minus the city (drop if empty = Paris)
    SELECT * FROM (
      SELECT 'department' AS level, 'FRA' AS country_code, 'France' AS country,
             (SELECT r.region FROM fr1 r WHERE ST_Contains(r.geom, ST_PointOnSurface(d.geom)) LIMIT 1) AS region,
             d.department, NULL AS arrondissement,
             ST_Difference(d.geom, (SELECT ST_Union_Agg(a.geom) FROM arr a WHERE a.department = d.department)) AS geom
      FROM fr2 d WHERE d.department IN (SELECT DISTINCT department FROM arr)
    ) WHERE NOT ST_IsEmpty(geom) AND ST_Area(geom) > 0.0005
    UNION ALL
    -- arrondissement leaves
    SELECT 'arrondissement', 'FRA', 'France', a.region, a.department, a.arrondissement, a.geom FROM arr a
  `);

  const stats = conn.query(`SELECT level, count(*) n FROM leaves GROUP BY level ORDER BY level`).toArray().map((r) => r.toJSON());
  console.log('  leaves:', stats.map((s) => `${s.level}=${s.n}`).join(', '));

  // Export to a GeoJSON FeatureCollection for mapshaper.
  const rows = duck('export', `
    SELECT level, country_code,
           COALESCE(arrondissement, department, region, country) AS zone_id,
           country, region, department, arrondissement,
           ST_AsGeoJSON(geom) AS gj
    FROM leaves`).toArray().map((r) => r.toJSON());
  return {
    type: 'FeatureCollection',
    features: rows.map((r) => ({
      type: 'Feature',
      properties: {
        level: r.level, country_code: r.country_code, zone_id: r.zone_id,
        country: r.country, region: r.region, department: r.department, arrondissement: r.arrondissement,
      },
      geometry: JSON.parse(r.gj),
    })),
  };
}

// --- mapshaper / outputs ---------------------------------------------------

async function simplifyToTopojson(geojson, outFile, pct, eachExpr = '', filter = '') {
  const filterCmd = filter ? `-filter '${filter}' ` : '';
  const eachCmd = eachExpr ? `-each '${eachExpr}' ` : '';
  const fields = 'level,country_code,zone_id,country,region,department,arrondissement';
  const out = await mapshaper.applyCommands(
    `-i in.json ${filterCmd}-simplify visvalingam ${pct} keep-shapes ${eachCmd}` +
      `-filter-fields ${fields} -o out.json format=topojson`,
    { 'in.json': typeof geojson === 'string' ? geojson : JSON.stringify(geojson) },
  );
  writeFileSync(resolve(OUT, outFile), out['out.json']);
  console.log('✓', outFile, `(${(out['out.json'].length / 1024).toFixed(0)} Ko)`);
}

async function buildOcean() {
  const marine = await fetchJson(`${NE}/ne_50m_geography_marine_polys.geojson`);
  marine.features = marine.features.filter((f) => f.properties && f.properties.name);
  for (const f of marine.features) {
    const n = titleCase(f.properties.name);
    f.properties = { level: 'ocean', country_code: 'OCEAN', zone_id: n, country: n, region: null, department: null, arrondissement: null };
  }
  await simplifyToTopojson(marine, 'ocean.topojson', '15%');
}

async function buildCities() {
  const ne0 = await fetchJson(`${NE}/ne_50m_admin_0_countries.geojson`);
  const iso = {};
  for (const f of ne0.features) {
    const p = f.properties;
    const a2 = p.ISO_A2 && p.ISO_A2 !== '-99' ? p.ISO_A2 : p.ISO_A2_EH;
    if (a2 && a2 !== '-99' && p.ADM0_A3) iso[a2] = p.ADM0_A3;
  }
  console.log('↓', GEONAMES);
  const zipPath = resolve(TMP, 'cities5000.zip');
  writeFileSync(zipPath, Buffer.from(await (await fetch(GEONAMES)).arrayBuffer()));
  const tsv = execSync(`unzip -p "${zipPath}" cities5000.txt`, { maxBuffer: 256 * 1024 * 1024 }).toString();
  const DROP = new Set(['PPLX', 'PPLH', 'PPLQ', 'PPLW']);
  // Keep the file small: only the fields the runtime uses (admin1 is unused), and
  // 3-decimal coords (~110 m) — ample for "nearest city", much lighter to parse.
  const r3 = (s) => Math.round(Number(s) * 1000) / 1000;
  const cities = [];
  for (const line of tsv.split('\n')) {
    if (!line) continue;
    const c = line.split('\t');
    if (DROP.has(c[7])) continue;
    cities.push({
      name: c[1], country_code: iso[c[8]] ?? c[8],
      population: Number(c[14]) || 0, lat: r3(c[4]), lon: r3(c[5]),
    });
  }
  writeFileSync(resolve(OUT, 'cities5000.json'), JSON.stringify(cities));
  console.log('✓', 'cities5000.json', `(${cities.length} villes, ${(JSON.stringify(cities).length / 1024 / 1024).toFixed(1)} Mo)`);
  credits.push('Cities: GeoNames — CC-BY 4.0');
}

// --- main ------------------------------------------------------------------

console.log('Manifest:', JSON.stringify(MANIFEST.curated), 'default', MANIFEST.default);
console.log('Assembling leaf layer (DuckDB)…');
const leaves = await buildLeafLayer();
await simplifyToTopojson(leaves, 'geo_zones.topojson', '12%');
await buildOcean();
await buildCities();

credits.push('World regions/countries & oceans: Natural Earth — public domain');
writeFileSync(resolve(OUT, 'NOTICE.txt'),
  'Data sources & licenses (modified: simplified)\n' + '='.repeat(46) + '\n' + credits.join('\n') + '\n');
console.log('✓ NOTICE.txt');
execSync(`rm -rf "${TMP}"`);
console.log('\nDone → static/geo/');
process.exit(0);
