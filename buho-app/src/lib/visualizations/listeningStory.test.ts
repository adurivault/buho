import { describe, it, expect } from 'vitest';
import type { ConnectablePoint } from '#lib/data/queries/behaviorQueries.ts';
import {
    clockOf,
    dayKeyOf,
    dayStartMs,
    dayStartOf,
    pickFocusDay,
    spanLabel,
    trackOf,
} from './listeningStory';

/** A play at `hour` (fractional) on `date`, the way getAllConnectablePoints returns it. */
function play(date: string, hour: number, track = 'Track'): ConnectablePoint {
    const hh = String(Math.floor(hour)).padStart(2, '0');
    const mm = String(Math.round((hour % 1) * 60)).padStart(2, '0');
    return {
        x: dayStartMs(date) + hour * 3_600_000,
        y: hour,
        matched: true,
        metadata: {
            track,
            artist: 'Artist',
            playedAt: `${date} ${hh}:${mm}:00`,
            trackUri: null,
        },
    };
}

/** `count` plays spread evenly across the waking hours of `date`. */
function spreadDay(date: string, count: number): ConnectablePoint[] {
    return Array.from({ length: count }, (_, i) =>
        play(date, 8 + (i * 12) / Math.max(1, count - 1), `Track ${i}`)
    );
}

describe('dayKeyOf / clockOf', () => {
    it('reads the day from the stored wall-clock string', () => {
        expect(dayKeyOf(play('2023-03-14', 8.7))).toBe('2023-03-14');
    });

    it('falls back to the timestamp when no playedAt is stored', () => {
        const point: ConnectablePoint = {
            x: dayStartMs('2021-01-02'),
            y: 0,
            matched: true,
            metadata: {},
        };
        expect(dayKeyOf(point)).toBe('2021-01-02');
    });

    it('formats the fractional hour as a clock time', () => {
        expect(clockOf(play('2023-03-14', 8.7))).toBe('08:42');
        expect(clockOf(play('2023-03-14', 0))).toBe('00:00');
    });

    it('names the track, with a fallback', () => {
        expect(trackOf(play('2023-03-14', 9, 'Nightcall'))).toBe('Nightcall');
        expect(trackOf({ x: 0, y: 0, matched: true, metadata: {} })).toBe('an untitled track');
    });
});

describe('pickFocusDay', () => {
    it('returns null without points', () => {
        expect(pickFocusDay([])).toBeNull();
    });

    it('prefers a day spread across the waking hours over a denser burst', () => {
        const burst = Array.from({ length: 60 }, () => play('2023-01-01', 22));
        const spread = spreadDay('2023-02-02', 20);

        const focus = pickFocusDay([...burst, ...spread]);

        expect(focus?.date).toBe('2023-02-02');
        expect(focus?.points).toHaveLength(20);
        expect(focus?.startMs).toBe(dayStartMs('2023-02-02'));
    });

    it('aims high but skips the single busiest day', () => {
        // Ten spread-out days of 10, 20, … 100 plays: the 85th percentile of ten
        // ranked days lands on the ninth, not the tenth.
        const points = Array.from({ length: 10 }, (_, i) =>
            spreadDay(`2023-01-${String(i + 1).padStart(2, '0')}`, (i + 1) * 10)
        ).flat();

        const focus = pickFocusDay(points);

        expect(focus?.date).toBe('2023-01-09');
        expect(focus?.points).toHaveLength(90);
    });

    it('breaks ties towards the most recent day', () => {
        const points = [
            ...spreadDay('2023-01-01', 10),
            ...spreadDay('2023-01-02', 10),
            ...spreadDay('2023-01-03', 10),
        ];

        expect(pickFocusDay(points)?.date).toBe('2023-01-03');
    });

    it('returns the day sorted oldest play first', () => {
        const focus = pickFocusDay([
            play('2023-05-05', 21),
            play('2023-05-05', 9),
            play('2023-05-05', 15),
        ]);

        expect(focus?.points.map((p) => p.y)).toEqual([9, 15, 21]);
    });
});

describe('spanLabel', () => {
    it('reads first to last', () => {
        expect(spanLabel([play('2023-01-01', 8.7), play('2023-01-01', 23.25)])).toBe(
            '08:42 to 23:15'
        );
    });

    it('collapses a single play to one time', () => {
        expect(spanLabel([play('2023-01-01', 8.7)])).toBe('08:42');
    });

    it('returns null for an empty day', () => {
        expect(spanLabel([])).toBeNull();
    });
});

describe('dayStartOf', () => {
    it('strips the time of day so a day plots as one vertical line', () => {
        const midnight = dayStartMs('2023-03-14');
        expect(dayStartOf(play('2023-03-14', 0))).toBe(midnight);
        expect(dayStartOf(play('2023-03-14', 8.7))).toBe(midnight);
        expect(dayStartOf(play('2023-03-14', 23.99))).toBe(midnight);
    });

    it('stays sorted, so the drawn positions can still be bisected', () => {
        const days = ['2023-03-14', '2023-03-15', '2023-04-01'].map((d) => dayStartOf(play(d, 12)));
        expect(days).toEqual([...days].sort((a, b) => a - b));
    });
});
