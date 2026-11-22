import { describe, it, expect } from 'vitest';
import {
    MAX_TERMS,
    PointSearch,
    SEARCH_KEY,
    searchQuery,
    withoutTerm,
    termFor,
    toggleTerm,
    isWordless,
    TERM_COLOR_KEY,
    followSearch,
    initialColoring,
    toggleColoring,
    excerpt,
    TextIndex,
    findTerm,
    firstMatch,
    foldText,
    highlight,
    parseSearch,
    searchTest,
    type SearchTerm,
} from './search';

const term = (raw: string): SearchTerm => parseSearch(raw)[0];

/** Whether `raw` finds anything in `text`, the way the Explorer decides it. */
const finds = (raw: string, text: string) => findTerm(foldText(text), term(raw)) !== -1;

describe('foldText', () => {
    it('ignores case and accents', () => {
        expect(foldText('Ça DÉJÀ Noël')).toBe('ca deja noel');
    });

    it('unifies apostrophes and ligatures', () => {
        expect(foldText('T’as vu mon cœur')).toBe("t'as vu mon coeur");
        expect(foldText('Straße')).toBe('strasse');
    });

    it('leaves emoji and punctuation alone', () => {
        expect(foldText('ok 😂 !?')).toBe('ok 😂 !?');
    });
});

describe('parseSearch', () => {
    it('splits on commas, in the order typed', () => {
        expect(parseSearch('haha, lol ,mdr').map((t) => t.label)).toEqual(['haha', 'lol', 'mdr']);
    });

    it('keeps phrases whole and squeezes their spaces', () => {
        expect(parseSearch('  on  se voit ')).toEqual([
            { label: 'on se voit', needle: 'on se voit', whole: false },
        ]);
    });

    it('drops empty terms and duplicates, keeping the first spelling', () => {
        expect(parseSearch(', Café,, cafe, "",').map((t) => t.label)).toEqual(['Café']);
    });

    it('reads a quoted term as a whole word, closed or still being typed', () => {
        expect(parseSearch('"ok"')[0]).toMatchObject({ label: '"ok"', needle: 'ok', whole: true });
        expect(parseSearch('"ok')[0]).toMatchObject({ needle: 'ok', whole: true });
        expect(parseSearch('« bonjour »')[0]).toMatchObject({ needle: 'bonjour', whole: true });
    });

    it('tells a quoted term from the same word unquoted', () => {
        expect(parseSearch('ok, "ok"')).toHaveLength(2);
    });

    it('stops at the cap', () => {
        const raw = Array.from({ length: MAX_TERMS + 3 }, (_, i) => `w${i}`).join(',');
        expect(parseSearch(raw)).toHaveLength(MAX_TERMS);
    });
});

describe('withoutTerm', () => {
    it('drops one term and keeps the others as typed', () => {
        expect(withoutTerm('haha, Café ,mdr', 'Café')).toBe('haha, mdr');
    });

    it('tells a quoted term from the same word unquoted', () => {
        expect(withoutTerm('ok, "ok"', '"ok"')).toBe('ok');
        expect(withoutTerm('ok, "ok"', 'ok')).toBe('"ok"');
    });

    it('empties the query with its last term', () => {
        expect(withoutTerm('lol', 'lol')).toBe('');
    });
});

describe('toggleTerm', () => {
    it('adds a term the query lacks, after the others', () => {
        expect(toggleTerm('', '😂')).toBe('😂');
        expect(toggleTerm('haha ,', '😂')).toBe('haha, 😂');
    });

    it('takes out a term the query has, however it was spelled', () => {
        expect(toggleTerm('haha, 😂', '😂')).toBe('haha');
        // The same heart with and without its emoji presentation selector.
        expect(toggleTerm('❤', '❤️')).toBe('');
    });

    it('leaves the query alone for a text that is no term', () => {
        expect(toggleTerm('haha', ' , ')).toBe('haha');
    });
});

describe('isWordless', () => {
    it('tells an emoji or a bit of punctuation from a word', () => {
        expect(parseSearch('😂, ?!, ok, 2024, a😂').map(isWordless)).toEqual([
            true,
            true,
            false,
            false,
            false,
        ]);
    });
});

describe('termFor', () => {
    it('finds the term that looks for a text', () => {
        const terms = parseSearch('haha, ❤️');
        expect(termFor(terms, '❤')).toBe(1);
        expect(termFor(terms, 'HAHA')).toBe(0);
        expect(termFor(terms, 'lol')).toBe(-1);
    });
});

