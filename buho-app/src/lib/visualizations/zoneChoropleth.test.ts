import { describe, it, expect } from 'vitest';
import {
    zoneKey,
    normalizePath,
    keyLabel,
    keyName,
    buildZoneRollup,
    metricValue,
    formatMetric,
    depthForZoom,
    DEPTH_ZOOM_BREAKS,
    DEPTH_ZOOM_HYSTERESIS,
    makeColorScale,
    ZONE_RAMP,
    LAND_RGB,
    MIN_MIX,
    buildFeatureKeys,
    buildFeatureBoxes,
    stashFeatureKeys,
    keyOfFeature,
    boundsByKey,
    unionBounds,
    layoutLabels,
    pathOfFeature,
    MASK_FOR_DEPTH,
    TOTAL_MASK,
    type ZonePath,
    type ZoneRollupRow,
    type ZoneFeature,
} from './zoneChoropleth';

const path = (p: Partial<ZonePath>): ZonePath => ({
    country: null,
    region: null,
    department: null,
    arrondissement: null,
    ...p,
});

const PARIS = path({
    country: 'France',
    region: 'Île-de-France',
    department: 'Paris',
    arrondissement: 'Paris 11e Arrondissement',
});
const MADRID = path({ country: 'Spain', region: 'Comunidad de Madrid' });
const RUSSIA = path({ country: 'Russia' });

describe('zoneKey', () => {
    it('truncates the hierarchy at the requested depth', () => {
        expect(keyLabel(zoneKey(PARIS, 1))).toBe('France');
        expect(keyLabel(zoneKey(PARIS, 2))).toBe('France › Île-de-France');
        expect(keyLabel(zoneKey(PARIS, 3))).toBe('France › Île-de-France › Paris');
        expect(keyLabel(zoneKey(PARIS, 4))).toBe(
            'France › Île-de-France › Paris › Paris 11e Arrondissement',
        );
    });

    it('falls back to the leaf when the hierarchy is shallower than the depth', () => {
        // Only France has departments/arrondissements in the shipped asset.
        expect(zoneKey(MADRID, 3)).toBe(zoneKey(MADRID, 2));
        expect(zoneKey(MADRID, 4)).toBe(zoneKey(MADRID, 2));
    });

    it('stops at the first gap rather than skipping it', () => {
        // The 7 leaves with a null region (Russia, Mexico, Antarctica, …) must stay
        // keyed on their country at every depth.
        const holed = path({ country: 'Russia', department: 'Somehow set' });
        expect(zoneKey(holed, 4)).toBe('Russia');
        expect(zoneKey(RUSSIA, 3)).toBe('Russia');
    });

    it('keeps same-named regions in different countries distinct', () => {
        const frCentre = path({ country: 'France', region: 'Centre' });
        const ptCentre = path({ country: 'Portugal', region: 'Centre' });
        expect(zoneKey(frCentre, 2)).not.toBe(zoneKey(ptCentre, 2));
        expect(keyName(zoneKey(frCentre, 2))).toBe(keyName(zoneKey(ptCentre, 2)));
    });

    it('returns an empty key for an unmappable row', () => {
        expect(zoneKey(path({}), 1)).toBe('');
        expect(zoneKey(path({ country: '' }), 2)).toBe('');
    });
});

describe('normalizePath', () => {
    it('falls a missing country back to the region', () => {
        // 16 leaves have no ADM0 parent in Natural Earth (Gibraltar, Akrotiri,
        // Guantanamo Bay, Clipperton, the US minor islands…). Without the fallback
        // they key to '' and vanish from both the map and the aggregates.
        const p = normalizePath({ region: 'Gibraltar' });
        expect(p.country).toBe('Gibraltar');
        expect(p.region).toBeNull();
        expect(zoneKey(p, 4)).toBe('Gibraltar');
        expect(keyLabel(zoneKey(p, 2))).toBe('Gibraltar');
    });

    it('collapses a region that repeats its country', () => {
        const p = normalizePath({ country: 'Singapore', region: 'Singapore' });
        expect(p.region).toBeNull();
        expect(keyLabel(zoneKey(p, 2))).toBe('Singapore');
    });

    it('leaves a genuine hierarchy untouched and treats blanks as missing', () => {
        expect(normalizePath({ country: 'France', region: 'Bretagne' })).toEqual({
            country: 'France',
            region: 'Bretagne',
            department: null,
            arrondissement: null,
        });
        expect(normalizePath({ country: '  ', region: '' }).country).toBeNull();
    });
});

