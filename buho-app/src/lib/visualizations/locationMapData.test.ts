import { describe, it, expect } from 'vitest';
import { buildPositions, computeBounds } from './locationMapData';
import type { LocationBasePoint } from '$lib/data/queries/googleMapsQueries';

/** Minimal base point carrying only what the map helpers read (lat/lon). */
function mk(lat: unknown, lon: unknown): LocationBasePoint {
    return {
        x: 0,
        y: 0,
        matched: true,
        metadata: { lat, lon },
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
        presenceMins: 0
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
        const bad = [
            mk(NaN, 1),
            mk(1, null),
            mk(undefined, 2),
            mk('48.8', '2.3'),
            mk(Infinity, 3)
        ];
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
            [2.3522, 51.5074] //  max lon (Paris) · max lat (London)
        ]);
    });

    it('ignores invalid points when computing the box', () => {
        expect(computeBounds([mk(NaN, NaN), PARIS, mk(1, null)])).toEqual([
            [2.3522, 48.8566],
            [2.3522, 48.8566]
        ]);
    });

    it('returns null with no finite points', () => {
        expect(computeBounds([])).toBeNull();
        expect(computeBounds([mk(NaN, 1), mk(undefined, undefined)])).toBeNull();
    });
});
