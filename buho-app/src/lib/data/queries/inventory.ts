import type { IconName } from '#lib/components/icons.ts';
import type { Network } from '#lib/types/messages.ts';
import { CATALOG_SOURCES } from '#lib/data/sources/catalog.ts';
import type { ModuleId } from '#lib/data/modules.ts';
import { storesFor } from '#lib/data/sources/storage.ts';
import {
    countRows,
    deleteBy,
    dropTable,
    rebuildPositionsDerived,
    rebuildStepsDerived,
} from '#lib/data/db/index.ts';

/**
 * What is currently loaded, source by source — and how to take one back out.
 *
 * Imports only ever accumulate, so "what is in there" stops being answerable by
 * the last drop. This is the answer, and the undo: one row per export that
 * actually contributed something, with the counts it contributed and a removal
 * scoped to its own rows.
 */

/** One source's share of one module. */
export interface SourceHolding {
    module: ModuleId;
    rows: number;
}

/** One export that is currently loaded. */
export interface LoadedSource {
    id: string;
    label: string;
    icon: IconName;
    /** Set for the three messaging services, which share one glyph. */
    network?: Network;
    /** What it holds, per module it feeds. Never empty. */
    holdings: SourceHolding[];
    /** Everything it holds, across modules. */
    rows: number;
}

/**
 * Every source with rows in the database, in catalog order.
 *
 * Catalog order rather than by size: the list sits in a dialog with a remove
 * button on each line, and rows that reorder themselves under the cursor as
 * counts change are rows you misclick.
 */
export async function getInventory(): Promise<LoadedSource[]> {
    const loaded: LoadedSource[] = [];

    for (const source of CATALOG_SOURCES) {
        const holdings: SourceHolding[] = [];

        for (const store of storesFor(source.id)) {
            if (store.beside) continue;
            const rows = await countRows(store.table, store.scope);
            if (rows > 0) holdings.push({ module: store.module, rows });
        }

        if (holdings.length === 0) continue;
        loaded.push({
            id: source.id,
            label: source.label,
            icon: source.icon,
            network: source.network,
            holdings,
            rows: holdings.reduce((total, holding) => total + holding.rows, 0),
        });
    }

    return loaded;
}

/**
 * Remove everything one export contributed, leaving every other source intact.
 *
 * Scoped deletes where a table is shared, a drop where it isn't — the next
 * import recreates it either way. Returns the modules that lost rows, so the
 * caller knows which summaries and filters to rebuild.
 */
export async function removeSource(id: string): Promise<ModuleId[]> {
    const stores = storesFor(id);
    const touched = new Set<ModuleId>();
    let positionsChanged = false;
    let stepsChanged = false;

    for (const store of stores) {
        if (store.scope) {
            await deleteBy(store.table, store.scope.column, store.scope.value);
        } else {
            await dropTable(store.table);
        }
        touched.add(store.module);
        if (store.table === 'location_segments') positionsChanged = true;
        if (store.table === 'step_packets') stepsChanged = true;
    }

    // `superseded` is a statement about the whole table — which minutes a watch
    // covered — so removing either provider makes the stored flags wrong. See
    // rebuildPositionsDerived.
    if (positionsChanged) await rebuildPositionsDerived();
    // Same for which recorder holds each hour of steps: see rebuildStepsDerived.
    if (stepsChanged) await rebuildStepsDerived();

    return [...touched];
}
