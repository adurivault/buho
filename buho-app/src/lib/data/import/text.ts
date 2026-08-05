import type { MediaKind } from '$lib/types/messages';

const EMOJI_RE = /\p{Extended_Pictographic}/gu;
/**
 * UTF-8 bytes read as Latin-1: any lead byte (C2–F4) followed by a continuation
 * byte. The range has to span the 3- and 4-byte sequences too, not just the
 * accented Latin ones — a mangled ❤ arrives as three bytes (E2 9D A4), and
 * stopping at C5 would repair the names in an export while leaving its emoji
 * broken.
 */
const MOJIBAKE_RE = /[\u00c2-\u00f4][\u0080-\u00bf]/;

/**
 * Meta serializes its JSON as UTF-8 bytes escaped one by one, so accented text
 * comes back double-encoded ("Ã©" for "é"). When a string is entirely within
 * Latin-1 *and* shows the tell-tale sequence, its code points are the original
 * bytes and re-decoding them recovers the text.
 *
 * Shared by every source parser: a converted export may be clean while a raw one
 * from the same service is not.
 */
export function fixMojibake(value: string): string {
    if (!MOJIBAKE_RE.test(value)) return value;
    const bytes = new Uint8Array(value.length);
    for (let i = 0; i < value.length; i++) {
        const code = value.charCodeAt(i);
        if (code > 0xff) return value; // not a byte string after all
        bytes[i] = code;
    }
    try {
        return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
        return value;
    }
}

/** Coarse attachment family, from a file name or URI. */
export function mediaKindFromUri(uri: string): MediaKind {
    const ext = /\.([a-z0-9]+)(?:\?|$)/i.exec(uri)?.[1]?.toLowerCase();
    switch (ext) {
        case 'jpg':
        case 'jpeg':
        case 'png':
        case 'webp':
        case 'heic':
            return 'photo';
        case 'mp4':
        case 'mov':
        case 'mkv':
        case '3gp':
            return 'video';
        case 'ogg':
        case 'opus':
        case 'm4a':
        case 'mp3':
        case 'aac':
            return 'voice';
        case 'gif':
            return 'gif';
        default:
            return 'other';
    }
}

export function countEmoji(text: string): number {
    EMOJI_RE.lastIndex = 0;
    return text.match(EMOJI_RE)?.length ?? 0;
}

export function countWords(text: string): number {
    const trimmed = text.trim();
    return trimmed === '' ? 0 : trimmed.split(/\s+/).length;
}
