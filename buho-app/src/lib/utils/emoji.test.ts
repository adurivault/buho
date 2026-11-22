import { describe, expect, it } from 'vitest';
import { emojiClusters, tallyEmojis } from './emoji';

/** The pair as the app uses it: extract per message, tally over a selection. */
const topEmojis = (texts: string[], limit?: number) =>
    tallyEmojis(
        texts.flatMap((text) => [...emojiClusters(text)]),
        limit
    );

describe('emojiClusters', () => {
    it('keeps a joined family, a skin tone and a flag whole', () => {
        expect(emojiClusters('👩‍👩‍👧 et 👍🏽 en 🇫🇷')).toEqual(['👩‍👩‍👧', '👍🏽', '🇫🇷']);
    });

    it('returns nothing for text without emoji', () => {
        expect(emojiClusters('bonjour, ça va ? 12 + 3 = 15')).toEqual([]);
        expect(emojiClusters('')).toEqual([]);
    });

    it('keeps every occurrence, in the order typed', () => {
        expect(emojiClusters('😂 haha 😂')).toEqual(['😂', '😂']);
    });
});

describe('tallyEmojis', () => {
    it('ranks by how often each one is typed', () => {
        const top = topEmojis(['😂 haha 😂', 'ok 👍', 'lol 😂']);
        expect(top).toEqual([
            { emoji: '😂', count: 3 },
            { emoji: '👍', count: 1 },
        ]);
    });

    it('keeps a joined family and a skin tone as one emoji each', () => {
        const top = topEmojis(['👩‍👩‍👧 nous', '👍🏽']);
        expect(top.map((e) => e.emoji)).toEqual(['👍🏽', '👩‍👩‍👧']);
        expect(top.every((e) => e.count === 1)).toBe(true);
    });

    it('counts a flag once rather than as two letters', () => {
        expect(topEmojis(['on rentre 🇫🇷'])).toEqual([{ emoji: '🇫🇷', count: 1 }]);
    });

    it('tallies the two spellings of a heart together', () => {
        const top = topEmojis(['❤️', '❤', '❤️']);
        expect(top).toHaveLength(1);
        expect(top[0].count).toBe(3);
    });

    it('ignores text, numbers and punctuation', () => {
        expect(topEmojis(['bonjour, ça va ? 12 + 3 = 15', ''])).toEqual([]);
    });

    it('cuts the list at the limit', () => {
        const top = topEmojis(['😀😁😂🤣😃😄😅😆😉😊😋'], 3);
        expect(top).toHaveLength(3);
    });
});
