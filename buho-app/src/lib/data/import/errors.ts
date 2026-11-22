/**
 * Why an import failed, as a closed set of codes.
 *
 * The codes exist for two audiences at once. Analytics can only ever send a
 * code — an error *message* interpolates file names, counts and parser output,
 * i.e. the user's own data — and the app itself wants the same distinctions
 * when it decides what to show. Classifying by sniffing the message text is how
 * the two drift apart: "…split across several zips…" reads as a zip failure,
 * "Nothing Buho reads in 12 files" reads as nothing at all.
 *
 * So every failure Buho raises itself carries its code, and message-sniffing is
 * left for what it is genuinely for — errors thrown by JSZip, DuckDB or the
 * engine, which have no code to carry.
 */
export type ImportFailure =
    /** Nothing openable in what was handed over — an all-media zip, say. */
    | 'empty-selection'
    /** Files were read, but no parser recognised any of them. */
    | 'unrecognised'
    /** A parser claimed files and they held no rows: an empty conversation. */
    | 'recognised-empty'
    /** Past what a browser tab can unpack, refused before trying. */
    | 'zip-too-large'
    /** Not a zip, or a damaged one. */
    | 'zip-damaged'
    /** The allocation failed — usually a big archive, sometimes DuckDB. */
    | 'out-of-memory'
    /** A file claimed by a parser turned out not to be valid JSON. */
    | 'invalid-json'
    /** The store rejected the rows. */
    | 'db-error'
    /** Anything unclassified. Worth watching: a rise means a new failure mode. */
    | 'unknown';

export const IMPORT_FAILURES: ImportFailure[] = [
    'empty-selection',
    'unrecognised',
    'recognised-empty',
    'zip-too-large',
    'zip-damaged',
    'out-of-memory',
    'invalid-json',
    'db-error',
    'unknown',
];

/** Where in the import it broke. Separates "we can't read it" from "we can't store it". */
export type ImportStage = 'read' | 'parse' | 'store';

/** An import failure Buho raised itself, carrying its own classification. */
export class ImportError extends Error {
    readonly code: ImportFailure;

    constructor(code: ImportFailure, message: string) {
        super(message);
        this.name = 'ImportError';
        this.code = code;
    }
}
