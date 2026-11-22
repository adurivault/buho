// @vitest-environment node
//
// The search's two implementations, held to each other on the real engine.
//
// The listening Explorer narrows its constellation in JavaScript and its
// sunburst and totals in DuckDB. If the two disagreed on a single accent the
// sunburst would count plays the constellation does not light up, and nothing
// on screen would say which of them was wrong — so every case below is run
// through both and has to come out the same.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
    openHeadlessDuckDB,
    type HeadlessConnection,
    type HeadlessDuckDB,
} from '../db/headless.testutil';
import { firstMatch, foldText, parseSearch } from '#lib/explorer/search.ts';
import { foldedSql, searchSql } from './search';

let db: HeadlessDuckDB;
let conn: HeadlessConnection;

beforeAll(async () => {
    ({ db, conn } = await openHeadlessDuckDB());
});

afterAll(() => {
    conn?.close();
    db?.terminate?.();
});

const literal = (text: string) => `'${text.replace(/'/g, "''")}'`;

/**
 * Whether each of {@link TEXTS} matches `query`, in one statement.
 *
 * One round trip per query rather than per pair: the pairwise version ran 550
 * statements in a single test and ran past the timeout whenever the rest of the
 * suite was loading the machine.
 */
function sqlMatchesAll(query: string): boolean[] {
    const predicate = searchSql(parseSearch(query), 'txt');
    if (!predicate) throw new Error(`"${query}" parsed to nothing`);
    const rows = TEXTS.map((text, index) => `(${index}, ${literal(text)})`).join(', ');
    return conn
        .query(`SELECT ${predicate} AS hit FROM (VALUES ${rows}) AS t(i, txt) ORDER BY i`)
        .toArray()
        .map((row) => Boolean(row.toJSON().hit));
}

const jsMatches = (query: string, text: string) =>
    firstMatch(foldText(text), parseSearch(query)) !== -1;

const TEXTS = [
    'On va au Restaurant ?',
    'this book',
    "c'est ok!",
    'okay then',
    'Déjà vu',
    'deja vu',
    'ÇA VA',
    'mon cœur',
    'MON CŒUR',
    'Straße',
    'ΣΟΦΟΣ',
    't’as vu',
    "t'as vu",
    'mdr😂😂',
    'quoi?!',
    'Bon, on se voit demain',
    'a.b (c) [d] {e} *f* +g+ ^h$ |i|',
    'Blue (Da Ba Dee) - Radio Edit',
    'naïve café',
    '',
];

const QUERIES = [
    'restau',
    'ok',
    '"ok"',
    'deja',
    'déjà',
    'ca',
    'coeur',
    'cœur',
    'strasse',
    'σοφοσ',
    "t'as",
    't’as',
    '😂',
    '?!',
    'on se voit',
    '(c)',
    '*f*',
    '^h$',
    '|i|',
    'da ba',
    'radio edit',
    '"edit"',
    'naive, cafe',
];

describe('searchSql', () => {
    it('folds a column the way foldText folds a string', () => {
        for (const text of TEXTS) {
            const [row] = conn
                .query(`SELECT ${foldedSql('txt')} AS f FROM (SELECT ${literal(text)} AS txt)`)
                .toArray();
            expect(row.toJSON().f, text).toBe(foldText(text));
        }
    });

    it('agrees with the JavaScript matcher on every case', () => {
        for (const query of QUERIES) {
            const hits = sqlMatchesAll(query);
            TEXTS.forEach((text, index) => {
                expect(hits[index], `${query} in ${JSON.stringify(text)}`).toBe(
                    jsMatches(query, text)
                );
            });
        }
    });

    it('treats a NULL text as no match rather than as NULL', () => {
        const predicate = searchSql(parseSearch('ok'), 'txt');
        const [row] = conn
            .query(`SELECT ${predicate} AS hit FROM (SELECT NULL::VARCHAR AS txt)`)
            .toArray();
        expect(row.toJSON().hit).toBe(false);
    });

    it('filters nothing for a query with no terms', () => {
        expect(searchSql(parseSearch(' , "" '), 'txt')).toBeNull();
    });
});
