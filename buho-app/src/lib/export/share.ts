/**
 * Getting a finished export out of the tab.
 *
 * Two routes, and neither one is a network call. A download writes the file to
 * the machine the data was already on; the Web Share sheet hands it to an app
 * the user picks, in a gesture they started. Buho's promise is that *we* never
 * send their data anywhere — not that they can't.
 */

/** `buho-top-artists-2026-08-25.mp4` */
export function exportFilename(stem: string, ext: string): string {
    const today = new Date();
    const date = [
        today.getFullYear(),
        String(today.getMonth() + 1).padStart(2, '0'),
        String(today.getDate()).padStart(2, '0'),
    ].join('-');
    return `buho-${slugify(stem)}-${date}.${ext}`;
}

export function slugify(text: string): string {
    return (
        text
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 60) || 'chart'
    );
}

export function downloadBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    link.remove();
    // Revoked on the next turn: Safari has not finished reading the blob when
    // `click()` returns.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Whether an OS share sheet here would actually take this file. */
export function canShareFile(blob: Blob, filename: string): boolean {
    if (typeof navigator === 'undefined' || !navigator.canShare || !navigator.share) {
        return false;
    }
    try {
        return navigator.canShare({ files: [new File([blob], filename, { type: blob.type })] });
    } catch {
        return false;
    }
}

/**
 * Opens the OS share sheet. Resolves `false` if the user dismissed it.
 *
 * The text and the address are offered but not insisted on. The spec allows a
 * payload to carry both a file and words; the *targets* decide, and plenty of
 * them — WhatsApp on iOS among them — take the file and drop everything else.
 * Worse, some refuse the whole payload rather than ignoring the parts they will
 * not use, which is why `canShare` is asked first and the file goes alone if
 * the answer is no. Losing the caption is a shame; losing the chart is a bug.
 */
export async function shareBlob(
    blob: Blob,
    filename: string,
    title: string,
    text?: string,
    url?: string
): Promise<boolean> {
    const file = new File([blob], filename, { type: blob.type });
    const full: ShareData = { files: [file], title, text, url };
    const payload = navigator.canShare?.(full) ? full : { files: [file], title };

    try {
        await navigator.share(payload);
        return true;
    } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return false;
        throw error;
    }
}

/** A rough size, for a UI that has to tell someone a GIF is 14 MB. */
export function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    const units = ['kB', 'MB', 'GB'];
    let value = bytes / 1024;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
        value /= 1024;
        unit++;
    }
    return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}
