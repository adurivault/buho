/**
 * Text search over an Explorer's in-memory points.
 *
 * Nothing here goes back to DuckDB. The points already carry their text — the
 * message, the search query, the track title — because the tooltips show it, so
 * a search is one more cross-filter: every point is marked with the term it
 * matches, and the constellation, the pies and the rankings narrow to those
 * points like they do for any other dimension.
 *
 * What a search means is deliberately plain, since it has to be predictable to
 * be worth anything:
 *
 * - Case, accents and a few typographic twins are ignored — "ca" finds "Ça",
 *   "coeur" finds "cœur", "t'as" finds "t’as". People type the same word both
 *   ways, often in the same conversation.
 * - A term matches at the start of a word, so "restau" finds "Restaurant" but
 *   "ok" does not find "book". In quotes, only the whole word: `"ok"` skips
 *   "okay".
 * - Commas separate terms, and a point matching any of them is a hit. Each term
 *   keeps its own colour and its own count, which is what makes "haha, lol,
 *   mdr" a comparison and not just a wider net.
 *
 * The query is the user's own words, so it is never reported: the filter store
 * only ever sends dimension keys to analytics, not values.
 */
import type { FilterState } from '#lib/types/filters.ts';
import type { CrossfilterTest } from './crossfilter';

/** The filter-store key a search is kept under, in every Explorer. */
export const SEARCH_KEY = 'search';

/** The colour-by key that paints the constellation by matched term. */
export const TERM_COLOR_KEY = 'search-term';

/** More than this and the legend stops being readable, and so does the chart. */
export const MAX_TERMS = 8;

export interface SearchTerm {
    /** As typed, trimmed and unquoted: what the legend shows. */
    label: string;
    /** The folded form that is looked for. */
    needle: string;
    /** Quoted: only the whole word matches. */
    whole: boolean;
}

/** A point once a search has run over it. */
export interface SearchablePoint {
    /**
     * The label of the first term the point matches, or '' for none.
     *
     * A string rather than an index so it can double as a colour-by field: the
     * constellation paints and stacks by a field's value, and this value is the
     * term's name in the legend.
     */
    searchTerm: string;
    /**
     * Every term the point matches, as bits in query order — a message can hold
     * two of them. The coloring has to pick one, the first; the counts do not,
     * so each term is counted in every message holding it.
     */
    searchMask: number;
}

const MARKS = /\p{M}/gu;
const NON_ASCII = /[\u0080-\uffff]/;
const WORD_CHAR = /[\p{L}\p{N}]/u;
/** Only non-ASCII ones: an ASCII-only text skips folding altogether. */
const APOSTROPHES = /[’‘ʼ]/g;

/**
 * Characters folded by hand, because normalisation leaves them alone: they are
 * letters of their own, not a letter plus a mark. Each is written both ways in
 * the same language often enough that missing one would read as a bug. Final
 * sigma is here because lower-casing produces it: "ΣΟΦΟΣ" must find "σοφοσ".
 *
 * `sql/search.ts` folds the same way in DuckDB; the two lists must agree.
 */
const LIGATURES: Record<string, string> = { œ: 'oe', æ: 'ae', ß: 'ss', ς: 'σ' };
const LIGATURE_RE = /[œæßς]/g;

/**
 * Lower-cased, accents stripped, apostrophes and ligatures unified.
 *
 * Lower-cased first, so the ligatures only have one case to be looked for in.
 * The ASCII test is not a nicety: folding a million messages is most of a
 * second, and the normalisation is nearly all of it — while a large share of
 * messages have nothing to normalise.
 */
export function foldText(text: string): string {
    const lower = text.toLowerCase();
    if (!NON_ASCII.test(lower)) return lower;
    return lower
        .normalize('NFD')
        .replace(MARKS, '')
        .replace(APOSTROPHES, "'")
        .replace(LIGATURE_RE, (c) => LIGATURES[c]);
}

/**
 * The terms in a query, in the order typed.
 *
 * Duplicates collapse onto the first spelling, and a term that folds to nothing
 * (a lone quote, a comma too many) is dropped rather than matching everything.
 */
export function parseSearch(raw: string): SearchTerm[] {
    const terms: SearchTerm[] = [];
    const seen = new Set<string>();
    for (const part of raw.split(',')) {
        let label = part.trim().replace(/\s+/g, ' ');
        let whole = false;
        const quoted = /^["“”«»]\s*(.*?)\s*["“”«»]?$/.exec(label);
        if (quoted) {
            label = quoted[1];
            whole = true;
        }
        const needle = foldText(label);
        if (!needle) continue;
        const key = `${whole ? '"' : ''}${needle}`;
        if (seen.has(key)) continue;
        seen.add(key);
        terms.push({ label: whole ? `"${label}"` : label, needle, whole });
        if (terms.length === MAX_TERMS) break;
    }
    return terms;
}

