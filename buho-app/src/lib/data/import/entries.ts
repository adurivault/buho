import JSZip from 'jszip';
import type { ImportEntry } from '../sources/types';

/**
 * Everything the user can hand over — a zip, a picked folder, loose files, a
 * drag-and-drop — reduced to one flat list of lazily-readable entries.
 *
 * Browser support is the constraint here: `webkitdirectory` (folder picker) and
 * `DataTransferItem.webkitGetAsEntry` (dropped folders) both work on Chrome and
 * Firefox ≥ 50. The File System Access API (`showDirectoryPicker`) would be
 * nicer and is Chrome-only, so it is deliberately not used.
 */

/** Files worth opening. Everything else in an export is an attachment. */
const READABLE = /\.(json|txt)$/i;
const ZIP = /\.zip$/i;

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
function unzipItYourself(file: File, reason: string): Error {
    return new Error(
        `"${file.name}" (${formatSize(file.size)}) ${reason}. Unzip it on your computer, then use "Choose a folder" — that path has no size limit.`
    );
}

function basename(path: string): string {
    const parts = path.split('/');
    return parts[parts.length - 1] || path;
}

function fileEntry(file: File, path: string): ImportEntry {
    let cached: Promise<string> | null = null;
    return {
        path,
        name: basename(path),
        // Memoized: routing peeks at the head, then the parser reads it in full.
        text: () => (cached ??= file.text()),
    };
}

/**
 * Expand one zip into entries, keeping each file's path inside the archive.
 *
 * Fails loudly rather than partially: a half-read export looks like a working
 * import with messages mysteriously missing, which is far worse than an error.
 */
export async function entriesFromZip(file: File): Promise<ImportEntry[]> {
    if (file.size > ZIP_HARD_LIMIT) {
        throw unzipItYourself(file, 'is too large to open in a browser tab');
    }

    let zip: JSZip;
    try {
        zip = await JSZip.loadAsync(file);
    } catch (error) {
        // Past a gigabyte the failure is almost always the allocation, whatever
        // the engine chose to throw; below it, a genuinely broken archive.
        throw unzipItYourself(
            file,
            file.size > ZIP_RISKY_SIZE
                ? "was too large for this browser to unpack — it ran out of memory"
                : "couldn't be opened, it may be damaged or not a zip"
        );
    }

    const entries: ImportEntry[] = [];
    for (const [path, zipEntry] of Object.entries(zip.files)) {
        if (zipEntry.dir || !READABLE.test(path)) continue;
        if (entries.length >= MAX_ENTRIES) break;
        let cached: Promise<string> | null = null;
        entries.push({
            path,
            name: basename(path),
            text: () => (cached ??= zipEntry.async('string')),
        });
    }
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
        const path = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;

        if (ZIP.test(file.name)) {
            entries.push(...(await entriesFromZip(file)));
        } else if (READABLE.test(file.name)) {
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
            () => resolve(null),
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
            reader.readEntries((batch) => {
                if (batch.length === 0) {
                    resolve(all);
                    return;
                }
                all.push(...batch);
                readBatch();
            }, () => resolve(all));
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
        } else if (READABLE.test(file.name)) {
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

/** Convenience for callers that already own the DataTransfer synchronously. */
export function entriesFromDataTransfer(dataTransfer: DataTransfer): Promise<ImportEntry[]> {
    return collectDrop(dataTransfer).read();
}
