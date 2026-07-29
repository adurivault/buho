import { describe, it, expect, vi } from 'vitest';
import {
    annotatePresenceMinutes,
    patchGeoAttributes,
    type LocationBasePoint
} from './googleMapsQueries';

const queryColumnar = vi.hoisted(() => vi.fn());
vi.mock('../db', () => ({ query: vi.fn(), queryColumnar }));

// annotatePresenceMinutes only reads the instant (x + y*3_600_000) and writes
// presenceMins, so a point is faked from x alone (y = 0 → x carries the instant
// in ms). Readable gaps come from setting x in whole minutes.
const MIN = 60_000; // ms per minute
function pt(instantMs: number): LocationBasePoint {
    return { x: instantMs, y: 0, presenceMins: 0 } as unknown as LocationBasePoint;
}

describe('annotatePresenceMinutes', () => {
    it('uses the gap until the next point when it is below 24h', () => {
        const a = pt(0);
        const b = pt(70 * MIN);
        annotatePresenceMinutes([a, b]);
        expect(a.presenceMins).toBe(70);
    });

    it('caps each gap at 24h (1440 min)', () => {
        const a = pt(0);
        const b = pt(5000 * MIN); // ~83h later → clamped to 1440
        annotatePresenceMinutes([a, b]);
        expect(a.presenceMins).toBe(1440);
    });

    it('gives the last point zero presence', () => {
        const a = pt(0);
        const b = pt(70 * MIN);
        annotatePresenceMinutes([a, b]);
        expect(b.presenceMins).toBe(0);
    });

    it('chains by instant even when input is unsorted', () => {
        const a = pt(0);
        const b = pt(70 * MIN);
        const c = pt(200 * MIN);
        annotatePresenceMinutes([c, a, b]); // shuffled
        expect(a.presenceMins).toBe(70); // a → b
        expect(b.presenceMins).toBe(130); // b → c
        expect(c.presenceMins).toBe(0); // last
    });

    it('clamps a zero/negative gap (duplicate instants) to 0', () => {
        const a = pt(0);
        const b = pt(0);
        annotatePresenceMinutes([a, b]);
        expect(a.presenceMins).toBe(0);
    });

    it('keeps Σ presence ≤ the tracked span (no double-counting, by construction)', () => {
        const instants = [0, 70, 200, 260, 5000, 5100].map((m) => m * MIN);
        const pts = instants.map(pt);
        annotatePresenceMinutes(pts);
        const span = (Math.max(...instants) - Math.min(...instants)) / MIN;
        const total = pts.reduce((s, p) => s + p.presenceMins, 0);
        expect(total).toBeLessThanOrEqual(span);
    });

    it('Σ presence equals the span when every gap is below the cap', () => {
        const instants = [0, 70, 200, 260].map((m) => m * MIN);
        const pts = instants.map(pt);
        annotatePresenceMinutes(pts);
        const total = pts.reduce((s, p) => s + p.presenceMins, 0);
        expect(total).toBe(260); // = last − first, in minutes
    });
});

/** Point as loaded before attribution: geo columns still all Unknown. */
function geoPt(segId: number): LocationBasePoint {
    return {
        segId,
        country: 'Unknown', region: 'Unknown', department: 'Unknown',
        nearestCity: 'Unknown', arrondissement: 'Unknown',
        metadata: {}
    } as unknown as LocationBasePoint;
}

describe('patchGeoAttributes', () => {
    it('writes the attributed columns onto the matching points, in place', async () => {
        queryColumnar.mockResolvedValue({
            numRows: 2,
            columns: {
                segId: [7, 3],
                country: ['France', 'Spain'],
                region: ['Île-de-France', 'Madrid'],
                department: ['Paris', 'Unknown'],
                nearestCity: ['Paris', 'Madrid'],
                arrondissement: ['Paris 4e', 'Unknown']
            }
        });

        const a = geoPt(3);
        const b = geoPt(7);
        const points = [a, b];
        await patchGeoAttributes(points);

        expect(b.country).toBe('France');
        expect(b.nearestCity).toBe('Paris');
        expect(b.arrondissement).toBe('Paris 4e');
        expect(a.country).toBe('Spain');
        expect(a.region).toBe('Madrid');
        // Same array, same objects: the map keeps its viewport, the
        // constellation its quadtree.
        expect(points[0]).toBe(a);
    });

    it('mirrors the geo fields onto metadata (the tooltip reads those)', async () => {
        queryColumnar.mockResolvedValue({
            numRows: 1,
            columns: {
                segId: [1], country: ['France'], region: ['Occitanie'],
                department: ['Tarn-et-Garonne'], nearestCity: ['Unknown'],
                arrondissement: ['Unknown']
            }
        });

        const p = geoPt(1);
        await patchGeoAttributes([p]);

        expect(p.metadata.country).toBe('France');
        expect(p.metadata.department).toBe('Tarn-et-Garonne');
    });

    it('leaves a point with no attributed row untouched', async () => {
        queryColumnar.mockResolvedValue({
            numRows: 1,
            columns: {
                segId: [42], country: ['France'], region: ['Bretagne'],
                department: ['Finistère'], nearestCity: ['Brest'],
                arrondissement: ['Unknown']
            }
        });

        const p = geoPt(1);
        await patchGeoAttributes([p]);

        expect(p.country).toBe('Unknown');
    });

    it('does not query at all for an empty point set', async () => {
        queryColumnar.mockClear();
        await patchGeoAttributes([]);
        expect(queryColumnar).not.toHaveBeenCalled();
    });
});
