/**
 * Loads days one at a time for the hover preview, always the latest asked for
 * next, and remembers every one it loaded.
 *
 * Sweeping the pointer across the year asks for a new day every few
 * milliseconds. Fetching each would queue dozens of reads behind one another
 * and draw them in turn, long after the pointer moved on; this runs one read
 * at a time, skips the days passed over while it ran, and hands back only the
 * day still wanted. A day seen once comes back at once.
 *
 * Pure (no DB, no DOM): the fetch is passed in. One loader belongs to one
 * state of the data — make a new one when the data changes.
 */
export class DayLoader<T> {
    private readonly cache = new Map<string, T>();
    private wanted: string | null = null;
    private running = false;

    constructor(
        private readonly fetch: (day: string) => Promise<T>,
        private readonly onReady: (day: string, value: T) => void
    ) {}

    /** Ask for `day`: answered at once if it was loaded before, after the current read otherwise. */
    want(day: string): void {
        this.wanted = day;
        const known = this.cache.get(day);
        if (known !== undefined) {
            this.onReady(day, known);
            return;
        }
        if (!this.running) void this.run();
    }

    private async run(): Promise<void> {
        this.running = true;
        try {
            while (this.wanted !== null && !this.cache.has(this.wanted)) {
                const day = this.wanted;
                const value = await this.fetch(day);
                this.cache.set(day, value);
                if (this.wanted === day) this.onReady(day, value);
            }
        } finally {
            this.running = false;
        }
    }
}
