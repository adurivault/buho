import { describe, it, expect } from 'vitest';
import { annotatePresenceMinutes, type LocationBasePoint } from './googleMapsQueries';

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
