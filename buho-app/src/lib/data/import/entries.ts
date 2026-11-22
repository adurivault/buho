import JSZip from 'jszip';
import type { ImportEntry } from '../sources/types';
import { ImportError, type ImportFailure } from './errors';

/**
 * Everything the user can hand over — a zip, a picked folder, loose files, a
 * drag-and-drop — reduced to one flat list of lazily-readable entries.
 *
 * Browser support is the constraint here: `webkitdirectory` (folder picker) and
 * `DataTransferItem.webkitGetAsEntry` (dropped folders) both work on Chrome and
 * Firefox ≥ 50. The File System Access API (`showDirectoryPicker`) would be
 * nicer and is Chrome-only, so it is deliberately not used.
 */

/** Text files worth opening. Everything else in an export is an attachment. */
const READABLE = /\.(json|txt|gpx|tcx)$/i;
/**
 * Binary formats a parser can read: Garmin ships its raw data as `.fit`, Deezer
 * its whole export as one `.xlsx`, and Strava gzips every track file it hands
 * back — `.fit.gz`, and the odd `.tcx.gz` from a decade ago.
 *
 * An .xlsx is a zip, but it is deliberately *not* expanded as one below — its
 * members are XML fragments meaningless on their own, and the Deezer parser
 * opens the workbook itself. A `.gz` is not expanded here either: it wraps a
 * single file, which the parser claiming it inflates itself.
 */
const BINARY = /\.(fit|xlsx)$|\.(fit|gpx|tcx)\.gz$/i;
const ZIP = /\.zip$/i;

const isOpenable = (name: string) => READABLE.test(name) || BINARY.test(name);

/** Guard against a pathological archive eating the tab. */
const MAX_ENTRIES = 100_000;

/**
 * JSZip decompresses the whole archive into memory, so an archive is capped by
 * the engine's largest allocation rather than by disk. 2 GiB is the hard ceiling
 * (`ArrayBuffer` on most engines); past ~1 GiB it is already a coin toss on how
 * much room the tab has left.
 *
 * Meta routinely ships exports well past both, split into multi-gigabyte parts —
 * so this is the common case for a full Messenger history, not a rare one.
 */
const ZIP_HARD_LIMIT = 2 * 1024 ** 3;
const ZIP_RISKY_SIZE = 1024 ** 3;

