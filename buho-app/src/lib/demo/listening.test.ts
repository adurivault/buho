import { describe, expect, it } from 'vitest';
import { generateListening } from './listening';
import { measureListening } from './diagnostics';
import { isSpotifyEntry, parseSpotifyData } from '#lib/data/sources/spotify/parse.ts';

/**
 * These assert the *shape* of the history, not its contents.
 *
 * The old demo passed every test that could be written about it — it was valid
 * JSON with valid timestamps — and still made the app look broken, because
 * nothing checked that it had a day, a ranking or a past. Each number below is
 * one a chart depends on, with a threshold set well clear of what uniform noise
 * produces, so this suite fails if the generator ever flattens out again.
 */

const entries = generateListening({
    seed: 42,
    years: 10,
    plays: 60_000,
    until: new Date('2026-01-01'),
});
const stats = measureListening(entries);

describe('the generated history is readable by the real importer', () => {
    it('produces entries the Spotify parser claims', () => {
        expect(entries.every(isSpotifyEntry)).toBe(true);
    });

    it('parses without special-casing', () => {
        const plays = parseSpotifyData(entries.slice(0, 500));
        expect(plays).toHaveLength(500);
        expect(plays[0].artistName).toBeTruthy();
        expect(plays[0].msPlayed).toBeGreaterThan(0);
    });

    it('arrives sorted, the way an export does', () => {
        const times = entries.map((entry) => entry.ts);
        expect(times).toEqual([...times].sort());
    });
});

describe('the same seed gives the same history', () => {
    it('is reproducible', () => {
        const again = generateListening({
            seed: 42,
            years: 10,
            plays: 60_000,
            until: new Date('2026-01-01'),
        });
        expect(again).toHaveLength(entries.length);
        expect(again[0]).toEqual(entries[0]);
        expect(again.at(-1)).toEqual(entries.at(-1));
    });

    it('and a different seed gives a different one', () => {
        const other = generateListening({
            seed: 43,
            years: 10,
            plays: 60_000,
            until: new Date('2026-01-01'),
        });
        expect(other[0]).not.toEqual(entries[0]);
    });
});

describe('a day has a shape', () => {
    // The failure this exists to prevent: the previous demo spread plays evenly
    // across all 24 hours, so every weekday-by-hour chart was a flat grid.
    it('is much busier in the evening than at four in the morning', () => {
        expect(stats.peakTroughRatio).toBeGreaterThan(8);
    });

    it('is quietest in the small hours', () => {
        const night = stats.hourShares[3] + stats.hourShares[4];
        const evening = stats.hourShares[19] + stats.hourShares[20];
        expect(evening).toBeGreaterThan(night * 10);
    });

    it('listens more per day at the weekend', () => {
        expect(stats.weekendRatio).toBeGreaterThan(1.1);
    });
});

describe('attention is a power law', () => {
    it('has a clear favourite rather than a flat field', () => {
        expect(stats.topToTenthRatio).toBeGreaterThan(1.8);
    });

    it('falls off like a power law across the ranking', () => {
        expect(stats.zipfSlope).toBeLessThan(-0.45);
    });

    // The first model tied an artist's era strength to their long-run rank, so
    // one artist was both the permanent favourite and the owner of the biggest
    // era: 24% of a decade, and a ranking that never changed hands. A real top
    // artist is a few percent.
    it('does not let one artist own the decade', () => {
        expect(stats.topArtistShare).toBeLessThan(0.12);
    });
});

describe('taste has a past', () => {
    // Without this, "how long you kept each artist" and "new tracks vs. tracks
    // you already had" have nothing to draw: every artist would be spread
    // evenly across the whole decade.
    it('concentrates the favourite artist into a period, not the whole decade', () => {
        expect(stats.topArtistPeakWindow).toBeGreaterThan(0.12);
    });

    // The long tail is the difference between plausible and convincing: a real
    // decade holds hundreds of artists played once or twice. Without them the
    // discovery charts have nothing to count, and the artist total gives the
    // whole thing away.
    it('is mostly strangers, the way a real decade is', () => {
        expect(stats.artists).toBeGreaterThan(300);
        expect(stats.tracks).toBeGreaterThan(3_000);
    });
});

describe('it is not tidy', () => {
    it('comes in sessions rather than scattered singles', () => {
        expect(stats.clumping).toBeGreaterThan(0.5);
    });

    it('has days with nothing on them', () => {
        expect(stats.emptyDays).toBeGreaterThan(100);
    });

    it('has at least one stretch where the export simply stops', () => {
        expect(stats.longestGapDays).toBeGreaterThan(14);
    });

    it('has skips, like a real history', () => {
        expect(stats.skipRate).toBeGreaterThan(0.08);
        expect(stats.skipRate).toBeLessThan(0.35);
    });

    it('spans the years it was asked for', () => {
        expect(stats.daysSpanned).toBeGreaterThan(3500);
    });
});

describe('size', () => {
    it('lands near the requested number of plays', () => {
        expect(entries.length).toBeGreaterThan(45_000);
        expect(entries.length).toBeLessThan(80_000);
    });
});

/**
 * Everything above runs on a hand-picked seed and play count. The app ships the
 * defaults, and a demo that only holds up under test parameters is a demo that
 * does not hold up — so the shipped configuration gets checked too.
 *
 * `until` is pinned because it otherwise defaults to today; that moves the
 * window without changing any of the shape being asserted here.
 */
describe('the configuration the app actually ships', () => {
    const shipped = measureListening(generateListening({ until: new Date('2026-06-01') }));

    it('is a decade at a realistic volume', () => {
        expect(shipped.plays).toBeGreaterThan(80_000);
        expect(shipped.daysSpanned).toBeGreaterThan(3_600);
    });

    it('has the long tail a real decade has', () => {
        expect(shipped.artists).toBeGreaterThan(400);
        expect(shipped.tracks).toBeGreaterThan(4_000);
    });

    it('has a day, a ranking and a past', () => {
        expect(shipped.peakTroughRatio).toBeGreaterThan(8);
        expect(shipped.zipfSlope).toBeLessThan(-0.5);
        expect(shipped.topArtistShare).toBeLessThan(0.2);
        expect(shipped.topArtistPeakWindow).toBeGreaterThan(0.06);
        expect(shipped.clumping).toBeGreaterThan(0.5);
        expect(shipped.longestGapDays).toBeGreaterThan(14);
    });
});
