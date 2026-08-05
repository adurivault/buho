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

        expect(entries.map((e) => e.path)).toEqual([
            'messages/inbox/alice_1/message_1.json',
        ]);
        expect(await entries[0].text()).toBe('{"messages":[]}');
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
            ]),
        ).rejects.toThrow(/too large/);
    });
});
