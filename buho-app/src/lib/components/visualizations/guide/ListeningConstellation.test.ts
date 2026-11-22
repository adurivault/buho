import { render, screen } from '@testing-library/svelte';
import { describe, it, expect } from 'vitest';
import ListeningConstellation from './ListeningConstellation.svelte';
import type { ConnectablePoint } from '#lib/data/queries/behaviorQueries.ts';
import { dayStartMs, pickFocusDay } from '#lib/visualizations/listeningStory.ts';

function play(date: string, hour: number): ConnectablePoint {
    return {
        x: dayStartMs(date) + hour * 3_600_000,
        y: hour,
        matched: true,
        metadata: {
            track: 'Nightcall',
            artist: 'Kavinsky',
            playedAt: `${date} ${String(hour).padStart(2, '0')}:00:00`,
            trackUri: null,
        },
    };
}

const points = [8, 9, 12, 15, 18, 20, 22].map((hour) => play('2023-03-14', hour));

describe('ListeningConstellation', () => {
    it('draws a canvas for the plays', () => {
        render(ListeningConstellation, {
            props: { points, focus: pickFocusDay(points), stage: 0 },
        });

        expect(screen.getByRole('img', { name: /every play as a square/i })).toBeInTheDocument();
    });

    // jsdom has no 2D context, so every stage must be a no-op rather than a throw.
    it.each([0, 1, 2, 3, 4])('renders stage %i without a canvas context', (stage) => {
        expect(() =>
            render(ListeningConstellation, {
                props: { points, focus: pickFocusDay(points), stage },
            })
        ).not.toThrow();
    });

    it('shows an empty state instead of a canvas with no plays', () => {
        render(ListeningConstellation, { props: { points: [], focus: null, stage: 0 } });

        expect(screen.getByText(/no plays to draw/i)).toBeInTheDocument();
        expect(screen.queryByRole('img')).not.toBeInTheDocument();
    });

    it('survives a missing focus day', () => {
        expect(() =>
            render(ListeningConstellation, { props: { points, focus: null, stage: 2 } })
        ).not.toThrow();
    });
});