/**
 * The query without one of its terms, the others left as they were typed.
 *
 * Matched by label, the way the legend names a term — so removing `"ok"` from
 * `ok, "ok"` leaves `ok`.
 */
export function withoutTerm(raw: string, label: string): string {
    return raw
        .split(',')
        .filter((part) => parseSearch(part)[0]?.label !== label)
        .map((part) => part.trim())
        .filter(Boolean)
        .join(', ');
}

/** A term with no letter or digit in it — an emoji, a "?!" — rather than a word. */
export function isWordless(term: SearchTerm): boolean {
    return !WORD_CHAR.test(term.needle);
}

/** Whether two terms look for the same thing, however each was spelled. */
const sameTerm = (a: SearchTerm, b: SearchTerm) => a.needle === b.needle && a.whole === b.whole;

/** The query's term that looks for `text`, if it has one. */
export function termFor(terms: readonly SearchTerm[], text: string): number {
    const [wanted] = parseSearch(text);
    return wanted ? terms.findIndex((term) => sameTerm(term, wanted)) : -1;
}

/**
 * The query with `text` added as a term, or taken out if it already is one —
 * what clicking a value does when the value is a search, like an emoji in the
 * tally. The other terms stay as they were typed.
 */
export function toggleTerm(raw: string, text: string): string {
    const [wanted] = parseSearch(text);
    if (!wanted) return raw;
    const parts = raw
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean);
    const kept = parts.filter((part) => {
        const [term] = parseSearch(part);
        return !(term && sameTerm(term, wanted));
    });
    return (kept.length === parts.length ? [...parts, text.trim()] : kept).join(', ');
}

/** Whether position `at` of `text` holds a letter or a digit. */
function isWordChar(text: string, at: number): boolean {
    return at >= 0 && at < text.length && WORD_CHAR.test(text[at]);
}

/**
 * Where `term` next matches in an already folded text, from `from` on, or -1.
 *
 * The word-boundary rule only applies at an end of the term that is itself a
 * letter or a digit: "😂" or "?!" have no word to start, and requiring one would
 * make them unfindable in "ok😂".
 */
export function findTerm(folded: string, term: SearchTerm, from = 0): number {
    const { needle, whole } = term;
    const checkStart = isWordChar(needle, 0);
    const checkEnd = whole && isWordChar(needle, needle.length - 1);
    let at = folded.indexOf(needle, from);
    while (at !== -1) {
        const startOk = !checkStart || !isWordChar(folded, at - 1);
        const endOk = !checkEnd || !isWordChar(folded, at + needle.length);
        if (startOk && endOk) return at;
        at = folded.indexOf(needle, at + 1);
    }
    return -1;
}

/** Index of the first term an already folded text matches, or -1. */
export function firstMatch(folded: string, terms: readonly SearchTerm[]): number {
    for (let i = 0; i < terms.length; i++) {
        if (findTerm(folded, terms[i]) !== -1) return i;
    }
    return -1;
}

export interface HighlightSegment {
    text: string;
    /** Index of the term this piece matched, or -1 for plain text. */
    term: number;
}

/**
 * A text cut into plain and matched pieces, for drawing the hits.
 *
 * Folding changes lengths ("œ" becomes "oe", a decomposed "é" loses its mark),
 * so the folded text is built here one character at a time alongside a map back
 * to where each folded character came from. Only ever run on what is on screen,
 * so the per-character cost is irrelevant — the bulk matching uses `foldText`.
 */
