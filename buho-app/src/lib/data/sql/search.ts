/**
 * The Explorer search, as a SQL predicate.
 *
 * Most views narrow to a search in JavaScript, over points that already carry
 * their text (see `explorer/search.ts`). The listening Explorer also asks DuckDB
 * for its sunburst and its totals, and those have to narrow to exactly the same
 * plays — so the rules are restated here, and a headless test holds the two
 * sides to each other:
 *
 * - folded the same way: lower-cased, accents stripped, then the ligatures and
 *   curly apostrophes normalisation leaves alone, by hand;
 * - matched the same way: at the start of a word, or as a whole word when the
 *   term was quoted, with no boundary asked of an end that is not a letter or a
 *   digit.
 *
 * Kept free of imports, like `measure.ts` and `trackKey.ts`: the query layer
 * builds the SQL and the Explorer parses the query, and neither should have to
 * depend on the other.
 */

/** What of a parsed term the SQL needs. */
export interface SqlSearchTerm {
    needle: string;
    whole: boolean;
}

/** Anything but a letter or a digit, in RE2's syntax — and a letter or digit in JavaScript's. */
const NOT_WORD_CLASS = '[^\\p{L}\\p{N}]';
const WORD_CHAR = /[\p{L}\p{N}]/u;

/** Mirrors `LIGATURES` and `APOSTROPHES` in `explorer/search.ts`. */
const REPLACEMENTS: [string, string][] = [
    ['œ', 'oe'],
    ['æ', 'ae'],
    ['ß', 'ss'],
    ['ς', 'σ'],
    ['’', "'"],
    ['‘', "'"],
    ['ʼ', "'"],
];

const sqlString = (value: string) => `'${value.replace(/'/g, "''")}'`;

/** `expr`, folded the way `foldText` folds a string. */
export function foldedSql(expr: string): string {
    let sql = `strip_accents(lower(${expr}))`;
    for (const [from, to] of REPLACEMENTS)
        sql = `replace(${sql}, ${sqlString(from)}, ${sqlString(to)})`;
    return sql;
}

/** Everything RE2 would read as syntax, escaped to stand for itself. */
function escapeRegex(text: string): string {
    return text.replace(/[\\.+*?()|[\]{}^$]/g, '\\$&');
}

/** One term as an RE2 pattern over folded text. */
export function termPattern({ needle, whole }: SqlSearchTerm): string {
    const start = WORD_CHAR.test(needle[0] ?? '') ? `(?:^|${NOT_WORD_CLASS})` : '';
    const end = whole && WORD_CHAR.test(needle.at(-1) ?? '') ? `(?:$|${NOT_WORD_CLASS})` : '';
    return `${start}${escapeRegex(needle)}${end}`;
}

/**
 * TRUE for rows whose `textExpr` holds any of the terms, or null when there is
 * nothing to look for — a search that folds to nothing filters nothing.
 */
export function searchSql(terms: readonly SqlSearchTerm[], textExpr: string): string | null {
    const patterns = terms.filter((term) => term.needle).map(termPattern);
    if (patterns.length === 0) return null;
    const pattern = patterns.map((p) => `(?:${p})`).join('|');
    return `COALESCE(regexp_matches(${foldedSql(textExpr)}, ${sqlString(pattern)}), FALSE)`;
}
