/**
 * Finding and counting the emoji in free text.
 *
 * Finding them is a grapheme problem, not a code-point one: 👩‍👩‍👧 is three people
 * joined by zero-width joiners, 👍🏽 is a thumb plus a skin tone, and 🇫🇷 is two
 * regional indicators. Walking code points turns each of those into several
 * wrong emoji, so the text is segmented into grapheme clusters and every
 * cluster kept whole.
 *
 * Extraction and tallying are two functions rather than one because they run at
 * very different rates: segmenting an export costs ~50 ms per 40k messages, so
 * it happens once when the points are built, while the tally reruns on every
 * brush frame over whatever the filters currently select.
 */

/** What makes a cluster an emoji rather than a letter. */
const PICTOGRAPHIC = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u;

/**
 * U+FE0F only asks for the colourful rendering of a character that has a text
 * one too. "❤️" and "❤" are the same emoji typed by two keyboards, so it is
 * dropped from the tally key — the first spelling seen is what gets displayed.
 */
const VARIATION_SELECTOR = /\uFE0F/g;

// Available everywhere the app runs; the fallback below is for the odd
// environment (an old test runner) rather than for a browser we support, and
// splits ZWJ sequences into their parts instead of crashing.
const segmenter =
    typeof Intl !== 'undefined' && 'Segmenter' in Intl
        ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
        : null;

/** Shared, so a message without emoji costs no allocation at all. */
const NONE: readonly string[] = Object.freeze([]);

export interface EmojiCount {
    emoji: string;
    count: number;
}

/** Every emoji in `text`, in the order typed, one entry per occurrence. */
export function emojiClusters(text: string): readonly string[] {
    // Most messages carry no emoji, and segmenting them is the expensive part:
    // the regex rejects them without walking anything.
    if (!text || !PICTOGRAPHIC.test(text)) return NONE;

    const found: string[] = [];
    const parts = segmenter ? segmenter.segment(text) : null;
    if (parts) {
        for (const { segment } of parts) {
            if (PICTOGRAPHIC.test(segment)) found.push(segment);
        }
    } else {
        for (const codePoint of text) {
            if (PICTOGRAPHIC.test(codePoint)) found.push(codePoint);
        }
    }
    return found.length ? found : NONE;
}

/**
 * The most used emoji among `clusters`, most frequent first.
 *
 * Ties break alphabetically so the row is stable between two renders of the
 * same selection rather than reshuffling whenever the map is rebuilt.
 */
export function tallyEmojis(clusters: Iterable<string>, limit = 10): EmojiCount[] {
    const counts = new Map<string, EmojiCount>();

    for (const cluster of clusters) {
        const key = cluster.replace(VARIATION_SELECTOR, '');
        const seen = counts.get(key);
        if (seen) seen.count += 1;
        else counts.set(key, { emoji: cluster, count: 1 });
    }

    return [...counts.values()]
        .sort((a, b) => b.count - a.count || a.emoji.localeCompare(b.emoji))
        .slice(0, Math.max(0, limit));
}
