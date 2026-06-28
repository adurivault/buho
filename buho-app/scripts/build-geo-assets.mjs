/**
 * Offline, one-off pipeline that produces the geographic reference assets in
 * static/geo/. Re-run when adding a country or refreshing the sources.
 *
 *   node scripts/build-geo-assets.mjs          (or: npm run build:geo)
 *
 * Outputs:
 *   static/geo/adm0.topojson        world countries     (Natural Earth 50m)
 *   static/geo/ocean.topojson       oceans & seas       (Natural Earth marine polys)
 *   static/geo/adm1.topojson        France régions      (france-geojson)
 *   static/geo/adm1-world.topojson  world regions/states, France excluded (Natural Earth ADM1)
 *   static/geo/adm2-fr.topojson     France départements (france-geojson)
 *   static/geo/cities5000.json      cities > 5000 hab.  (GeoNames)
 *
 * Zone features are normalized to { country_code (ISO3), zone_id, name }.
 * Cities are { name, country_code (ISO3), admin1, population, lat, lon }.
 *
 * Sources & licences (credit in the app):
 *   Natural Earth — public domain
 *   france-geojson (gregoiredavid) — derived from IGN, open
 *   GeoNames — CC-BY 4.0
 *
 * Raw downloads are NOT committed; only the simplified outputs are.
 */
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import mapshaper from 'mapshaper';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'static/geo');
mkdirSync(OUT, { recursive: true });

const NE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson';
const FR = 'https://raw.githubusercontent.com/gregoiredavid/france-geojson/master';
const GEONAMES = 'https://download.geonames.org/export/dump/cities5000.zip';

async function fetchText(url) {
  console.log('↓', url);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.text();
}

const titleCase = (s) => s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

/** Simplify + normalize a GeoJSON string into a TopoJSON file. */
async function toTopojson(geojson, eachExpr, outFile, pct = '10%', filter = '') {
  const filterCmd = filter ? `-filter '${filter}' ` : '';
  const eachCmd = eachExpr ? `-each '${eachExpr}' ` : '';
  const out = await mapshaper.applyCommands(
    `-i in.json ${filterCmd}-simplify visvalingam ${pct} keep-shapes ${eachCmd}` +
      `-filter-fields country_code,zone_id,name -o out.json format=topojson`,
    { 'in.json': geojson },
  );
  writeFileSync(resolve(OUT, outFile), out['out.json']);
  console.log('✓', outFile, `(${(out['out.json'].length / 1024).toFixed(0)} Ko)`);
}

async function buildZones() {
  // World countries — ISO3 from ADM0_A3, name from ADMIN. The 50m source is
  // coarse at coasts (NYC/Manhattan falls just outside), but rather than ship the
  // heavier 10m file the attribution buffers the coastline (ST_DWithin): a point
  // a few km offshore counts as being in the country. See COUNTRY_COAST_BUFFER_DEG.
  const adm0 = await fetchText(`${NE}/ne_50m_admin_0_countries.geojson`);
  await toTopojson(adm0, 'country_code=ADM0_A3, zone_id=ADM0_A3, name=ADMIN', 'adm0.topojson', '40%');

  // France régions / départements — france-geojson uses { code, nom }.
  // Use the FULL source, not "-version-simplifiee": the latter already clips
  // indented coastlines (a point in Ajaccio fell outside Corse-du-Sud). We
  // simplify the full geometry ourselves at 20%, which preserves the coast.
  const reg = await fetchText(`${FR}/regions.geojson`);
  await toTopojson(reg, 'country_code="FRA", zone_id=String(code), name=nom', 'adm1.topojson', '20%');

  const dep = await fetchText(`${FR}/departements.geojson`);
  await toTopojson(dep, 'country_code="FRA", zone_id=String(code), name=nom', 'adm2-fr.topojson', '20%');

  // World regions/states (ADM1) — gives every non-France country a region level.
  // Must be the 10m file: 50m only carries provinces for ~9 federal countries.
  // France is excluded here (kept precise via adm1.topojson above).
  const adm1w = await fetchText(`${NE}/ne_10m_admin_1_states_provinces.geojson`);
  await toTopojson(
    adm1w,
    'country_code=adm0_a3, zone_id=adm0_a3+"-"+name, name=name',
    'adm1-world.topojson',
    '8%',
    'adm0_a3 != "FRA"',
  );

  // Oceans & seas — named Natural Earth marine polygons, used as a fallback when
  // a point is not inside any land country (level 'ocean').
  const marine = JSON.parse(await fetchText(`${NE}/ne_50m_geography_marine_polys.geojson`));
  marine.features = marine.features.filter((f) => f.properties && f.properties.name);
  for (const f of marine.features) {
    const n = titleCase(f.properties.name);
    f.properties = { country_code: 'OCEAN', zone_id: n, name: n };
  }
  await toTopojson(JSON.stringify(marine), '', 'ocean.topojson', '15%');

  return JSON.parse(adm0); // reused for the ISO2→ISO3 map below
}

/** Build an ISO2→ISO3 map from Natural Earth so GeoNames (ISO2) matches the zones (ISO3). */
function iso2to3(adm0Geo) {
  const map = {};
  for (const f of adm0Geo.features) {
    const p = f.properties;
    const a2 = p.ISO_A2 && p.ISO_A2 !== '-99' ? p.ISO_A2 : p.ISO_A2_EH;
    if (a2 && a2 !== '-99' && p.ADM0_A3) map[a2] = p.ADM0_A3;
  }
  return map;
}

async function buildCities(iso) {
  console.log('↓', GEONAMES);
  const zipPath = resolve(OUT, 'cities5000.zip');
  const buf = Buffer.from(await (await fetch(GEONAMES)).arrayBuffer());
  writeFileSync(zipPath, buf);
  // GeoNames columns: 1=name 4=lat 5=lon 8=countryISO2 10=admin1 14=population
  const tsv = execSync(`unzip -p "${zipPath}" cities5000.txt`, { maxBuffer: 256 * 1024 * 1024 }).toString();
  execSync(`rm -f "${zipPath}"`);

  // GeoNames feature codes to drop: subdivisions (PPLX = arrondissement/neighborhood,
  // which sit on the point and out-rank the real city) and non-current places.
  const DROP = new Set(['PPLX', 'PPLH', 'PPLQ', 'PPLW']);

  const cities = [];
  for (const line of tsv.split('\n')) {
    if (!line) continue;
    const c = line.split('\t');
    if (DROP.has(c[7])) continue;
    const iso2 = c[8];
    cities.push({
      name: c[1],
      country_code: iso[iso2] ?? iso2, // ISO3 when known
      admin1: c[10] ?? '',
      population: Number(c[14]) || 0,
      lat: Number(c[4]),
      lon: Number(c[5]),
    });
  }
  writeFileSync(resolve(OUT, 'cities5000.json'), JSON.stringify(cities));
  console.log('✓', 'cities5000.json', `(${cities.length} villes, ${(JSON.stringify(cities).length / 1024 / 1024).toFixed(1)} Mo)`);
}

const adm0Geo = await buildZones();
await buildCities(iso2to3(adm0Geo));
console.log('\nDone → static/geo/');
