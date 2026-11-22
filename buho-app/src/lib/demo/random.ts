/**
 * Seeded randomness, and the handful of distributions the demo model needs.
 *
 * Seeded because a demo that differs every reload cannot be reasoned about: a
 * test could assert nothing about it, and "the constellation looked better last
 * time" would be unanswerable. Fix the seed and the end date and the history is
 * identical every run.
 *
 * The distributions are the whole point. Uniform noise is what the previous demo
 * was built from, and it is why it looked dead — real behaviour is heavy-tailed
 * and clustered almost everywhere you look. Sessions are long-tailed, artist
 * popularity is a power law, and nothing at all is uniform across the 24 hours
 * of a day.
 */

/** A pure PRNG: same seed, same sequence, in every browser and in node. */
export function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return function next(): number {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export class Random {
    private next: () => number;

    constructor(seed: number) {
        this.next = mulberry32(seed);
    }

    /** [0, 1) */
    float(): number {
        return this.next();
    }

    /** [min, max) */
    range(min: number, max: number): number {
        return min + this.next() * (max - min);
    }

    /** Integer in [min, max]. */
    int(min: number, max: number): number {
        return Math.floor(this.range(min, max + 1));
    }

    bool(probability: number): boolean {
        return this.next() < probability;
    }

    pick<T>(items: readonly T[]): T {
        return items[this.int(0, items.length - 1)];
    }

    /** Box–Muller. Used for anything that clusters around a typical value. */
    normal(mean = 0, stdDev = 1): number {
        const u = Math.max(this.next(), Number.EPSILON);
        const v = this.next();
        return mean + stdDev * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    }

    /**
     * Long right tail, no negatives — the shape of almost every duration in
     * human behaviour. A listening session is typically twenty minutes and
     * occasionally seven hours, and it is the seven-hour ones that make a
     * constellation look like somebody's life rather than a scatter plot.
     */
    logNormal(median: number, sigma: number): number {
        return median * Math.exp(this.normal(0, sigma));
    }

    /** Index into `weights`, proportional to the weights. */
    weightedIndex(weights: readonly number[]): number {
        let total = 0;
        for (const weight of weights) total += weight;

        let roll = this.next() * total;
        for (let index = 0; index < weights.length; index += 1) {
            roll -= weights[index];
            if (roll <= 0) return index;
        }
        return weights.length - 1;
    }

    /** Fisher–Yates, in place. */
    shuffle<T>(items: T[]): T[] {
        for (let i = items.length - 1; i > 0; i -= 1) {
            const j = this.int(0, i);
            [items[i], items[j]] = [items[j], items[i]];
        }
        return items;
    }
}

/**
 * Zipf weights for `count` ranks: the first item is far ahead of the second,
 * which is far ahead of the third, and the tail is very long.
 *
 * This is how attention actually distributes over artists, contacts and places.
 * The old demo gave its six artists 156, 151, 145, 140, 139 and 138 plays, which
 * is what uniform sampling looks like and is why every ranking chart drawn from
 * it was a flat wall of equal bars.
 */
export function zipfWeights(count: number, exponent = 1): number[] {
    return Array.from({ length: count }, (_, index) => 1 / Math.pow(index + 1, exponent));
}
