import { describe, expect, it, vi } from 'vitest';
import { DayLoader } from './dayLoader';

/** A fetch whose reads finish when the test says so. */
function deferredFetch() {
    const pending: { day: string; resolve: (value: string) => void }[] = [];
    const fetch = vi.fn(
        (day: string) =>
            new Promise<string>((resolve) => {
                pending.push({ day, resolve });
            })
    );
    const finish = async (index = 0) => {
        const read = pending.splice(index, 1)[0];
        read.resolve(`timeline of ${read.day}`);
        await Promise.resolve();
        await Promise.resolve();
    };
    return { fetch, pending, finish };
}

describe('DayLoader', () => {
    it('runs one read at a time and skips the days passed over meanwhile', async () => {
        const { fetch, pending, finish } = deferredFetch();
        const ready = vi.fn();
        const loader = new DayLoader(fetch, ready);

        loader.want('2025-03-10');
        loader.want('2025-03-11');
        loader.want('2025-03-12');
        expect(fetch).toHaveBeenCalledTimes(1);

        await finish();
        // The 10th is no longer wanted: kept, not drawn. The 11th is skipped.
        expect(ready).not.toHaveBeenCalled();
        expect(pending.map((p) => p.day)).toEqual(['2025-03-12']);

        await finish();
        expect(ready).toHaveBeenCalledWith('2025-03-12', 'timeline of 2025-03-12');
        expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('answers a day it has seen at once, without reading it again', async () => {
        const { fetch, finish } = deferredFetch();
        const ready = vi.fn();
        const loader = new DayLoader(fetch, ready);

        loader.want('2025-03-10');
        await finish();
        loader.want('2025-03-10');

        expect(fetch).toHaveBeenCalledTimes(1);
        expect(ready).toHaveBeenCalledTimes(2);
    });
});
