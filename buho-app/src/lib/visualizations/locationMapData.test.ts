import { describe, it, expect } from 'vitest';
import {
    LOD_LEVELS,
    buildPositions,
    cellIndex,
    computeBounds,
    lodLevel,
    representatives,
} from './locationMapData';
import type { LocationBasePoint } from '#lib/data/queries/positionsQueries.ts';

/** Minimal base point carrying only what the map helpers read (lat/lon). */
function mk(lat: unknown, lon: unknown): LocationBasePoint {
    return {
        segId: 0,
        x: 0,
        y: 0,
        matched: true,
        metadata: { lat, lon },
        fSource: 'google-timeline',
        fSegmentType: 'moving',
        fActivityType: 'Unknown',
        fSemanticType: 'Unknown',
        dow: '1',
        year: '2024',
        mins: 0,
        distanceMeters: 0,
        placeId: '',
        country: 'Unknown',
        region: 'Unknown',
        department: 'Unknown',
        nearestCity: 'Unknown',
        arrondissement: 'Unknown',
        presenceMins: 0,
        fNovelty: 'Seen',
        fSpeed: 'Unknown',
        fAzimuth: 'Unknown',
    };
}

const PARIS = mk(48.8566, 2.3522);
const LONDON = mk(51.5074, -0.1278);
const NYC = mk(40.7128, -74.006);

describe('buildPositions', () => {
    it('emits [lon, lat] pairs and a parallel mapPoints array', () => {
        const { positions, mapPoints } = buildPositions([PARIS, LONDON, NYC]);
        expect(positions.length).toBe(6);
        expect(mapPoints).toEqual([PARIS, LONDON, NYC]);
        // First pair is Paris, in [lon, lat] order (deck.gl convention).
        expect(positions[0]).toBeCloseTo(2.3522, 3);
        expect(positions[1]).toBeCloseTo(48.8566, 3);
    });

    it('drops points with non-finite coordinates and realigns mapPoints', () => {
        const bad = [mk(NaN, 1), mk(1, null), mk(undefined, 2), mk('48.8', '2.3'), mk(Infinity, 3)];
        const { positions, mapPoints } = buildPositions([PARIS, ...bad, LONDON]);
        expect(positions.length).toBe(4); // only Paris + London survive
        expect(mapPoints).toEqual([PARIS, LONDON]);
        expect(positions[2]).toBeCloseTo(-0.1278, 3);
        expect(positions[3]).toBeCloseTo(51.5074, 3);
    });

    it('returns empty buffers for empty / all-invalid input', () => {
        expect(buildPositions([]).positions.length).toBe(0);
        expect(buildPositions([]).mapPoints).toEqual([]);
        expect(buildPositions([mk(NaN, NaN)]).positions.length).toBe(0);
    });
});

describe('computeBounds', () => {
    it('spans the min/max lon/lat of the finite points', () => {
        expect(computeBounds([PARIS, LONDON, NYC])).toEqual([
            [-74.006, 40.7128], // min lon (NYC) · min lat (NYC)
            [2.3522, 51.5074], //  max lon (Paris) · max lat (London)
        ]);
    });

    it('ignores invalid points when computing the box', () => {
        expect(computeBounds([mk(NaN, NaN), PARIS, mk(1, null)])).toEqual([
            [2.3522, 48.8566],
            [2.3522, 48.8566],
        ]);
    });

    it('returns null with no finite points', () => {
        expect(computeBounds([])).toBeNull();
        expect(computeBounds([mk(NaN, 1), mk(undefined, undefined)])).toBeNull();
    });
});

/** Flat [lon, lat, …] buffer from [lon, lat] pairs. */
function flat(pairs: [number, number][]): Float32Array {
    return Float32Array.from(pairs.flat());
}

describe('lodLevel', () => {
    it('picks the first level at or above the zoom', () => {
        expect(lodLevel(0)).toBe(LOD_LEVELS[0]);
        expect(lodLevel(3.2)).toBe(4);
        expect(lodLevel(4)).toBe(4);
    });

    it('draws every point past the finest level', () => {
        expect(lodLevel(LOD_LEVELS[LOD_LEVELS.length - 1] + 0.01)).toBeNull();
    });
});

describe('cellIndex', () => {
    // Two fixes ~1 m apart in Paris, one in London.
    const buffer = flat([
        [2.3522, 48.8566],
        [2.35221, 48.85661],
        [-0.1278, 51.5074],
    ]);

    it('puts points on the same pixel in one cell', () => {
        const { ids, count } = cellIndex(buffer, 4);
        expect(count).toBe(2);
        expect(ids[0]).toBe(ids[1]);
        expect(ids[2]).not.toBe(ids[0]);
    });

    it('separates them once a pixel is smaller than their gap', () => {
        // At zoom 30 a pixel is well under a millimetre.
        expect(cellIndex(buffer, 30).count).toBe(3);
    });

    it('survives the poles and the antimeridian', () => {
        const { count } = cellIndex(
            flat([
                [180, 90],
                [-180, -90],
            ]),
            2
        );
        expect(count).toBe(2);
    });
});

describe('representatives', () => {
    const cells = { ids: Uint32Array.from([0, 0, 0, 1, 1]), count: 2 };

    it('keeps the first dimmed and the first active point of each cell', () => {
        const active = new Set([1, 2, 4]);
        const r = representatives(5, (i) => active.has(i), cells);
        expect(Array.from(r.dimmed)).toEqual([0, 3]);
        expect(Array.from(r.active)).toEqual([1, 4]);
    });

    it('draws every point, split by state, without a cell index', () => {
        const r = representatives(4, (i) => i % 2 === 0, null);
        expect(Array.from(r.dimmed)).toEqual([1, 3]);
        expect(Array.from(r.active)).toEqual([0, 2]);
    });

    it('handles an empty set', () => {
        const r = representatives(0, () => true, null);
        expect(r.dimmed.length + r.active.length).toBe(0);
    });
});