export function highlight(text: string, terms: readonly SearchTerm[]): HighlightSegment[] {
    if (!text || terms.length === 0) return text ? [{ text, term: -1 }] : [];

    let folded = '';
    /** Where, in `text`, the character that folded[i] came from starts and ends. */
    const originStart: number[] = [];
    const originEnd: number[] = [];
    let offset = 0;
    for (const char of text) {
        const piece = foldText(char);
        folded += piece;
        for (let k = 0; k < piece.length; k++) {
            originStart.push(offset);
            originEnd.push(offset + char.length);
        }
        // A character folding to nothing — a combining accent typed on its own —
        // belongs to the letter before it, and is highlighted with it.
        if (!piece && originEnd.length) originEnd[originEnd.length - 1] = offset + char.length;
        offset += char.length;
    }

    // Every hit of every term, then the earliest-starting wins where two overlap
    // — the same "first term wins" rule as `firstMatch`, applied per stretch.
    const hits: { start: number; end: number; term: number }[] = [];
    terms.forEach((term, index) => {
        let at = findTerm(folded, term);
        while (at !== -1) {
            hits.push({ start: at, end: at + term.needle.length, term: index });
            at = findTerm(folded, term, at + Math.max(1, term.needle.length));
        }
    });
    hits.sort((a, b) => a.start - b.start || a.term - b.term);

    const segments: HighlightSegment[] = [];
    let cursor = 0; // in `text`
    for (const hit of hits) {
        const start = originStart[hit.start];
        // Mapped through the last matched character rather than the one after
        // it, so a hit ending halfway through the "oe" of an "œ" covers the "œ".
        const end = originEnd[hit.end - 1];
        if (start < cursor || end <= start) continue;
        if (start > cursor) segments.push({ text: text.slice(cursor, start), term: -1 });
        segments.push({ text: text.slice(start, end), term: hit.term });
        cursor = end;
    }
    if (cursor < text.length) segments.push({ text: text.slice(cursor), term: -1 });
    return segments;
}

/**
 * The stretch of a long text worth showing in a list of hits.
 *
 * A match halfway down a pasted paragraph is invisible if the row shows the
 * paragraph's opening, so the lead-in before the first hit is cut to its last
 * few words, and the whole is capped. Cuts fall on spaces where there is one
 * close by, and are marked with an ellipsis.
 */
export function excerpt(
    segments: readonly HighlightSegment[],
    lead = 40,
    maxLength = 200
): HighlightSegment[] {
    const out = segments.map((segment) => ({ ...segment }));
    const first = out[0];
    if (first && first.term === -1 && out.length > 1 && first.text.length > lead) {
        let cut = first.text.slice(-lead);
        const space = cut.indexOf(' ');
        if (space !== -1 && space < lead / 2) cut = cut.slice(space + 1);
        first.text = `…${cut}`;
    }

    let length = 0;
    for (let i = 0; i < out.length; i++) {
        const room = maxLength - length;
        if (out[i].text.length > room) {
            let cut = out[i].text.slice(0, Math.max(0, room));
            const space = cut.lastIndexOf(' ');
            if (out[i].term === -1 && space > room / 2) cut = cut.slice(0, space);
            out[i].text = `${cut}…`;
            return out.slice(0, i + 1);
        }
        length += out[i].text.length;
    }
    return out;
}

/** How long one slice of background folding may hold the main thread. */
const FOLD_SLICE_MS = 12;

/**
 * The folded text of every point, built once and searched on every keystroke.
 *
 * Built lazily: most visits never search, and on a large export the folding is
 * the expensive part. `warm()` builds it in slices between frames — the page
 * calls it when the search field takes focus, so the work is usually done
 * before the first key lands — and `mark()` finishes whatever is left
 * synchronously if a search arrives first.
 */
export class TextIndex<P extends SearchablePoint> {
    #points: readonly P[];
    #textOf: (point: P) => string;
    #folded: string[] = [];
    #warming: Promise<void> | null = null;

    constructor(points: readonly P[], textOf: (point: P) => string) {
        this.#points = points;
        this.#textOf = textOf;
    }

    get ready(): boolean {
        return this.#folded.length === this.#points.length;
    }

    #foldNext(until: number) {
        const points = this.#points;
        const folded = this.#folded;
        while (folded.length < points.length) {
            folded.push(foldText(this.#textOf(points[folded.length])));
            if (folded.length % 2048 === 0 && performance.now() > until) return;
        }
    }

    /** Fold in the background. Safe to call repeatedly; resolves once ready. */
    warm(): Promise<void> {
        if (this.ready) return Promise.resolve();
        this.#warming ??= new Promise<void>((resolve) => {
            const step = () => {
                this.#foldNext(performance.now() + FOLD_SLICE_MS);
                if (this.ready) resolve();
                else setTimeout(step, 0);
            };
            step();
        });
        return this.#warming;
    }

    /**
     * Set `searchTerm` and `searchMask` on every point, in place, and count the
     * hits per term.
     *
     * In place for the same reason `markMatched` is: the constellation keeps one
     * array for the page's lifetime and redraws on a version bump.
     */
    mark(terms: readonly SearchTerm[]): number[] {
        this.#foldNext(Infinity);
        const counts = terms.map(() => 0);
        const points = this.#points;
        const folded = this.#folded;
        for (let i = 0; i < points.length; i++) {
            let mask = 0;
            for (let t = 0; t < terms.length; t++) {
                if (findTerm(folded[i], terms[t]) === -1) continue;
                mask |= 1 << t;
                counts[t] += 1;
            }
            points[i].searchMask = mask;
            points[i].searchTerm = mask === 0 ? '' : terms[31 - Math.clz32(mask & -mask)].label;
        }
        return counts;
    }
}

