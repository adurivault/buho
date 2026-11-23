import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
    bucket,
    smallBucket,
    fileBucket,
    durationBucket,
    failureReason,
    filterCombo,
    pageContext,
    trackEvent,
    trackOnce,
    trackThrottled,
    trackControl,
    initErrorTracking,
} from './analytics';
import { ImportError, IMPORT_FAILURES } from '#lib/data/import/errors.ts';
import { DATA_MODULES } from '#lib/data/modules.ts';

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
    });

    it('keeps telling imports apart past 100k, where the real ones are', () => {
        expect(bucket(180_000)).toBe('100k-250k');
        expect(bucket(400_000)).toBe('250k-500k');
        expect(bucket(1_000_000)).toBe('1M-5M');
        expect(bucket(9_000_000)).toBe('>5M');
    });

    it('keeps small counts readable but coarse past 3', () => {
        expect(smallBucket(2)).toBe('2');
        expect(smallBucket(7)).toBe('4-10');
        expect(smallBucket(99)).toBe('>10');
    });

    it('separates a loose file from a whole unpacked archive', () => {
        expect(fileBucket(1)).toBe('1');
        expect(fileBucket(40)).toBe('11-100');
        expect(fileBucket(4_000)).toBe('1k-10k');
        expect(fileBucket(80_000)).toBe('>10k');
    });

    it('buckets durations, and keeps the slow tail legible', () => {
        expect(durationBucket(300)).toBe('<1s');
        expect(durationBucket(9_000)).toBe('5-15s');
        expect(durationBucket(120_000)).toBe('1-3m');
        expect(durationBucket(900_000)).toBe('>10m');
    });
});

describe('failureReason', () => {
    it('takes the code from a failure Buho raised itself', () => {
        // The message is what the user reads; classifying by sniffing it is how
        // "…split across several zips…" used to be filed as a zip failure.
        expect(
            failureReason(
                new ImportError(
                    'empty-selection',
                    'No readable file in what you selected. Big exports are split across several zips.'
                )
            )
        ).toBe('empty-selection');
        expect(
            failureReason(new ImportError('unrecognised', 'Nothing Buho reads in 12 files.'))
        ).toBe('unrecognised');
    });

    it('reads the code structurally, so a worker boundary does not lose it', () => {
        expect(failureReason({ code: 'zip-too-large', message: 'nope' })).toBe('zip-too-large');
        // Anything else carrying a `code` is not one of ours.
        expect(failureReason({ code: 'ENOENT' })).toBe('unknown');
    });

    it('still classifies errors that carry no code of their own', () => {
        expect(failureReason(new Error('Invalid JSON format'))).toBe('invalid-json');
        expect(failureReason(new RangeError('too big'))).toBe('out-of-memory');
        expect(failureReason(new Error('DuckDB: table plays does not exist'))).toBe('db-error');
        expect(failureReason(null)).toBe('unknown');
    });

    it('never echoes the message, which can carry the user data', () => {
        const leaky = new Error('Failed to parse /Users/jane/Takeout/Streaming_History_2019.json');
        expect(IMPORT_FAILURES).toContain(failureReason(leaky));
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
    it('derives the page and the mode from the route', () => {
        setPath('/listening/explore');
        expect(pageContext()).toEqual({ page: 'listening', mode: 'explore' });

        setPath('/positions/guide');
        expect(pageContext()).toEqual({ page: 'positions', mode: 'guide' });

        setPath('/');
        expect(pageContext()).toEqual({ page: 'home', mode: 'home' });
    });

    it('names every module, not the three the list started with', () => {
        // A drop made from /steps used to report "none", which is what made the
        // Garmin and Google Activity imports unattributable.
        for (const module of DATA_MODULES) {
            setPath(`${module.section}/explore`);
            expect(pageContext().page).toBe(module.id);
        }
    });

    it('keeps a deeper route inside its section', () => {
        setPath('/sources/lastfm');
        expect(pageContext()).toEqual({ page: 'sources', mode: 'none' });
    });
});

describe('event emission', () => {
    beforeEach(() => {
        setPath('/positions/explore');
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
            page: 'positions',
            mode: 'explore',
            origin: 'pie',
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
            },
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
            value: true,
        });
    });

    it('reports a reached section only once per page load', () => {
        const track = useTracker();
        trackOnce('section-view', 'maps-speed', { section: 'maps-speed' });
        trackOnce('section-view', 'maps-speed', { section: 'maps-speed' });
        expect(track).toHaveBeenCalledTimes(1);
    });
});

/**
 * The two errors that reach `window.onerror` look nothing alike once you have
 * the browser's own tell, and used to be reported as though they did.
 */
describe('error tracking', () => {
    /** What the browser hands over when the throwing script is another origin's. */
    const crossOrigin = () =>
        new ErrorEvent('error', { message: 'Script error.', filename: '', lineno: 0, colno: 0 });

    /** What it hands over for a throw in our own bundle. */
    const ourOwn = () =>
        new ErrorEvent('error', {
            message: 'Uncaught RangeError: nope',
            filename: 'https://buho-app.com/_app/immutable/chunks/app.DEADBEEF.js',
            lineno: 12,
            colno: 34,
            error: new RangeError('nope'),
        });

    // `trackThrottled` keeps a module-level window of what it last sent, so
    // each case has to sit outside the previous one's — otherwise a test that
    // asserts "the message never appears" passes because nothing was sent at
    // all. The clock is moved on rather than the map reset, which is not
    // reachable from here.
    let clock = Date.UTC(2026, 0, 1);
    beforeEach(() => {
        setPath('/positions/explore');
        vi.useFakeTimers();
        clock += 60_000;
        vi.setSystemTime(clock);
    });
    afterEach(() => vi.useRealTimers());

    it('keeps a third party throwing out of the crash count', () => {
        const track = useTracker();
        initErrorTracking();
        window.dispatchEvent(crossOrigin());

        expect(track).toHaveBeenCalledTimes(1);
        expect(track.mock.calls[0][0]).toBe('third-party-error');
    });

    it('reports our own errors with a name, a chunk and a position', () => {
        const track = useTracker();
        initErrorTracking();
        window.dispatchEvent(ourOwn());

        expect(track).toHaveBeenCalledWith(
            'js-error',
            expect.objectContaining({
                kind: 'error',
                name: 'RangeError',
                file: 'app.DEADBEEF.js',
                at: '12:34',
            })
        );
    });

    it('reports an uncaught rejection as a crash of its own kind, without its message', () => {
        const track = useTracker();
        initErrorTracking();
        window.dispatchEvent(
            Object.assign(new Event('unhandledrejection'), { reason: new TypeError('secret') })
        );

        expect(track).toHaveBeenCalledWith(
            'js-error',
            expect.objectContaining({ kind: 'rejection', name: 'TypeError' })
        );
        expect(JSON.stringify(track.mock.calls)).not.toContain('secret');
    });

    it('never sends the message, which could hold user data', () => {
        const track = useTracker();
        initErrorTracking();
        window.dispatchEvent(ourOwn());

        expect(track).toHaveBeenCalled();
        expect(JSON.stringify(track.mock.calls)).not.toContain('nope');
    });
});