const formatSize = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(1)} GB`;

/**
 * Same advice for every zip failure, since the fix is always the same: the
 * folder path streams file by file and has no size ceiling at all.
 */
function unzipItYourself(file: File, code: ImportFailure, reason: string): ImportError {
    return new ImportError(
        code,
        `"${file.name}" (${formatSize(file.size)}) ${reason}. Unzip it on your computer, then use "Choose a folder" — that path has no size limit.`
    );
}

function basename(path: string): string {
    const parts = path.split('/');
    return parts[parts.length - 1] || path;
}

function fileEntry(file: File, path: string): ImportEntry {
    return {
        path,
        name: basename(path),
        binary: BINARY.test(file.name),
        // `slice` cuts bytes while the decoder expects UTF-8, so a character
        // straddling the cut yields U+FFFD. Harmless — the head is sniffed for
        // structure, never parsed.
        peek: (length) => file.slice(0, length).text(),
        text: () => file.text(),
        bytes: async () => new Uint8Array(await file.arrayBuffer()),
    };
}

/**
 * How deep to follow zips inside zips.
 *
 * Garmin needs exactly one level: its export is a zip whose entire raw payload
 * is a second zip of ~10k `.fit` files. The bound is there so a zip bomb can't
 * turn one drop into unbounded work.
 */
const MAX_ZIP_DEPTH = 2;

async function expandZip(
    zip: JSZip,
    prefix: string,
    depth: number,
    out: ImportEntry[]
): Promise<void> {
    for (const [path, zipEntry] of Object.entries(zip.files)) {
        if (zipEntry.dir) continue;
        if (out.length >= MAX_ENTRIES) return;
        const fullPath = prefix + path;

        if (ZIP.test(path)) {
            if (depth >= MAX_ZIP_DEPTH) continue;
            const nested = await JSZip.loadAsync(await zipEntry.async('uint8array'));
            await expandZip(nested, `${fullPath}/`, depth + 1, out);
            continue;
        }

        if (!isOpenable(path)) continue;
        out.push({
            path: fullPath,
            name: basename(path),
            binary: BINARY.test(path),
            // JSZip cannot inflate a prefix, so the head is sliced out of a full
            // decompression. That means paying it twice for the entries a parser
            // claims — the tradeoff is deliberate: one member is held at a time
            // instead of every peeked member at once.
            peek: async (length) => (await zipEntry.async('string')).slice(0, length),
            text: () => zipEntry.async('string'),
            bytes: () => zipEntry.async('uint8array'),
        });
    }
}

/**
 * Expand one zip into entries, keeping each file's path inside the archive.
 *
 * Fails loudly rather than partially: a half-read export looks like a working
 * import with messages mysteriously missing, which is far worse than an error.
 */
export async function entriesFromZip(file: File): Promise<ImportEntry[]> {
    if (file.size > ZIP_HARD_LIMIT) {
        throw unzipItYourself(file, 'zip-too-large', 'is too large to open in a browser tab');
    }

    let zip: JSZip;
    try {
        zip = await JSZip.loadAsync(file);
    } catch {
        // Past a gigabyte the failure is almost always the allocation, whatever
        // the engine chose to throw; below it, a genuinely broken archive.
        throw file.size > ZIP_RISKY_SIZE
            ? unzipItYourself(
                  file,
                  'out-of-memory',
                  'was too large for this browser to unpack — it ran out of memory'
              )
            : unzipItYourself(
                  file,
                  'zip-damaged',
                  "couldn't be opened, it may be damaged or not a zip"
              );
    }

    const entries: ImportEntry[] = [];
    await expandZip(zip, '', 1, entries);
    return entries;
}

/**
 * Turn a FileList (loose files, or a folder picked with `webkitdirectory`) into
 * entries. Zips found among them are expanded — dropping a folder that still
 * holds the downloaded archive is the common case, not an edge one.
 */
export async function entriesFromFileList(files: ArrayLike<File>): Promise<ImportEntry[]> {
    const entries: ImportEntry[] = [];

    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        // `webkitRelativePath` is set by the folder picker and carries the path
        // inside the chosen directory; a lone file only has its name.
        const path =
            (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;

        if (ZIP.test(file.name)) {
            entries.push(...(await entriesFromZip(file)));
        } else if (isOpenable(file.name)) {
            entries.push(fileEntry(file, path));
        }
    }
    return entries;
}

// --- Drag and drop ---------------------------------------------------------

interface FileSystemEntryLike {
    isFile: boolean;
    isDirectory: boolean;
    fullPath: string;
    name: string;
    file?(cb: (file: File) => void, err: (e: unknown) => void): void;
    createReader?(): {
        readEntries(cb: (entries: FileSystemEntryLike[]) => void, err: (e: unknown) => void): void;
    };
}

function readFile(entry: FileSystemEntryLike): Promise<File | null> {
    return new Promise((resolve) => {
        entry.file?.(
            (file) => resolve(file),
            () => resolve(null)
        );
    });
}

/**
 * A directory reader returns its children in batches and signals the end with an
 * empty batch — reading it once only gets the first ~100 entries.
 */
function readAllChildren(entry: FileSystemEntryLike): Promise<FileSystemEntryLike[]> {
    const reader = entry.createReader?.();
    if (!reader) return Promise.resolve([]);

    return new Promise((resolve) => {
        const all: FileSystemEntryLike[] = [];
        const readBatch = () => {
            reader.readEntries(
                (batch) => {
                    if (batch.length === 0) {
                        resolve(all);
                        return;
                    }
                    all.push(...batch);
                    readBatch();
                },
                () => resolve(all)
            );
        };
        readBatch();
    });
}

async function walkEntry(entry: FileSystemEntryLike, out: ImportEntry[]): Promise<void> {
    if (out.length >= MAX_ENTRIES) return;

    if (entry.isFile) {
        const file = await readFile(entry);
        if (!file) return;
        // `fullPath` starts with "/"; strip it so paths match the zip/folder ones.
        const path = (entry.fullPath || entry.name).replace(/^\//, '');
        if (ZIP.test(file.name)) {
            out.push(...(await entriesFromZip(file)));
        } else if (isOpenable(file.name)) {
            out.push(fileEntry(file, path));
        }
        return;
    }

    if (entry.isDirectory) {
        for (const child of await readAllChildren(entry)) {
            await walkEntry(child, out);
        }
    }
}

/**
 * What a drop yielded, captured synchronously. Reading it is deferred so the
 * caller can do that inside its own error handling — expanding a zip can fail,
 * and that failure has to reach the user rather than become an unhandled
 * rejection.
 */
export interface DropContents {
    read(): Promise<ImportEntry[]>;
}

/**
 * Grab a drop's roots. **Must be called synchronously from the drop handler**:
 * `DataTransfer.items` is emptied as soon as the handler yields, so waiting for
 * an await would find nothing there.
 *
 * Folders are walked recursively via `webkitGetAsEntry`; browsers that don't
 * expose it fall back to the flat `DataTransfer.files`, which still handles
 * dropped zips and loose files. The DOM lib types the entries as
 * `FileSystemEntry`, whose recursive reading API is only partly declared —
 * hence the local structural type.
 */
export function collectDrop(dataTransfer: DataTransfer): DropContents {
    const roots = Array.from(dataTransfer.items ?? [])
        .filter((item) => item.kind === 'file')
        .map((item) => item.webkitGetAsEntry?.() as unknown as FileSystemEntryLike | null)
        .filter((entry): entry is FileSystemEntryLike => entry != null);

    const files = Array.from(dataTransfer.files ?? []);

    return {
        async read() {
            if (roots.length === 0) return entriesFromFileList(files);
            const out: ImportEntry[] = [];
            for (const root of roots) {
                await walkEntry(root, out);
            }
            return out;
        },
    };
}