describe('buildZoneRollup', () => {
    const row = (mask: number, p: Partial<ZonePath>, agg: Partial<ZoneRollupRow> = {}) =>
        ({
            depthMask: mask,
            ...path(p),
            hours: 1,
            km: 1,
            points: 1,
            ...agg,
        }) as ZoneRollupRow;

    it('files each mask at its depth and keeps the grand total apart', () => {
        const { byDepth, total } = buildZoneRollup([
            row(MASK_FOR_DEPTH[1], { country: 'France' }, { hours: 100 }),
            row(MASK_FOR_DEPTH[2], { country: 'France', region: 'Île-de-France' }, { hours: 60 }),
            row(
                MASK_FOR_DEPTH[3],
                { country: 'France', region: 'Île-de-France', department: 'Paris' },
                { hours: 40 },
            ),
            row(
                MASK_FOR_DEPTH[4],
                {
                    country: 'France',
                    region: 'Île-de-France',
                    department: 'Paris',
                    arrondissement: 'Paris 11e',
                },
                { hours: 25 },
            ),
            row(TOTAL_MASK, {}, { hours: 500 }),
        ]);

        expect(byDepth[1].get(zoneKey(path({ country: 'France' }), 1))?.hours).toBe(100);
        expect(byDepth[2].size).toBe(1);
        expect(byDepth[3].size).toBe(1);
        expect(byDepth[4].size).toBe(1);
        expect(total?.hours).toBe(500);
    });

    it('ignores masks that map to no depth', () => {
        // e.g. mask 5 — a grouping set ROLLUP never emits.
        const { byDepth } = buildZoneRollup([row(5, { country: 'France' })]);
        expect(byDepth[1].size).toBe(0);
    });

    it('keeps each depth as the engine computed it', () => {
        // Depths come straight from the ROLLUP rather than being summed in JS, so a
        // parent keeps its own figures even when the children are listed too.
        const { byDepth } = buildZoneRollup([
            row(MASK_FOR_DEPTH[1], { country: 'France' }, { km: 30 }),
            row(MASK_FOR_DEPTH[2], { country: 'France', region: 'A' }, { km: 20 }),
            row(MASK_FOR_DEPTH[2], { country: 'France', region: 'B' }, { km: 10 }),
        ]);
        expect(byDepth[1].get(zoneKey(path({ country: 'France' }), 1))?.km).toBe(30);
        expect(byDepth[2].size).toBe(2);
    });

    it('skips rows with no country', () => {
        const { byDepth } = buildZoneRollup([row(MASK_FOR_DEPTH[1], {})]);
        expect(byDepth[1].size).toBe(0);
    });
});