describe('findTerm', () => {
    it('matches at the start of a word, not inside one', () => {
        expect(finds('restau', 'On va au Restaurant ?')).toBe(true);
        expect(finds('ok', 'this book')).toBe(false);
        expect(finds('ok', "c'est ok!")).toBe(true);
    });

    it('matches across accents and case, both ways', () => {
        expect(finds('deja', 'Déjà vu')).toBe(true);
        expect(finds('déjà', 'deja vu')).toBe(true);
    });

    it('finds a later occurrence when the first is mid-word', () => {
        expect(finds('ok', 'book ok')).toBe(true);
    });

    it('holds a quoted term to the whole word', () => {
        expect(finds('"ok"', 'okay')).toBe(false);
        expect(finds('"ok"', 'ok.')).toBe(true);
        expect(finds('ok', 'okay')).toBe(true);
    });

    it('needs no word boundary around an emoji or punctuation', () => {
        expect(finds('😂', 'mdr😂😂')).toBe(true);
        expect(finds('?!', 'quoi?!')).toBe(true);
    });

    it('matches phrases', () => {
        expect(finds('on se voit', 'Bon, on se voit demain')).toBe(true);
        expect(finds('on se voit', 'bon se voit')).toBe(false);
    });
});

describe('firstMatch', () => {
    it('reports the first term, in query order, that the text holds', () => {
        const terms = parseSearch('lol, haha');
        expect(firstMatch(foldText('haha lol'), terms)).toBe(0);
        expect(firstMatch(foldText('hahaha'), terms)).toBe(1);
        expect(firstMatch(foldText('rien'), terms)).toBe(-1);
    });
});

describe('highlight', () => {
    const join = (segments: { text: string; term: number }[]) =>
        segments.map((s) => (s.term === -1 ? s.text : `[${s.term}:${s.text}]`)).join('');

    it('marks every hit in the original spelling', () => {
        expect(join(highlight('Ça va ? ca va.', parseSearch('ca')))).toBe('[0:Ça] va ? [0:ca] va.');
    });

    it('marks each term with its own index', () => {
        expect(join(highlight('lol haha lol', parseSearch('haha, lol')))).toBe(
            '[1:lol] [0:haha] [1:lol]'
        );
    });

    it('covers a ligature a hit ends halfway through', () => {
        expect(join(highlight('mon cœur', parseSearch('co')))).toBe('mon [0:cœ]ur');
    });

    it('keeps a decomposed accent with its letter', () => {
        const decomposed = 'Café noir';
        expect(join(highlight(decomposed, parseSearch('café')))).toBe('[0:Café] noir');
    });

    it('leaves text without hits in one piece', () => {
        expect(highlight('rien ici', parseSearch('zut'))).toEqual([{ text: 'rien ici', term: -1 }]);
        expect(highlight('', parseSearch('zut'))).toEqual([]);
    });
});

describe('excerpt', () => {
    const text = (segments: { text: string }[]) => segments.map((s) => s.text).join('');

    it('cuts a long lead-in down to the words just before the hit', () => {
        const long = `${'blah '.repeat(30)}and then pizza tonight`;
        const out = excerpt(highlight(long, parseSearch('pizza')), 20);
        expect(text(out)).toBe('…blah blah and then pizza tonight');
        expect(out.find((s) => s.term === 0)?.text).toBe('pizza');
    });

    it('caps the length, on a space where it can', () => {
        const out = excerpt(
            highlight('pizza with far too many words after it', parseSearch('pizza')),
            40,
            20
        );
        expect(text(out)).toBe('pizza with far too…');
    });

    it('leaves a short text as it is', () => {
        const segments = highlight('pizza ce soir ?', parseSearch('pizza'));
        expect(excerpt(segments)).toEqual(segments);
    });
});

