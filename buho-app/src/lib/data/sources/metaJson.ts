import type { MediaKind, Network, ParsedMessage, ParsedThreadDraft } from '$lib/types/messages';
import { fixMojibake, mediaKindFromUri } from '../import/text';
import type { ArchiveContext, ImportEntry, SourceParser } from './types';

/**
 * Raw Meta "Download your information" exports, JSON format.
 *
 * Messenger and Instagram ship the *same* schema — `messages/inbox/<slug>_<hash>/
 * message_1.json` holding `participants: [{name}]` and `messages: [{sender_name,
 * timestamp_ms, content, …}]`. Nothing inside a thread file says which service
 * it is, so the network is decided from the paths around it (see `network`).
 *
 * Text arrives double-encoded (UTF-8 bytes escaped as Latin-1) — a Meta bug old
 * enough to be a feature. `fixMojibake` undoes it.
 */

interface MetaAttachment {
    uri?: string;
}

interface MetaReaction {
    reaction?: string;
    actor?: string;
}

interface MetaMessage {
    sender_name?: string;
    timestamp_ms?: number;
    content?: string;
    photos?: MetaAttachment[];
    videos?: MetaAttachment[];
    audio_files?: MetaAttachment[];
    gifs?: MetaAttachment[];
    files?: MetaAttachment[];
    sticker?: MetaAttachment;
    share?: { link?: string; share_text?: string };
    reactions?: MetaReaction[];
    is_unsent?: boolean;
    is_geoblocked_for_viewer?: boolean;
}

interface MetaThreadFile {
    participants?: Array<{ name?: string }>;
    messages?: MetaMessage[];
    title?: string;
    thread_path?: string;
    thread_type?: string;
    is_still_participant?: boolean;
}

/**
 * Meta's archive layout: `messages/<box>/<thread>_<id>/message_<n>.json`.
 *
 * `e2ee_cutover` is the one worth naming: when Meta switched a conversation to
 * end-to-end encryption, everything said before the switch was moved there, and
 * everything after it left the standard export entirely (it lives in the
 * separate secure-storage download). A parser that only reads `inbox` silently
 * loses years of history.
 */
const META_THREAD_PATH_RE =
    /messages\/(inbox|e2ee_cutover|archived_threads|filtered_threads|message_requests)\/[^/]+\/message_\d+\.json$/i;

/** Attachment buckets, in the order they decide `mediaKind` when several exist. */
const ATTACHMENT_FIELDS: Array<[keyof MetaMessage, MediaKind]> = [
    ['audio_files', 'voice'],
    ['videos', 'video'],
    ['photos', 'photo'],
    ['gifs', 'gif'],
    ['files', 'other'],
];

/** Meta splits attachments by type; we collapse them into one kind + a message kind. */
function classify(message: MetaMessage): { kind: string; mediaKind: MediaKind } {
    for (const [field, mediaKind] of ATTACHMENT_FIELDS) {
        const list = message[field] as MetaAttachment[] | undefined;
        if (Array.isArray(list) && list.length > 0) {
            // Trust the declared bucket, but let the extension correct it: Meta
            // files voice notes as audio and stickers as photos inconsistently.
            const fromUri = mediaKindFromUri(list[0]?.uri ?? '');
            return { kind: 'media', mediaKind: fromUri === 'other' ? mediaKind : fromUri };
        }
    }
    if (message.sticker?.uri) return { kind: 'media', mediaKind: 'photo' };
    if (message.share?.link) return { kind: 'link', mediaKind: 'none' };
    if (message.is_unsent) return { kind: 'placeholder', mediaKind: 'none' };
    return { kind: 'text', mediaKind: 'none' };
}

function toParsedMessage(raw: MetaMessage): ParsedMessage | null {
    const timestampMs = typeof raw.timestamp_ms === 'number' ? raw.timestamp_ms : NaN;
    if (!Number.isFinite(timestampMs)) return null;

    const { kind, mediaKind } = classify(raw);
    // A shared link has no `content` of its own; the URL is the message.
    const text = raw.content ?? raw.share?.share_text ?? raw.share?.link ?? '';

    return {
        sender: fixMojibake(raw.sender_name ?? 'Unknown'),
        text: fixMojibake(text),
        timestampMs,
        kind,
        mediaKind,
        reactions: (raw.reactions ?? [])
            .map((r) => fixMojibake(r?.reaction ?? ''))
            .filter(Boolean),
        isUnsent: raw.is_unsent === true,
    };
}

