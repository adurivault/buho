import type { ParsedMessage, ParsedThreadDraft, RawMessageThread } from '$lib/types/messages';
import { fixMojibake, mediaKindFromUri } from '../import/text';
import type { ImportEntry, SourceParser } from './types';

/**
 * A converted Messenger export: one JSON object per conversation, camelCase
 * keys, media re-hosted under `./media/<uuid>.<ext>`.
 *
 * This is *not* the shape Meta ships (which uses `sender_name` / `content` /
 * `timestamp_ms`, splits attachments into `photos`/`videos`/`audio_files`, and
 * arrives latin1-mangled). It comes out of a conversion step — but it is a real
 * export people have on disk, so it stays a first-class source.
 */

/** "David Nvs_0" → "David Nvs". Threads without a suffix pass through. */
function stripThreadSuffix(threadName: string): string {
    return threadName.replace(/_\d+$/, '');
}

function toParsedMessage(raw: NonNullable<RawMessageThread['messages']>[number]): ParsedMessage | null {
    const timestampMs = typeof raw.timestamp === 'number' ? raw.timestamp : NaN;
    if (!Number.isFinite(timestampMs)) return null;

    const media = raw.media ?? [];
    return {
        sender: fixMojibake(raw.senderName ?? 'Unknown'),
        text: fixMojibake(raw.text ?? ''),
        timestampMs,
        kind: typeof raw.type === 'string' ? raw.type : 'text',
        mediaKind: media.length > 0 ? mediaKindFromUri(media[0]?.uri ?? '') : 'none',
        reactions: (raw.reactions ?? [])
            .map((r) => fixMojibake(r?.reaction ?? ''))
            .filter(Boolean),
        isUnsent: raw.isUnsent === true,
    };
}

export function parseNormalizedThread(data: unknown): ParsedThreadDraft | null {
    if (!data || typeof data !== 'object') return null;
    const raw = data as RawMessageThread;
    if (!Array.isArray(raw.messages)) return null;

    const participants = (raw.participants ?? []).map(fixMojibake);
    const rawName = typeof raw.threadName === 'string' ? fixMojibake(raw.threadName) : '';
    const isGroup = participants.length > 2;

    const messages: ParsedMessage[] = [];
    for (const message of raw.messages) {
        const parsed = toParsedMessage(message);
        if (parsed) messages.push(parsed);
    }

    return {
        network: 'messenger',
        threadName: stripThreadSuffix(rawName) || participants[0] || 'Unknown',
        participants,
        isGroup,
        messages,
    };
}

export const normalizedJsonParser: SourceParser = {
    id: 'normalized-json',
    label: 'Messenger (converted export)',

    match(entry: ImportEntry, peek: string): number {
        if (!/\.json$/i.test(entry.name)) return 0;
        // The camelCase keys are the signature; `participants` as a *string*
        // array is what separates it from the raw Meta schema.
        if (!peek.includes('"senderName"') && !peek.includes('"threadName"')) return 0;
        let score = 0.6;
        if (peek.includes('"threadName"')) score += 0.2;
        if (/"participants"\s*:\s*\[\s*"/.test(peek)) score += 0.2;
        return score;
    },

    network: () => 'messenger',

    async parse(entries: ImportEntry[]): Promise<ParsedThreadDraft[]> {
        const threads: ParsedThreadDraft[] = [];
        for (const entry of entries) {
            try {
                const thread = parseNormalizedThread(JSON.parse(await entry.text()));
                if (thread) threads.push(thread);
            } catch {
                // Skip invalid JSON silently: routing already vouched for the
                // shape from a 2 KB peek, a truncated file isn't worth an error.
            }
        }
        return threads;
    },
};