describe('depthForZoom', () => {
    it('maps zoom ranges to depths when starting from the matching depth', () => {
        expect(depthForZoom(1, 1)).toBe(1);
        expect(depthForZoom(5, 2)).toBe(2);
        expect(depthForZoom(7, 3)).toBe(3);
        expect(depthForZoom(12, 4)).toBe(4);
    });

    it('commits a one-step change only past the deadband', () => {
        const brk = DEPTH_ZOOM_BREAKS[0];
        // Just past the break but inside the deadband: hold.
        expect(depthForZoom(brk + DEPTH_ZOOM_HYSTERESIS / 2, 1)).toBe(1);
        // Clearly past: commit.
        expect(depthForZoom(brk + DEPTH_ZOOM_HYSTERESIS, 1)).toBe(2);
        // Coming back, still inside the deadband: hold at 2.
        expect(depthForZoom(brk - DEPTH_ZOOM_HYSTERESIS / 2, 2)).toBe(2);
        expect(depthForZoom(brk - DEPTH_ZOOM_HYSTERESIS, 2)).toBe(1);
    });

    it('does not oscillate while jittering around a break', () => {
        const brk = DEPTH_ZOOM_BREAKS[1];
        let depth = depthForZoom(brk + 1, 2); // settle at 3
        expect(depth).toBe(3);
        for (const z of [brk + 0.1, brk - 0.1, brk + 0.05, brk - 0.2, brk + 0.2]) {
            depth = depthForZoom(z, depth);
            expect(depth).toBe(3);
        }
    });

    it('commits immediately when more than one level away', () => {
        // A fitBounds flight, not gesture jitter.
        expect(depthForZoom(12, 1)).toBe(4);
        expect(depthForZoom(0, 4)).toBe(1);
    });
});

