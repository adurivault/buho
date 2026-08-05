export interface DailyStreak {
    /** Number of consecutive days in the longest run (0 when there are none). */
    length: number;
    /** First day of that run, 'YYYY-MM-DD', or null. */
    start: string | null;
    /** Last day of that run, 'YYYY-MM-DD', or null. */
    end: string | null;
}

const MS_PER_DAY = 86_400_000;

/**
 * Longest run of consecutive calendar days present in `dates` ('YYYY-MM-DD').
 * Order and duplicates don't matter. Days are compared as UTC midnights, so a
 * DST transition can't turn a run of consecutive days into a gap.
 */
export function longestDailyStreak(dates: string[]): DailyStreak {
    const unique = Array.from(new Set(dates.filter(Boolean))).sort();
    if (unique.length === 0) return { length: 0, start: null, end: null };

    let best = { length: 1, start: unique[0], end: unique[0] };
    let runStart = unique[0];
    let runLength = 1;

    for (let i = 1; i < unique.length; i++) {
        const previous = Date.parse(`${unique[i - 1]}T00:00:00Z`);
        const current = Date.parse(`${unique[i]}T00:00:00Z`);
        if (current - previous === MS_PER_DAY) {
            runLength += 1;
        } else {
            runStart = unique[i];
            runLength = 1;
        }
        if (runLength > best.length) {
            best = { length: runLength, start: runStart, end: unique[i] };
        }
    }

    return best;
}
