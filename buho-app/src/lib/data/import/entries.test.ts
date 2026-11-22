import { describe, it, expect, vi } from 'vitest';
import JSZip from 'jszip';
import { entriesFromZip, entriesFromFileList } from './entries';

/**
 * A real File — JSZip needs an actual Blob — with `size` overridden, so a
 * multi-gigabyte archive can be simulated without allocating one.
 */
function fakeZip(name: string, size: number, bytes: Uint8Array = new Uint8Array()): File {
    const file = new File([bytes as unknown as BlobPart], name);
    Object.defineProperty(file, 'size', { value: size });
    return file;
}

describe('entriesFromZip — oversized archives', () => {
    it('refuses an archive past the 2 GiB ceiling, naming it and the way out', async () => {
        const file = fakeZip('facebook-export.zip', 2.6 * 1024 ** 3);

        await expect(entriesFromZip(file)).rejects.toThrow(/facebook-export\.zip/);
        await expect(entriesFromZip(file)).rejects.toThrow(/2\.6 GB/);
        await expect(entriesFromZip(file)).rejects.toThrow(/too large to open in a browser tab/);
        // The message has to say what to do instead, not just what failed.
        await expect(entriesFromZip(file)).rejects.toThrow(/Choose a folder/);
    });

    it('does not even try to unpack it', async () => {
        const load = vi.spyOn(JSZip, 'loadAsync');
        try {
            await entriesFromZip(fakeZip('huge.zip', 3 * 1024 ** 3)).catch(() => {});
            expect(load).not.toHaveBeenCalled();
        } finally {
            load.mockRestore();
        }
    });

    it('blames memory when a big-but-legal archive fails to unpack', async () => {
        const file = fakeZip('big.zip', 1.5 * 1024 ** 3, new Uint8Array([1, 2, 3]));
        await expect(entriesFromZip(file)).rejects.toThrow(/ran out of memory/);
    });

    it('blames the file itself when a small one fails', async () => {
        const file = fakeZip('notazip.zip', 2048, new Uint8Array([1, 2, 3]));
        await expect(entriesFromZip(file)).rejects.toThrow(/damaged or not a zip/);
    });

    it('reads a normal archive, keeping paths and skipping attachments', async () => {
        const zip = new JSZip();
        zip.file('messages/inbox/alice_1/message_1.json', '{"messages":[]}');
        zip.file('messages/inbox/alice_1/photos/a.jpg', 'binary');
        const bytes = await zip.generateAsync({ type: 'uint8array' });

        const entries = await entriesFromZip(fakeZip('ok.zip', bytes.length, bytes));

        expect(entries.map((e) => e.path)).toEqual(['messages/inbox/alice_1/message_1.json']);
        expect(await entries[0].text()).toBe('{"messages":[]}');
    });

    it('peeks at a zip member without holding it', async () => {
        const zip = new JSZip();
        zip.file('messages/inbox/alice_1/message_1.json', '{"messages":[],"padding":"xxxxxxxx"}');
        const bytes = await zip.generateAsync({ type: 'uint8array' });

        const [entry] = await entriesFromZip(fakeZip('ok.zip', bytes.length, bytes));

        expect(await entry.peek(12)).toBe('{"messages":');
        // Nothing was memoized along the way: the full read still works, and the
        // peek result is not what comes back.
        expect(await entry.text()).toBe('{"messages":[],"padding":"xxxxxxxx"}');
    });

    it('opens binary formats a parser can read, and flags them as binary', async () => {
        const zip = new JSZip();
        zip.file('UploadedFiles/jules.marin_123.fit', new Uint8Array([0x0e, 0x10, 0x9c, 0x08]));
        zip.file('UploadedFiles/photo.jpg', 'not for us');
        const bytes = await zip.generateAsync({ type: 'uint8array' });

        const entries = await entriesFromZip(fakeZip('garmin.zip', bytes.length, bytes));

        expect(entries.map((e) => e.name)).toEqual(['jules.marin_123.fit']);
        expect(entries[0].binary).toBe(true);
        expect(Array.from(await entries[0].bytes())).toEqual([0x0e, 0x10, 0x9c, 0x08]);
    });

    it('leaves text entries unflagged', async () => {
        const zip = new JSZip();
        zip.file('messages/inbox/alice_1/message_1.json', '{"messages":[]}');
        const bytes = await zip.generateAsync({ type: 'uint8array' });

        const [entry] = await entriesFromZip(fakeZip('ok.zip', bytes.length, bytes));

        expect(entry.binary).toBeFalsy();
    });

    /**
     * A Garmin export is a zip whose entire raw payload is a second zip of ~10k
     * `.fit` files. Stopping at the outer archive yields no entries at all, which
     * reads to the user as "nothing recognised in your export".
     */
    it('follows a zip nested inside a zip', async () => {
        const inner = new JSZip();
        inner.file('jules.marin_123.fit', new Uint8Array([0x0e, 0x10]));
        inner.file('jules.marin_456.fit', new Uint8Array([0x0e, 0x10]));
        const innerBytes = await inner.generateAsync({ type: 'uint8array' });

        const outer = new JSZip();
        outer.file('DI_CONNECT/DI-Connect-Uploaded-Files/UploadedFiles_0-_Part1.zip', innerBytes);
        outer.file('DI_CONNECT/DI-Connect-Wellness/sleep.json', '[]');
        const outerBytes = await outer.generateAsync({ type: 'uint8array' });

        const entries = await entriesFromZip(fakeZip('garmin.zip', outerBytes.length, outerBytes));

        expect(entries.map((e) => e.name).sort()).toEqual([
            'jules.marin_123.fit',
            'jules.marin_456.fit',
            'sleep.json',
        ]);
        // The nested archive stays in the path, so a parser can still tell where
        // a file came from.
        const fit = entries.find((e) => e.name === 'jules.marin_123.fit');
        expect(fit?.path).toBe(
            'DI_CONNECT/DI-Connect-Uploaded-Files/UploadedFiles_0-_Part1.zip/jules.marin_123.fit'
        );
    });

    it('stops following zips before they can nest without bound', async () => {
        const deepest = new JSZip();
        deepest.file('buried.fit', new Uint8Array([0x0e]));

        const middle = new JSZip();
        middle.file('level3.zip', await deepest.generateAsync({ type: 'uint8array' }));

        const outer = new JSZip();
        outer.file('level2.zip', await middle.generateAsync({ type: 'uint8array' }));
        const bytes = await outer.generateAsync({ type: 'uint8array' });

        const entries = await entriesFromZip(fakeZip('level1.zip', bytes.length, bytes));

        expect(entries).toEqual([]);
    });

    it('surfaces the failure rather than importing a partial export', async () => {
        // A half-read export looks like a working import with messages missing,
        // which is worse than an error — so one bad zip fails the whole drop.
        const good = new JSZip();
        good.file('messages/inbox/alice_1/message_1.json', '{"messages":[]}');
        const bytes = await good.generateAsync({ type: 'uint8array' });

        await expect(
            entriesFromFileList([
                fakeZip('ok.zip', bytes.length, bytes),
                fakeZip('huge.zip', 3 * 1024 ** 3),
            ])
        ).rejects.toThrow(/too large/);
    });
});
