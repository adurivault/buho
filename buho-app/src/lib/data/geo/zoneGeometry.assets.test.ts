// @vitest-environment node
//
// Integrity of the shipped geo assets as the choropleth consumes them. The map's
// keys are built from the topojson properties on one side and from the attributed
// `google_maps_segments` columns on the other; those columns are copied verbatim
// from this same file by loadGeoAssets + attributeZones, so the join is only as
// sound as the assumptions below. A `npm run build:geo` that changed the hierarchy
// shape would otherwise surface as silently unfilled zones.
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { feature } from 'topojson-client';
import type { FeatureCollection } from 'geojson';
import type { GeometryCollection, Topology } from 'topojson-specification';
import {
    buildFeatureKeys,
    buildFeatureBoxes,
    boundsByKey,
    sanitizeFeatures,
    MAX_LATITUDE,
    DEPTHS,
    type ZoneFeature,
} from '$lib/visualizations/zoneChoropleth';

const STATIC = path.resolve(process.cwd(), 'static/geo');

function load(file: string): ZoneFeature[] {
    const topo = JSON.parse(readFileSync(path.join(STATIC, file), 'utf8')) as Topology;
    const name = Object.keys(topo.objects)[0];
    const fc = feature(topo, topo.objects[name] as GeometryCollection) as FeatureCollection;
    return fc.features as ZoneFeature[];
}

let zones: ZoneFeature[];
let keys: string[][];

beforeAll(() => {
    // Sanitized exactly as zoneGeometry does, so the assertions below describe what
    // deck.gl is actually handed. `ocean.topojson` is deliberately not loaded: seas
    // are excluded from the choropleth (cf. ZONE_ROLLUP_SQL).
    zones = sanitizeFeatures(load('geo_zones.topojson'));
    keys = buildFeatureKeys(zones);
});

describe('sanitizeFeatures', () => {
    it('keeps every vertex inside the projectable latitude range', () => {
        // deck.gl's lngLatToWorld hard-asserts this; Antarctica's ring reaches
        // -90.00000000000001 raw, and one bad vertex blanks the whole fill layer.
        // Reduced to the worst vertex first: asserting per vertex over the whole
        // dataset costs seconds of matcher overhead.
        let worst = 0;
        for (const f of zones) {
            eachLat(f, (lat) => {
                if (Math.abs(lat) > worst) worst = Math.abs(lat);
            });
        }
        expect(worst).toBeLessThanOrEqual(MAX_LATITUDE);
    });

    it('drops any feature simplification emptied', () => {
        // deck reports a coordinate-less MultiPolygon as malformed; ocean.topojson
        // has two, and the zone layer must never grow one unnoticed.
        const raw = load('geo_zones.topojson');
        expect(raw.length - zones.length).toBeLessThan(5);
    });
});

function eachLat(f: ZoneFeature, fn: (lat: number) => void): void {
    const walk = (c: unknown): void => {
        if (!Array.isArray(c)) return;
        if (typeof c[0] === 'number') {
            fn(c[1] as number);
            return;
        }
        for (const x of c) walk(x);
    };
    walk((f.geometry as { coordinates?: unknown }).coordinates);
}

