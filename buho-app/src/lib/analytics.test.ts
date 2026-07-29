import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
    bucket,
    smallBucket,
    durationBucket,
    failureReason,
    filterCombo,
    pageContext,
    trackEvent,
    trackOnce,
    trackThrottled,
    trackControl
} from './analytics';

function useTracker() {
    const track = vi.fn();
    (window as unknown as { umami?: unknown }).umami = { track };
    return track;
}

function setPath(pathname: string) {
    window.history.replaceState({}, '', pathname);
}

describe('analytics buckets', () => {
    it('never reports an exact count', () => {
        expect(bucket(0)).toBe('0');
        expect(bucket(999)).toBe('<1k');
        expect(bucket(42_000)).toBe('10k-50k');
        expect(bucket(1_000_000)).toBe('>100k');
    });

    it('keeps small counts readable but coarse past 3', () => {
        expect(smallBucket(2)).toBe('2');
        expect(smallBucket(7)).toBe('4-10');
        expect(smallBucket(99)).toBe('>10');
    });

    it('buckets durations', () => {
        expect(durationBucket(300)).toBe('<1s');
        expect(durationBucket(9_000)).toBe('5-15s');
        expect(durationBucket(120_000)).toBe('>60s');
    });
});

describe('failureReason', () => {
    const CODES = [
        'empty-selection',
        'no-valid-data',
        'invalid-json',
        'zip-error',
        'db-error',
        'out-of-memory',
        'unknown'
    ];

    it('classifies import failures into a closed set', () => {
        expect(failureReason(new Error('Invalid JSON format'))).toBe('invalid-json');
        expect(failureReason(new Error('No valid Spotify history found'))).toBe('no-valid-data');
        expect(failureReason(new RangeError('too big'))).toBe('out-of-memory');
        expect(failureReason(null)).toBe('unknown');
    });

    it('never echoes the message, which can carry the user data', () => {
        const leaky = new Error('Failed to parse /Users/jane/Takeout/Streaming_History_2019.json');
        expect(CODES).toContain(failureReason(leaky));
        expect(failureReason(leaky)).not.toContain('jane');
    });
});

describe('filterCombo', () => {
    it('is order-independent so the same combination groups together', () => {
        expect(filterCombo(['year', 'artist'])).toBe('artist+year');
        expect(filterCombo(['artist', 'year'])).toBe('artist+year');
    });

    it('reports "none" for an empty selection', () => {
        expect(filterCombo([])).toBe('none');
    });
});

describe('pageContext', () => {
    it('derives source and mode from the route', () => {
        setPath('/spotify/explore');
        expect(pageContext()).toEqual({ source: 'spotify', mode: 'explore' });

        setPath('/google-maps/guide');
        expect(pageContext()).toEqual({ source: 'google-maps', mode: 'guide' });

        setPath('/');
        expect(pageContext()).toEqual({ source: 'home', mode: 'home' });
    });
});

describe('event emission', () => {
    beforeEach(() => {
        setPath('/google-maps/explore');
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
        delete (window as unknown as { umami?: unknown }).umami;
    });

    it('attaches the page context to every event', () => {
        const track = useTracker();
        trackEvent('filter-clear', { origin: 'pie' });
        expect(track).toHaveBeenCalledWith('filter-clear', {
            source: 'google-maps',
            mode: 'explore',
            origin: 'pie'
        });
    });

    it('is a no-op when the tracker is absent', () => {
        delete (window as unknown as { umami?: unknown }).umami;
        expect(() => trackEvent('filter-set', { dimension: 'year' })).not.toThrow();
    });

    it('never lets a tracker failure reach app code', () => {
        (window as unknown as { umami?: unknown }).umami = {
            track: () => {
                throw new Error('blocked');
            }
        };
        expect(() => trackEvent('filter-set', { dimension: 'year' })).not.toThrow();
    });

    it('collapses repeated continuous interactions into one event', () => {
        const track = useTracker();
        for (let i = 0; i < 20; i++) trackThrottled('filter-set', 'year', { dimension: 'year' });
        expect(track).toHaveBeenCalledTimes(1);

        vi.advanceTimersByTime(4000);
        trackThrottled('filter-set', 'year', { dimension: 'year' });
        expect(track).toHaveBeenCalledTimes(2);
    });

    it('throttles chart controls per (viz, control)', () => {
        const track = useTracker();
        trackControl('day-race-map', 'color-mode', 'doy');
        trackControl('day-race-map', 'color-mode', 'date');
        trackControl('day-race-map', 'speed', 4);
        expect(track).toHaveBeenCalledTimes(2);
    });

    it('pre-composes viz × control so a single-property breakdown reads it', () => {
        const track = useTracker();
        trackControl('constellation', 'reset-view', true);
        expect(track.mock.calls[0][1]).toMatchObject({
            viz: 'constellation',
            control: 'reset-view',
            vizControl: 'constellation@reset-view',
            value: true
        });
    });

    it('reports a reached section only once per page load', () => {
        const track = useTracker();
        trackOnce('section-view', 'maps-speed', { section: 'maps-speed' });
        trackOnce('section-view', 'maps-speed', { section: 'maps-speed' });
        expect(track).toHaveBeenCalledTimes(1);
    });
});