describe('makeColorScale', () => {
    it('spreads an extreme range across the whole ramp', () => {
        // Home region against a country crossed once: four orders of magnitude. On a
        // linear domain everything but home would sit in the palest sliver.
        const s = makeColorScale([1, 10, 100, 1000, 30000]);
        expect(s.t(1)).toBe(0);
        expect(s.t(30000)).toBe(1);
        // Log spacing: the geometric mean lands in the middle of the ramp.
        expect(s.t(Math.sqrt(1 * 30000))).toBeCloseTo(0.5, 5);
    });

    it('is monotone in the value', () => {
        const s = makeColorScale([2, 5, 40, 900]);
        const ts = [2, 5, 40, 900].map((v) => s.t(v));
        for (let i = 1; i < ts.length; i++) expect(ts[i]).toBeGreaterThan(ts[i - 1]);
    });

    it('treats zero and undefined as no data', () => {
        const s = makeColorScale([1, 100]);
        expect(s.t(0)).toBe(-1);
        expect(s.t(undefined)).toBe(-1);
    });

    it('barely tints the lowest value and saturates the highest', () => {
        // There is no basemap: fills are composited over the white land, so a zone
        // visited once stays a whisper against it rather than a full category.
        const s = makeColorScale([1, 30000]);
        const low = s.fill(1);
        const lum = (c: number[]) => c[0] + c[1] + c[2];
        expect(lum(low)).toBeGreaterThan(lum(LAND_RGB) * (1 - MIN_MIX));
        // More time = deeper, more saturated red — never the other way round.
        expect(lum(s.fill(30000))).toBeLessThan(lum(low));
    });

    it('leaves an unvisited zone as plain white land', () => {
        const s = makeColorScale([1, 30000]);
        expect(s.fill(0)).toEqual(LAND_RGB);
        expect(s.fill(undefined)).toEqual(LAND_RGB);
    });

    it('survives degenerate inputs', () => {
        expect(() => makeColorScale([])).not.toThrow();
        expect(makeColorScale([]).t(5)).toBe(-1);
        // A single visited zone has no span: it takes the top of the ramp rather
        // than dividing by zero or rendering as the palest step.
        const one = makeColorScale([7]);
        expect(one.t(7)).toBe(1);
        expect(makeColorScale([7, 7, 7]).t(7)).toBe(1);
    });

    it('produces a gradient and log-spaced ticks for the legend', () => {
        const s = makeColorScale([1, 10, 100, 1000]);
        expect(s.samples(12)).toHaveLength(12);
        expect(s.samples(12)[0]).toMatch(/^rgb\(/);

        const ticks = s.ticks(5);
        expect(ticks).toHaveLength(5);
        expect(ticks[0]).toBeCloseTo(1);
        expect(ticks[4]).toBeCloseTo(1000);
        // Equal ratios between consecutive ticks, not equal differences.
        const ratios = ticks.slice(1).map((v, i) => v / ticks[i]);
        for (const r of ratios) expect(r).toBeCloseTo(ratios[0]);
    });
});

describe('ZONE_RAMP', () => {
    it('is a five-step single-hue ramp running pale to deep', () => {
        expect(ZONE_RAMP).toHaveLength(5);
        const lum = (hex: string) => {
            const n = parseInt(hex.slice(1), 16);
            return ((n >> 16) & 255) + ((n >> 8) & 255) + (n & 255);
        };
        for (let i = 1; i < ZONE_RAMP.length; i++) {
            expect(lum(ZONE_RAMP[i])).toBeLessThan(lum(ZONE_RAMP[i - 1]));
        }
    });
});


describe('formatMetric / metricValue', () => {
    it('reads the requested measure', () => {
        const agg = { hours: 12.5, km: 340, points: 40 };
        expect(metricValue(agg, 'hours')).toBe(12.5);
        expect(metricValue(agg, 'km')).toBe(340);
        expect(metricValue(agg, 'points')).toBe(40);
    });

    it('formats without assuming a locale', () => {
        // Locale-independent assertions only (cf. the project convention).
        expect(formatMetric(2.5, 'hours')).toBe('2.5h');
        expect(formatMetric(1234, 'hours')).toBe(`${(1234).toLocaleString()}h`);
        expect(formatMetric(340, 'km')).toBe(`${(340).toLocaleString()} km`);
        expect(formatMetric(40, 'points')).toBe((40).toLocaleString());
    });
});

// --- Geometry ---------------------------------------------------------------

const feature = (props: Record<string, unknown>, coords: number[][]): ZoneFeature => ({
    type: 'Feature',
    properties: props,
    geometry: { type: 'Polygon', coordinates: [coords] },
});

const box = (w: number, s: number, e: number, n: number) => [
    [w, s],
    [e, s],
    [e, n],
    [w, n],
    [w, s],
];

describe('pathOfFeature', () => {
    it('reads the hierarchy off the topojson properties', () => {
        const f = feature(
            { level: 'department', country: 'France', region: 'Île-de-France', department: 'Paris' },
            box(2, 48, 3, 49),
        );
        expect(pathOfFeature(f)).toEqual({
            country: 'France',
            region: 'Île-de-France',
            department: 'Paris',
            arrondissement: null,
        });
    });

    it('treats blank strings as missing', () => {
        const f = feature({ level: 'region', country: 'Chile', region: '' }, box(-75, -55, -66, -18));
        expect(pathOfFeature(f).region).toBeNull();
    });
});

describe('buildFeatureBoxes / boundsByKey', () => {
    it('unions the boxes of features that share a hierarchy path', () => {
        // 28 leaves in the real asset are multi-part geometries with identical
        // properties, so key → feature is one-to-many.
        const props = { level: 'region', country: 'France', region: 'Bretagne' };
        const features = [feature(props, box(-5, 47, -3, 48)), feature(props, box(-2, 48, 0, 49))];
        const keys = buildFeatureKeys(features);
        const boxes = buildFeatureBoxes(features);
        const bounds = boundsByKey(keys, boxes, 2);
        expect(bounds.size).toBe(1);
        expect(bounds.get(zoneKey(path({ country: 'France', region: 'Bretagne' }), 2))).toEqual([
            [-5, 47],
            [0, 49],
        ]);
    });

    it('measures an antimeridian feature in a shifted frame', () => {
        // Naive min/max on Fiji/Russia spans the planet and makes fitBounds zoom out.
        const fiji = feature({ level: 'region', country: 'Fiji', region: 'Western' }, [
            [177, -18],
            [179, -18],
            [-179, -17],
            [-177, -17],
            [177, -18],
        ]);
        const boxes = buildFeatureBoxes([fiji]);
        const [w, , e] = [boxes[0], boxes[1], boxes[2]];
        expect(e - w).toBeLessThan(180);
        expect(w).toBeGreaterThanOrEqual(177);
        expect(e).toBeGreaterThan(180); // wrapped frame; MapLibre accepts lng > 180
    });

    it('unions across the antimeridian when the parts are separate features', () => {
        // Russia's Chukotka and Alaska's Aleutians are their own features, each
        // narrow, so only the *union* straddles −180/180. A naive union spans the
        // planet and fitBounds then zooms out to the whole world on a click.
        const props = (region: string) => ({ level: 'region', country: 'Russia', region });
        const features = [
            feature(props('Moscow'), box(37, 55, 38, 56)),
            feature(props('Kamchatka'), box(158, 52, 163, 57)),
            feature(props('Chukotka'), box(-180, 64, -169, 68)),
        ];
        const keys = buildFeatureKeys(features);
        const boxes = buildFeatureBoxes(features);
        const b = boundsByKey(keys, boxes, 1).get(zoneKey(path({ country: 'Russia' }), 1))!;
        expect(b[1][0] - b[0][0]).toBeLessThan(180);
        expect(b[0][0]).toBe(37);
        expect(b[1][0]).toBe(191); // −169 in the shifted frame
    });

    it('keeps the unshifted frame for a zone that genuinely spans the globe', () => {
        // France's overseas territories really do straddle both hemispheres; shifting
        // them would give a *wider* box, so the naive frame must win.
        const props = (region: string) => ({ level: 'region', country: 'France', region });
        const features = [
            feature(props('Guadeloupe'), box(-62, 15, -61, 16)),
            feature(props('Île-de-France'), box(2, 48, 3, 49)),
            feature(props('La Réunion'), box(55, -21, 56, -20)),
        ];
        const keys = buildFeatureKeys(features);
        const boxes = buildFeatureBoxes(features);
        const b = boundsByKey(keys, boxes, 1).get(zoneKey(path({ country: 'France' }), 1))!;
        expect(b[0][0]).toBe(-62);
        expect(b[1][0]).toBe(56);
    });

    it('does not invert a box straddling the prime meridian', () => {
        // west < 0 < east: the two edges must shift together or not at all.
        const features = [
            feature({ level: 'region', country: 'UK', region: 'England' }, box(-2, 51, 1, 53)),
        ];
        const b = boundsByKey(
            buildFeatureKeys(features),
            buildFeatureBoxes(features),
            1,
        ).get(zoneKey(path({ country: 'UK' }), 1))!;
        expect(b[0][0]).toBe(-2);
        expect(b[1][0]).toBe(1);
    });

    it('rolls a country up from its region leaves at depth 1', () => {
        const features = [
            feature({ level: 'region', country: 'France', region: 'Bretagne' }, box(-5, 47, -3, 49)),
            feature({ level: 'region', country: 'France', region: 'Occitanie' }, box(1, 43, 4, 45)),
        ];
        const keys = buildFeatureKeys(features);
        const boxes = buildFeatureBoxes(features);
        expect(boundsByKey(keys, boxes, 1).get(zoneKey(path({ country: 'France' }), 1))).toEqual([
            [-5, 43],
            [4, 49],
        ]);
    });

    it('stashes keys on the features so accessors need no index', () => {
        // deck.gl's GeoJsonLayer splits its input per geometry type, so an accessor's
        // `index` cannot be assumed to line up with our arrays.
        const features = [
            feature({ level: 'region', country: 'France', region: 'Bretagne' }, box(-5, 47, -3, 49)),
            feature({ level: 'region', country: 'Iceland' }, box(-24, 63, -13, 66)),
        ];
        stashFeatureKeys(features, buildFeatureKeys(features));

        expect(keyOfFeature(features[0], 2)).toBe(
            zoneKey(path({ country: 'France', region: 'Bretagne' }), 2),
        );
        expect(keyOfFeature(features[1], 3)).toBe(zoneKey(path({ country: 'Iceland' }), 1));
        // Existing properties survive the stash.
        expect(pathOfFeature(features[0]).region).toBe('Bretagne');
    });

    it('returns an empty key for a feature with nothing stashed', () => {
        expect(keyOfFeature(feature({ country: 'France' }, box(0, 0, 1, 1)), 1)).toBe('');
    });

    it('gives every feature a key at all four depths', () => {
        const keys = buildFeatureKeys([
            feature({ level: 'region', country: 'Spain', region: 'Comunidad de Madrid' }, box(-4, 40, -3, 41)),
        ]);
        expect(keys[0]).toHaveLength(4);
        // Deeper than the leaf: the key stops at the region.
        expect(keys[0][2]).toBe(keys[0][1]);
        expect(keys[0][3]).toBe(keys[0][1]);
    });
});

describe('layoutLabels', () => {
    const vp = { width: 800, height: 500, longitude: 0, latitude: 20, zoom: 3 };

    it('drops the lesser of two colliding labels', () => {
        const kept = layoutLabels(
            [
                { text: 'Bigger', position: [0, 20], value: 100 },
                { text: 'Smaller', position: [0.05, 20], value: 1 },
            ],
            vp,
        );
        expect(kept.map((k) => k.text)).toEqual(['Bigger']);
    });

    it('keeps labels that are far enough apart', () => {
        const kept = layoutLabels(
            [
                { text: 'A', position: [-20, 20], value: 1 },
                { text: 'B', position: [20, 20], value: 2 },
            ],
            vp,
        );
        expect(kept).toHaveLength(2);
    });

    it('drops labels outside the viewport', () => {
        const kept = layoutLabels([{ text: 'Far', position: [170, -80], value: 5 }], vp);
        expect(kept).toHaveLength(0);
    });

    it('returns nothing before the container has been measured', () => {
        expect(layoutLabels([{ text: 'A', position: [0, 0], value: 1 }], {
            ...vp,
            width: 0,
        })).toEqual([]);
    });
});

describe('unionBounds', () => {
    it('frames every zone passed in', () => {
        expect(
            unionBounds([
                [
                    [-5, 47],
                    [-3, 49],
                ],
                [
                    [1, 43],
                    [4, 45],
                ],
            ]),
        ).toEqual([
            [-5, 43],
            [4, 49],
        ]);
    });

    it('returns null when there is nothing to frame', () => {
        expect(unionBounds([])).toBeNull();
    });

    it('keeps a globe-spanning set in the conventional frame', () => {
        // Every visited country, from the US to Japan: wide whichever way you cut it.
        // Shifting saves a little width but re-centres on the Pacific and splits
        // Europe across both edges, so the naive −180..180 frame must win.
        const b = unionBounds([
            [
                [-125, 25],
                [-67, 49],
            ], // continental US
            [
                [-5, 42],
                [9, 51],
            ], // France
            [
                [123, 31],
                [146, 45],
            ], // Japan
        ])!;
        expect(b[0][0]).toBe(-125);
        expect(b[1][0]).toBe(146);
    });

    it('unions boxes that arrive in different longitude frames', () => {
        // boundsByKey hands back an antimeridian zone already shifted (the USA comes
        // out as 172.5→293). Treating that as ordinary degrees alongside European
        // boxes used to give a 324° box running the long way through Asia.
        const b = unionBounds([
            [
                [172.5, 19],
                [293, 71],
            ], // USA, shifted frame
            [
                [-5, 41],
                [9, 51],
            ], // France, normal frame
        ])!;
        // The tight arc is the Atlantic one: Europe → America, not Europe → Asia.
        expect(b[1][0] - b[0][0]).toBeLessThan(220);
        expect(b[0][1]).toBe(19);
        expect(b[1][1]).toBe(71);
    });

    it('still repairs a set that genuinely wraps the antimeridian', () => {
        // Contiguous once you cross ±180 — the shifted frame is the correct read.
        const b = unionBounds([
            [
                [160, 50],
                [179, 60],
            ],
            [
                [-179, 51],
                [-170, 62],
            ],
        ])!;
        expect(b[0][0]).toBe(160);
        expect(b[1][0]).toBe(190);
    });
});