describe('geo_zones.topojson', () => {
    it('is a flat leaf layer with no country-level polygon', () => {
        // Every ADM0 in Natural Earth also has ADM1 rows, so the build script's
        // 'country' branch yields nothing — depth 1 must come from the `country`
        // property of region leaves, never from a country-level feature.
        const levels = new Set(zones.map((f) => f.properties.level));
        expect(levels).toEqual(new Set(['region', 'department', 'arrondissement']));
    });

    it('keys every feature at depth 1, including the unparented territories', () => {
        // 16 leaves have no `country` (Gibraltar, Akrotiri, Guantanamo Bay,
        // Clipperton, the US minor islands…). normalizePath falls their country back
        // to the region, so they stay mappable instead of keying to ''.
        const unparented = zones.filter((f) => !f.properties.country);
        expect(unparented.length).toBeGreaterThan(0);
        expect(keys.every((k) => k[0] !== '')).toBe(true);

        for (const f of unparented) {
            const k = buildFeatureKeys([f])[0];
            expect(k[0]).toBe(f.properties.region);
            // They are a single level: no 'Gibraltar/Gibraltar' at depth 2.
            expect(new Set(k).size).toBe(1);
        }
    });

    it('has a handful of leaves with no region, which stay keyed on their country', () => {
        // Natural Earth ADM1 rows with a null name (Russia, Mexico, Antarctica, …).
        const holed = zones.filter((f) => !f.properties.region);
        expect(holed.length).toBeGreaterThan(0);
        expect(holed.length).toBeLessThan(20);
        for (const f of holed) {
            const k = buildFeatureKeys([f])[0];
            expect(k[1]).toBe(k[0]);
            expect(k[3]).toBe(k[0]);
        }
    });

    it('resolves France down to arrondissements and other countries to regions', () => {
        const byLevel = (lvl: string) => zones.filter((f) => f.properties.level === lvl);
        expect(byLevel('arrondissement').every((f) => f.properties.country === 'France')).toBe(true);
        expect(byLevel('department').every((f) => f.properties.country === 'France')).toBe(true);

        const spain = zones.find((f) => f.properties.country === 'Spain');
        expect(spain).toBeDefined();
        const k = buildFeatureKeys([spain!])[0];
        // No department in Spain: depths 3 and 4 collapse onto the region.
        expect(k[2]).toBe(k[1]);
        expect(k[3]).toBe(k[1]);
        expect(k[1]).not.toBe(k[0]);
    });
});

describe('bounds over the real geometry', () => {
    it('gives every depth a bounds entry per drawable key, within the lon/lat range', () => {
        const all = zones;
        const boxes = buildFeatureBoxes(all);
        // sanitizeFeatures already dropped the empty geometries, so every remaining
        // feature must contribute a box.
        expect(all.every((_, i) => !Number.isNaN(boxes[i * 4]))).toBe(true);

        for (const depth of DEPTHS) {
            const bounds = boundsByKey(keys, boxes, depth);
            const drawable = new Set(keys.map((k) => k[depth - 1]).filter((k) => k !== ''));
            expect(bounds.size).toBe(drawable.size);
            for (const [[w, s], [e, n]] of bounds.values()) {
                expect(Number.isFinite(w) && Number.isFinite(e)).toBe(true);
                expect(s).toBeGreaterThanOrEqual(-90);
                expect(n).toBeLessThanOrEqual(90);
                expect(e).toBeGreaterThanOrEqual(w);
                // Only a genuinely circumpolar zone may span the globe. Antarctica
                // and the Southern/Arctic oceans really do encircle a pole; anything
                // else that wide would be an unfixed antimeridian union.
                if (e - w > 200) expect(Math.max(-s, n)).toBeGreaterThan(60);
            }
        }
    });

    it('keeps antimeridian countries narrow rather than planet-wide', () => {
        // The real regression this guards: Russia's Chukotka and the US Aleutians sit
        // past ±180 as separate features, so a naive union would span the planet and
        // clicking either would zoom fitBounds out to the whole world.
        const boxes = buildFeatureBoxes(zones);
        const bounds = boundsByKey(keys, boxes, 1);
        for (const country of ['Russia', 'Fiji', 'New Zealand']) {
            const f = zones.find((z) => z.properties.country === country);
            expect(f, country).toBeDefined();
            const b = bounds.get(buildFeatureKeys([f!])[0][0])!;
            expect(b[1][0] - b[0][0], country).toBeLessThan(180);
        }
    });

    it('frames France around its actual extent', () => {
        const boxes = buildFeatureBoxes(zones);
        const franceKey = buildFeatureKeys([
            zones.find((f) => f.properties.country === 'France')!,
        ])[0][0];
        const b = boundsByKey(keys, boxes, 1).get(franceKey)!;
        // Metropolitan France plus its overseas territories, so a wide but sane box.
        expect(b[0][1]).toBeLessThan(45);
        expect(b[1][1]).toBeGreaterThan(50);
    });
});
