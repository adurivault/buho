/**
 * The one way rows get into a module's table.
 *
 * Every import **appends**: Deezer must not erase Spotify, WhatsApp must not
 * erase Messenger, a Garmin export must not erase the Timeline already loaded.
 * Appending makes duplicates possible — re-dropping the same export — so rows
 * are staged in a temp table first and only the ones the table's dedupe
 * statement lets through are merged in. That statement is each table's own
 * business (its natural key); the staging around it is the same for all of them
 * and lives here.
 */

/**
 * What staging needs from DuckDB. The app passes its worker connection; the
 * headless tests pass the synchronous Node build, so this exact code path is
 * exercised against the real engine.
 */
export interface SqlRunner {
    query(sql: string): unknown;
    registerFileText(name: string, text: string): unknown;
}

export interface StagedTable<Row> {
    /** The module's table. */
    table: string;
    /** Column definitions, as for `CREATE TABLE`. */
    schema: string;
    /**
     * The columns an import provides, comma-separated — the schema minus
     * whatever is derived after the merge (row keys, counters). Staged rows
     * are read by name, so the order only has to agree with `dedupeSql`.
     */
    columns: string;
    /** Row → the JSON object DuckDB reads, keyed by column name. */
    toRecord: (row: Row) => object;
    /**
     * `INSERT INTO target … SELECT … FROM staging` keeping only rows with no twin
     * already stored — the table's natural key.
     */
    dedupeSql: (target: string, staging: string) => string;
}

/**
 * Rows per JSON batch. Serialising a whole import at once can exceed what a tab
 * can hold as one string — message text especially is heavy per row.
 */
const BATCH_SIZE = 50_000;

let fileCounter = 0;

/** Stage `rows` for `spec.table` and merge the new ones in. */
export async function stageAndMerge<Row>(
    runner: SqlRunner,
    spec: StagedTable<Row>,
    rows: Row[]
): Promise<void> {
    if (rows.length === 0) return;
    const staging = `${spec.table}_incoming`;

    await runner.query(`CREATE OR REPLACE TEMP TABLE ${staging} (${spec.schema})`);
    try {
        for (let offset = 0; offset < rows.length; offset += BATCH_SIZE) {
            const batch = rows.slice(offset, offset + BATCH_SIZE).map(spec.toRecord);
            const file = `import_${spec.table}_${Date.now()}_${fileCounter++}.json`;
            await runner.registerFileText(file, JSON.stringify(batch));
            try {
                await runner.query(
                    `INSERT INTO ${staging} (${spec.columns})
                     SELECT ${spec.columns} FROM read_json_auto('${file}')`
                );
            } finally {
                // Clear rather than drop: dropFile is not available in every build.
                await runner.registerFileText(file, '');
            }
        }
        await runner.query(spec.dedupeSql(spec.table, staging));
    } finally {
        await runner.query(`DROP TABLE IF EXISTS ${staging}`);
    }
}
