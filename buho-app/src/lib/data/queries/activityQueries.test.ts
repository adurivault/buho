import { describe, it, expect } from 'vitest';
import { queryFirstWord, serviceLabel } from './activityQueries';

describe('queryFirstWord', () => {
    it('groups a multi-word query by its first word', () => {
        expect(queryFirstWord('searched', 'python pandas groupby')).toBe('python');
    });

    /**
     * On a one-word query the first word IS the query, so emitting it would put
     * the same text on two consecutive rings. Empty means the level is skipped.
     */
    it('says nothing for a one-word query', () => {
        expect(queryFirstWord('searched', 'duckdb')).toBe('');
        expect(queryFirstWord('searched', '   ')).toBe('');
    });

    it('only applies to searches', () => {
        expect(queryFirstWord('watched', 'some video title')).toBe('');
        expect(queryFirstWord('directions', 'Auray, Pl. Raoul Dautry')).toBe('');
    });

    /**
     * Without this, articles are among the very biggest buckets — "la", "le" and
     * "the" group thousands of unrelated searches and say nothing about any.
     */
    it('skips a leading article to reach a word that groups something', () => {
        expect(queryFirstWord('searched', 'la meteo demain')).toBe('meteo');
        expect(queryFirstWord('searched', 'the best keyboard')).toBe('best');
        expect(queryFirstWord('searched', 'how to center a div')).toBe('to');
    });

    it('falls back to the first word when every word is a stopword', () => {
        expect(queryFirstWord('searched', 'the a an')).toBe('the');
    });

    it('normalizes case and surrounding punctuation', () => {
        expect(queryFirstWord('searched', '"Python" tutorial')).toBe('python');
        expect(queryFirstWord('searched', 'GARE Nantes')).toBe('gare');
    });

    it('keeps accents rather than guessing at a fold', () => {
        // "météo" and "meteo" stay apart: folding them is a judgement call about
        // the user's language, not a normalization.
        expect(queryFirstWord('searched', 'météo paris')).toBe('météo');
    });
});

describe('serviceLabel', () => {
    it('names the services it knows and title-cases the rest', () => {
        expect(serviceLabel('youtube')).toBe('YouTube');
        expect(serviceLabel('image-search')).toBe('Image search');
        expect(serviceLabel('some-new-thing')).toBe('Some new thing');
    });
});
