import { describe, expect, test } from 'vitest';
import { CATALOG_SOURCES, modulesFilledBy, sourcesFilling } from './catalog';
import { DATA_MODULES, type ModuleId } from '../modules';
import { SOURCE_PARSERS } from './registry';
import { SOURCE_STORAGE } from './storage';

/**
 * The catalog is prose about the parsers, and prose rots. These checks are what
 * makes the /sources page trustworthy: a parser added, renamed or removed
 * without a matching row here fails the suite instead of quietly leaving the
 * page describing an app that no longer exists.
 */
describe('source catalog', () => {
    const parserIds = new Set(SOURCE_PARSERS.map((parser) => parser.id));

    test('every parser a row claims is actually registered', () => {
        for (const source of CATALOG_SOURCES) {
            for (const id of source.parserIds) {
                expect(parserIds, `${source.label} names an unknown parser`).toContain(id);
            }
        }
    });

    test('every registered parser is described by some row', () => {
        const claimed = new Set(CATALOG_SOURCES.flatMap((source) => source.parserIds));
        for (const parser of SOURCE_PARSERS) {
            expect(claimed, `parser "${parser.id}" is missing from the catalog`).toContain(
                parser.id
            );
        }
    });

    test('every source is routed by at least one registered parser', () => {
        // No exceptions left: Spotify was the last source read outside the
        // registry, and moving it in is what let Deezer share its table.
        for (const source of CATALOG_SOURCES) {
            expect(source.parserIds.length, `${source.label} has no parser`).toBeGreaterThan(0);
        }
    });

    test('every source fills at least one module, and only known ones', () => {
        const moduleIds = new Set<string>(DATA_MODULES.map((module) => module.id));
        for (const source of CATALOG_SOURCES) {
            const filled = Object.keys(source.fills);
            expect(filled.length, `${source.label} fills nothing`).toBeGreaterThan(0);
            for (const id of filled) {
                expect(moduleIds, `${source.label} fills unknown module "${id}"`).toContain(id);
            }
        }
    });

    test('every module is fed by at least one source', () => {
        for (const module of DATA_MODULES) {
            const feeders = CATALOG_SOURCES.filter((source) => source.fills[module.id]);
            expect(feeders.length, `nothing fills "${module.id}"`).toBeGreaterThan(0);
        }
    });

    test('every meta description fits a search result and names its source', () => {
        for (const source of CATALOG_SOURCES) {
            const text = source.metaDescription;
            expect(text.length, `${source.label}'s description is cut off`).toBeLessThanOrEqual(
                160
            );
            // Reaches the page as an attribute and llms.txt as prose: no markup.
            expect(text, `${source.label}'s description carries markup`).not.toMatch(/[<>&]/);
            // The label's first word, so "Garmin Connect" passes on "Garmin".
            expect(text, `${source.label}'s description never names it`).toContain(
                source.label.split(' ')[0]
            );
        }
    });

    test('ids are unique on both axes', () => {
        expect(new Set(CATALOG_SOURCES.map((s) => s.id)).size).toBe(CATALOG_SOURCES.length);
        expect(new Set(DATA_MODULES.map((m) => m.id)).size).toBe(DATA_MODULES.length);
    });

    /**
     * The one import dialog renders whichever guide you ask for, so a source
     * without one is a tab that opens onto nothing.
     */
    test('every source explains how to get its export', () => {
        for (const source of CATALOG_SOURCES) {
            const { guide } = source;
            expect(guide.intro.length, `${source.label} has no intro`).toBeGreaterThan(0);

            // Timeline's steps differ by phone, so it carries platforms instead.
            const hasSteps = guide.steps.length > 0;
            const hasPlatforms =
                (guide.platforms ?? []).every((p) => p.steps.length > 0) &&
                (guide.platforms ?? []).length > 0;
            expect(hasSteps || hasPlatforms, `${source.label} has no steps`).toBe(true);
        }
    });

    /**
     * What arrives, in the three facts the source page states above the steps.
     *
     * The page used to describe the archive file by file, and the archive is
     * exactly what nobody has to sort out — every file is routed by what is
     * inside it. What is left is what decides whether you can act today: the
     * wait, the shape of the download, and its weight.
     */
    test('every source says what arrives and how long it takes', () => {
        for (const source of CATALOG_SOURCES) {
            expect(
                source.request.length,
                `${source.label} names no export to ask for`
            ).toBeGreaterThan(0);
            expect(
                source.format.length,
                `${source.label} says nothing about what arrives`
            ).toBeGreaterThan(0);
            expect(source.size.length, `${source.label} gives no idea of the size`).toBeGreaterThan(
                0
            );
            expect(
                source.delay.length,
                `${source.label} gives no idea of the wait`
            ).toBeGreaterThan(0);
        }
    });

    /**
     * Storage is what makes an import undoable. A source that can be added and
     * not removed is the failure this guards against, and nothing in the UI
     * would show it — the row simply wouldn't be offered.
     */
    test('every source declares where its rows are stored', () => {
        for (const source of CATALOG_SOURCES) {
            expect(SOURCE_STORAGE, `${source.label} has no storage`).toHaveProperty(source.id);
            expect(SOURCE_STORAGE[source.id].length).toBeGreaterThan(0);
        }
    });

    test('storage covers exactly the modules the source claims to fill', () => {
        for (const source of CATALOG_SOURCES) {
            const stored = SOURCE_STORAGE[source.id].map((store) => store.module).sort();
            const claimed = Object.keys(source.fills).sort();
            expect(stored, `${source.label} stores and fills different modules`).toEqual(claimed);
        }
    });

    test('storage declares no source the catalog does not list', () => {
        const ids = new Set(CATALOG_SOURCES.map((source) => source.id));
        for (const id of Object.keys(SOURCE_STORAGE)) {
            expect(ids, `storage names unknown source "${id}"`).toContain(id);
        }
    });

    /**
     * A table with two sources in it must be scoped by both, or removing one
     * would take the other with it.
     */
    test('sources sharing a table are each scoped to their own rows', () => {
        const byTable = new Map<string, string[]>();
        for (const [id, stores] of Object.entries(SOURCE_STORAGE)) {
            for (const store of stores) {
                byTable.set(store.table, [...(byTable.get(store.table) ?? []), id]);
            }
        }

        for (const [table, ids] of byTable) {
            if (ids.length < 2) continue;
            for (const id of ids) {
                const store = SOURCE_STORAGE[id].find((s) => s.table === table);
                expect(store?.scope, `"${id}" shares ${table} but is unscoped`).toBeDefined();
            }
        }
    });

    test('modulesFilledBy returns the filled modules in column order', () => {
        const garmin = CATALOG_SOURCES.find((source) => source.id === 'garmin');
        expect(garmin).toBeDefined();

        // The one export feeding three modules — the case the matrix exists for.
        expect(modulesFilledBy(garmin!).map((module) => module.id)).toEqual<ModuleId[]>([
            'positions',
            'steps',
            'health',
        ]);
    });

    /**
     * The other direction, which the empty-module screens read: standing in
     * front of a dataset with nothing in it, the useful question is what to go
     * and ask for — cheapest first.
     */
    test('sourcesFilling names every export that feeds a module, soonest first', () => {
        const messages = sourcesFilling('messages').map((source) => source.id);
        expect(messages).toContain('whatsapp');
        expect(messages).toContain('messenger');
        expect(messages).not.toContain('spotify');
        expect(messages[0]).toBe('whatsapp');

        // Every module has at least one way in, or its page is a dead end.
        for (const module of DATA_MODULES) {
            expect(
                sourcesFilling(module.id).length,
                `${module.label} has no source`
            ).toBeGreaterThan(0);
        }
    });
});