/**
 * Thread name: `title` when present, else the archive folder holding the file
 * (`messages/inbox/alicedupont_1234567890/message_1.json` → `alicedupont`).
 */
function threadNameFor(raw: MetaThreadFile, entry: ImportEntry): string {
    const title = typeof raw.title === 'string' ? fixMojibake(raw.title).trim() : '';
    if (title) return title;
    const folder = entry.path.split('/').slice(-2, -1)[0] ?? '';
    return folder.replace(/_[0-9a-z]{6,}$/i, '') || 'Unknown';
}

export function parseMetaThread(
    data: unknown,
    entry: ImportEntry,
    network: Network,
): ParsedThreadDraft | null {
    if (!data || typeof data !== 'object') return null;
    const raw = data as MetaThreadFile;
    if (!Array.isArray(raw.messages)) return null;

    const participants = (raw.participants ?? [])
        .map((p) => fixMojibake(p?.name ?? ''))
        .filter(Boolean);

    const messages: ParsedMessage[] = [];
    for (const message of raw.messages) {
        const parsed = toParsedMessage(message);
        if (parsed) messages.push(parsed);
    }

    return {
        network,
        threadName: threadNameFor(raw, entry),
        participants,
        // `thread_type` is the reliable marker; participant count is the fallback
        // for exports that omit it.
        isGroup:
            raw.thread_type === 'RegularGroup' ||
            raw.thread_type === 'GroupThread' ||
            participants.length > 2,
        messages,
    };
}

export const metaJsonParser: SourceParser = {
    id: 'meta-json',
    label: 'Messenger / Instagram (Meta export)',

    match(entry: ImportEntry, peek: string): number {
        if (!/\.json$/i.test(entry.name)) return 0;

        // Meta's own layout is proof enough on its own, and it has to be: a group
        // thread with dozens of participants spends the whole peek listing their
        // names, so `sender_name` never appears in it. Matching on content alone
        // silently dropped exactly those threads.
        if (META_THREAD_PATH_RE.test(entry.path)) return 1;

        // Loose files, pulled out of the archive: fall back to the schema, which
        // nothing else Meta ships carries both halves of.
        if (!peek.includes('"sender_name"') || !peek.includes('"timestamp_ms"')) return 0;
        return /message_\d+\.json$/i.test(entry.name) ? 0.9 : 0.8;
    },

    /**
     * Messenger and Instagram are indistinguishable inside a thread file, so the
     * verdict comes from the archive layout. When neither service names itself,
     * `unknown` is returned rather than a coin flip — the UI can say so, and the
     * user still gets their messages.
     */
    network(ctx: ArchiveContext): Network {
        const instagram =
            ctx.hasPathSegment('your_instagram_activity') || ctx.hasPathSegment('/instagram/');
        const messenger =
            ctx.hasPathSegment('your_facebook_activity') ||
            ctx.hasPathSegment('/facebook/') ||
            ctx.hasPathSegment('facebook-');
        if (instagram && !messenger) return 'instagram';
        if (messenger && !instagram) return 'messenger';
        return 'unknown';
    },

    async parse(entries: ImportEntry[], ctx: ArchiveContext): Promise<ParsedThreadDraft[]> {
        const network = this.network(ctx);
        // Meta splits long conversations across message_1.json, message_2.json…
        // in the same folder: they are one thread, not several.
        const byFolder = new Map<string, ParsedThreadDraft>();

        for (const entry of entries) {
            let thread: ParsedThreadDraft | null = null;
            try {
                thread = parseMetaThread(JSON.parse(await entry.text()), entry, network);
            } catch {
                continue;
            }
            if (!thread) continue;

            const folder = entry.path.split('/').slice(0, -1).join('/');
            const existing = byFolder.get(folder);
            if (existing) {
                existing.messages.push(...thread.messages);
            } else {
                byFolder.set(folder, thread);
            }
        }

        return [...byFolder.values()];
    },
};