/** The cross-filter test for an active search: a point passes if `mark` found a term in it. */
export function searchTest<P extends SearchablePoint>(): CrossfilterTest<P> {
    return { key: SEARCH_KEY, pass: (point) => point.searchTerm !== '' };
}

/** The query an Explorer's filters hold, or '' when there is none. */
export function searchQuery(filters: FilterState): string {
    const value = filters[SEARCH_KEY];
    return typeof value === 'string' ? value : '';
}

/**
 * One Explorer's search over its points: the index, and which query the points
 * are currently marked for.
 *
 * Plain state on purpose, like the `matched` flags it sits beside: the page
 * re-marks when its filter signature changes and redraws on its version bump,
 * so nothing here needs to be reactive — and a proxy over the index would cost
 * more than the search.
 */
export class PointSearch<P extends SearchablePoint> {
    #textOf: (point: P) => string;
    #index: TextIndex<P> | null = null;
    #markedKey = '[]';
    /** The terms the points are marked with right now. */
    terms: SearchTerm[] = [];

    constructor(textOf: (point: P) => string) {
        this.#textOf = textOf;
    }

    /** Start over on a new set of points, or on none. */
    reset(points: readonly P[] | null) {
        this.#index = points ? new TextIndex(points, this.#textOf) : null;
        this.#markedKey = '[]';
        this.terms = [];
    }

    /** Get the index ready ahead of the first keystroke. */
    warm() {
        void this.#index?.warm();
    }

    /** Re-mark the points if the query in `filters` is not the one they carry. */
    apply(filters: FilterState) {
        const terms = parseSearch(searchQuery(filters));
        const key = JSON.stringify(terms);
        if (key === this.#markedKey || !this.#index) return;
        this.#index.mark(terms);
        this.#markedKey = key;
        this.terms = terms;
    }

    /** The search's cross-filter test while the points are marked for one. */
    tests(): CrossfilterTest<P>[] {
        return this.terms.length ? [searchTest<P>()] : [];
    }

    /**
     * A tally of hits per term, for the legend: `add` each point the selection
     * holds, then read `counts`, in query order. A point holding two terms
     * counts for both.
     */
    tally(): { add: (point: P) => void; counts: number[] } {
        const counts = this.terms.map(() => 0);
        return {
            add: (point) => {
                for (let t = 0; t < counts.length; t++) {
                    if (point.searchMask & (1 << t)) counts[t] += 1;
                }
            },
            counts,
        };
    }
}

/**
 * What paints the constellation, and what a search did to it.
 *
 * A search takes the coloring over — the term colors are what tie a dot to its
 * word in the legend — but only where that costs nothing: when nothing else was
 * coloring it, or from two terms up, when comparing them is the point. Whatever
 * it replaced comes back once the search is cleared, and a reader who turns the
 * term colors off is not overruled by the next term they type.
 */
export interface TermColoring {
    /** The colour-by key in force: a dimension, `TERM_COLOR_KEY`, or null. */
    colorBy: string | null;
    /** What the search took over from, to hand back when it ends. */
    saved: string | null;
    /** The reader turned term coloring off during this search. */
    declined: boolean;
}

export function initialColoring(colorBy: string | null): TermColoring {
    return { colorBy, saved: null, declined: false };
}

/** The coloring once the search holds `terms` terms. */
export function followSearch(state: TermColoring, terms: number): TermColoring {
    if (terms === 0) {
        const colorBy = state.colorBy === TERM_COLOR_KEY ? state.saved : state.colorBy;
        return { colorBy, saved: null, declined: false };
    }
    if (state.declined || state.colorBy === TERM_COLOR_KEY) return state;
    if (state.colorBy !== null && terms < 2) return state;
    return { colorBy: TERM_COLOR_KEY, saved: state.colorBy, declined: false };
}

/** The coloring after the reader toggles `key`, a dimension or the terms. */
export function toggleColoring(state: TermColoring, key: string): TermColoring {
    if (key === TERM_COLOR_KEY) {
        return state.colorBy === TERM_COLOR_KEY
            ? { colorBy: state.saved, saved: null, declined: true }
            : { colorBy: TERM_COLOR_KEY, saved: state.colorBy, declined: false };
    }
    return {
        colorBy: state.colorBy === key ? null : key,
        saved: null,
        declined: state.declined || state.colorBy === TERM_COLOR_KEY,
    };
}
