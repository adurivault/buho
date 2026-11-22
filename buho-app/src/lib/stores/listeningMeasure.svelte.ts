import { query } from '#lib/data/db/index.ts';
import type { Measure } from '#lib/data/sql/measure.ts';

/**
 * What every listening view counts, for the whole app.
 *
 * Shared between the guide and the Explorer rather than owned by either: they
 * draw the same history from the same table, and a reader who switched the
 * Explorer to plays and then scrolled back through the guide should not find it
 * counting minutes again.
 *
 * The default is not a constant, because it is not always answerable. Minutes
 * are the better reading of a Spotify export — they separate a skip from a full
 * listen, which a count cannot. But a history made only of Last.fm scrobbles
 * carries no duration on any row, so minutes there is not a poorer view of it,
 * it is an empty one. When nothing on the table has a duration the measure is
 * plays and the choice is not offered, since there is nothing to choose between.
 *
 * In memory only, like every other store here: neither the data nor how it is
 * being read is written anywhere.
 */
class ListeningMeasureStore {
    /** Whether any loaded play carries a duration. Probed, never assumed. */
    #hasDurations = $state(true);
    /** The reader's own pick, or null while they have not made one. */
    #picked = $state<Measure | null>(null);

    /** What the charts should count right now. */
    get measure(): Measure {
        // The pick loses to the data: importing a scrobbles export while the
        // Explorer sits on minutes must not leave every panel at zero.
        if (!this.#hasDurations) return 'plays';
        return this.#picked ?? 'minutes';
    }

    /** True when both measures are on the table, so the toggle is worth showing. */
    get selectable(): boolean {
        return this.#hasDurations;
    }

    set(measure: Measure) {
        this.#picked = measure;
    }

    /**
     * Re-read what the table can answer. Called wherever the plays change: an
     * import can bring the durations the last one lacked, and removing a source
     * can take them all away again.
     */
    async refresh(): Promise<void> {
        try {
            const rows = await query<{ n: number }>(
                'SELECT CAST(COUNT(*) AS INTEGER) AS n FROM plays WHERE ms_played IS NOT NULL'
            );
            this.#hasDurations = Number(rows[0]?.n ?? 0) > 0;
        } catch {
            // No plays table at all — nothing is loaded, so there is nothing to
            // say yet and the default stands.
            this.#hasDurations = true;
        }
    }

    reset() {
        this.#hasDurations = true;
        this.#picked = null;
    }
}

export const listeningMeasure = new ListeningMeasureStore();