describe('TextIndex', () => {
    const points = () =>
        ['Pizza ce soir ?', 'haha', 'une pizzeria', 'LOL', ''].map((text) => ({
            text,
            searchTerm: 'stale',
            searchMask: 0,
        }));

    it('marks each point with its first term and counts the hits per term', () => {
        const pts = points();
        const index = new TextIndex(pts, (p) => p.text);
        const counts = index.mark(parseSearch('pizz, lol'));
        expect(pts.map((p) => p.searchTerm)).toEqual(['pizz', '', 'pizz', 'lol', '']);
        expect(counts).toEqual([2, 1]);
    });

    it('clears every mark when the query empties', () => {
        const pts = points();
        new TextIndex(pts, (p) => p.text).mark([]);
        expect(pts.every((p) => p.searchTerm === '')).toBe(true);
    });

    it('folds in the background before the first search', async () => {
        const pts = points();
        const index = new TextIndex(pts, (p) => p.text);
        expect(index.ready).toBe(false);
        await index.warm();
        expect(index.ready).toBe(true);
    });

    it('gives the cross-filter a test that passes marked points only', () => {
        const pts = points();
        new TextIndex(pts, (p) => p.text).mark(parseSearch('haha'));
        const test = searchTest<(typeof pts)[number]>();
        expect(pts.filter((p) => test.pass(p)).map((p) => p.text)).toEqual(['haha']);
    });
});

describe('term coloring', () => {
    it('takes over an uncolored constellation from the first term', () => {
        const state = followSearch(initialColoring(null), 1);
        expect(state.colorBy).toBe(TERM_COLOR_KEY);
        expect(followSearch(state, 0).colorBy).toBeNull();
    });

    it('leaves a dimension coloring alone for one term, and takes over from two', () => {
        const one = followSearch(initialColoring('service'), 1);
        expect(one.colorBy).toBe('service');
        const two = followSearch(one, 2);
        expect(two.colorBy).toBe(TERM_COLOR_KEY);
        expect(followSearch(two, 0).colorBy).toBe('service');
    });

    it('stays off once turned off, until the search ends', () => {
        let state = followSearch(initialColoring('service'), 2);
        state = toggleColoring(state, TERM_COLOR_KEY);
        expect(state.colorBy).toBe('service');
        expect(followSearch(state, 3).colorBy).toBe('service');
        state = followSearch(state, 0);
        expect(followSearch(state, 2).colorBy).toBe(TERM_COLOR_KEY);
    });

    it('counts picking a dimension mid-search as turning the terms off', () => {
        let state = followSearch(initialColoring(null), 1);
        state = toggleColoring(state, 'year');
        expect(state.colorBy).toBe('year');
        expect(followSearch(state, 2).colorBy).toBe('year');
        expect(followSearch(state, 0).colorBy).toBe('year');
    });

    it('turns term coloring back on from the legend', () => {
        const state = toggleColoring(initialColoring('service'), TERM_COLOR_KEY);
        expect(state.colorBy).toBe(TERM_COLOR_KEY);
        expect(toggleColoring(state, TERM_COLOR_KEY).colorBy).toBe('service');
    });
});

describe('PointSearch', () => {
    const points = () =>
        ['lol', 'haha lol', 'nope'].map((text) => ({ text, searchTerm: '', searchMask: 0 }));

    it('reads the query out of the filters', () => {
        expect(searchQuery({ [SEARCH_KEY]: 'lol' })).toBe('lol');
        expect(searchQuery({ contact: 'Sam' })).toBe('');
    });

    it('marks the points once per query, and offers its test while one is on', () => {
        const pts = points();
        const search = new PointSearch<(typeof pts)[number]>((p) => p.text);
        search.reset(pts);
        expect(search.tests()).toEqual([]);

        search.apply({ [SEARCH_KEY]: 'haha, lol' });
        expect(pts.map((p) => p.searchTerm)).toEqual(['lol', 'haha', '']);
        expect(search.tests()).toHaveLength(1);

        // Same terms, however typed: nothing is re-marked.
        pts[2].searchTerm = 'untouched';
        search.apply({ [SEARCH_KEY]: ' haha ,lol ' });
        expect(pts[2].searchTerm).toBe('untouched');

        search.apply({});
        expect(search.tests()).toEqual([]);
        expect(pts.every((p) => p.searchTerm === '')).toBe(true);
    });

    it('tallies the hits per term, in query order', () => {
        const pts = points();
        const search = new PointSearch<(typeof pts)[number]>((p) => p.text);
        search.reset(pts);
        search.apply({ [SEARCH_KEY]: 'haha, lol' });
        const tally = search.tally();
        pts.forEach(tally.add);
        // "haha lol" counts for both: the color picks one term, the count does not.
        expect(tally.counts).toEqual([1, 2]);
    });
});
