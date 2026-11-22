/**
 * Inflating a gzip member, with the platform's own decompressor.
 *
 * `DecompressionStream` ships in every browser Buho targets and costs no bundle
 * weight, which is what makes reading a Strava export — 350 gzipped `.fit` files
 * — free where pulling in a JS inflater would not be. The whole member is held
 * in memory: these are activity files a few hundred KB each, not archives.
 */
export async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
    const stream = new DecompressionStream('gzip');

    // Written and read at once: the stream buffers a fixed amount, so awaiting
    // the write before reading deadlocks on anything larger than that buffer.
    const writer = stream.writable.getWriter();
    // The DOM types insist a view be backed by an ArrayBuffer rather than by any
    // buffer-like; a Uint8Array off a zip member is declared as the latter, and
    // the two are the same thing at runtime.
    const pump = writer.write(bytes as unknown as BufferSource).then(() => writer.close());

    const reader = stream.readable.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        total += value.length;
    }
    await pump;

    const out = new Uint8Array(total);
    let at = 0;
    for (const chunk of chunks) {
        out.set(chunk, at);
        at += chunk.length;
    }
    return out;
}
