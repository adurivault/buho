import type { MediaKind, ParsedMessage, ParsedThreadDraft } from '$lib/types/messages';
import type { ImportEntry, SourceParser } from './types';

/**
 * WhatsApp chat exports — the only source that isn't JSON.
 *
 * A chat is a flat text file, one message per line, in the *phone's* locale.
 * Three grammars cover what ships in practice:
 *
 *   [06/03/2024, 14:32:01] Alice: hello        (iOS — brackets, seconds)
 *   06/03/2024, 14:32 - Alice: hello           (Android — dash)
 *   3/6/24, 2:32 PM - Alice: hello             (12-hour clock)
 *
 * Three things make this harder than it looks, and each is handled below:
 * day/month order is ambiguous, messages can span several lines, and some lines
 * are system notices that never had a sender.
 */

/** Bidi and zero-width marks iOS sprinkles around timestamps. */
const INVISIBLE = /[‎‏‪-‮﻿]/g;

/**
 * A message header: date, time, optional AM/PM, then the separator. The sender
 * is captured separately because system lines have none.
 */
const HEADER_RE =
    /^\[?(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?\]?\s*(?:-\s*)?(.*)$/;

/** Inside the remainder of a header line, "Sender: text" — or a system notice. */
const SENDER_RE = /^([^:]{1,60}):\s?([\s\S]*)$/;

const ATTACHMENT_PATTERNS: Array<[RegExp, MediaKind]> = [
    [/\.(jpe?g|png|webp|heic)\b/i, 'photo'],
    [/\.(mp4|mov|3gp|mkv)\b/i, 'video'],
    [/\.(opus|m4a|mp3|aac|ogg)\b/i, 'voice'],
    [/\.gif\b/i, 'gif'],
];

/** Localized "media omitted" placeholders, in the languages we can cover. */
const MEDIA_OMITTED =
    /<(médias?|media) (omis|omitted)>|image omitted|video omitted|audio omitted|sticker omitted|GIF omitted|<Media omitted>/i;

interface HeaderMatch {
    day: number;
    month: number;
    year: number;
    hour: number;
    minute: number;
    second: number;
    meridiem: string | null;
    rest: string;
}

function matchHeader(line: string): HeaderMatch | null {
    const m = HEADER_RE.exec(line);
    if (!m) return null;
    return {
        // Kept as written; which is the day is decided per file, see below.
        day: parseInt(m[1], 10),
        month: parseInt(m[2], 10),
        year: parseInt(m[3], 10),
        hour: parseInt(m[4], 10),
        minute: parseInt(m[5], 10),
        second: m[6] ? parseInt(m[6], 10) : 0,
        meridiem: m[7] ? m[7].toLowerCase() : null,
        rest: m[8] ?? '',
    };
}

/**
 * Which of the two leading numbers is the day.
 *
 * `06/03/2024` is 6 March in most of the world and 3 June in the US, and the
 * file says nothing. So scan every header: a first component above 12 can only
 * be a day, a second component above 12 can only be a month-in-second-position.
 * Ties go to day-first, which is what most WhatsApp installs produce.
 */
export function inferDayFirst(headers: HeaderMatch[]): boolean {
    for (const h of headers) {
        if (h.day > 12) return true;
        if (h.month > 12) return false;
    }
    return true;
}

function toEpochMs(h: HeaderMatch, dayFirst: boolean): number {
    const day = dayFirst ? h.day : h.month;
    const month = dayFirst ? h.month : h.day;
    const year = h.year < 100 ? 2000 + h.year : h.year;

    let hour = h.hour;
    if (h.meridiem === 'pm' && hour < 12) hour += 12;
    if (h.meridiem === 'am' && hour === 12) hour = 0;

    // Local time: the export carries the phone's wall clock, which is exactly
    // what the rest of the app stores.
    return new Date(year, month - 1, day, hour, h.minute, h.second).getTime();
}

function classify(text: string): { kind: string; mediaKind: MediaKind } {
    if (MEDIA_OMITTED.test(text)) return { kind: 'media', mediaKind: 'other' };
    if (/\(file attached\)|<attached:/i.test(text)) {
        for (const [pattern, mediaKind] of ATTACHMENT_PATTERNS) {
            if (pattern.test(text)) return { kind: 'media', mediaKind };
        }
        return { kind: 'media', mediaKind: 'other' };
    }
    if (/\bhttps?:\/\//i.test(text)) return { kind: 'link', mediaKind: 'none' };
    if (/^This message was deleted|^Vous avez supprimé ce message|message was deleted$/i.test(text)) {
        return { kind: 'placeholder', mediaKind: 'none' };
    }
    return { kind: 'text', mediaKind: 'none' };
}

/** "WhatsApp Chat with Alice.txt" / "_chat.txt" in a folder → the contact name. */
function threadNameFor(entry: ImportEntry): string {
    const base = entry.name.replace(/\.txt$/i, '');
    const withMatch = /^(?:WhatsApp Chat (?:with|avec|mit|con) )(.+)$/i.exec(base);
    if (withMatch) return withMatch[1].trim();
    if (/^_?chat$/i.test(base)) {
        const folder = entry.path.split('/').slice(-2, -1)[0] ?? '';
        const folderMatch = /^(?:WhatsApp Chat (?:with|avec|mit|con) )(.+)$/i.exec(folder);
        if (folderMatch) return folderMatch[1].trim();
        if (folder) return folder;
    }
    return base || 'Unknown';
}

export function parseWhatsappChat(content: string, entry: ImportEntry): ParsedThreadDraft | null {
    const lines = content.replace(INVISIBLE, '').split(/\r?\n/);

    // Two passes: the first only to settle the date order, since a file's last
    // line can be what disambiguates its first.
    const headers: HeaderMatch[] = [];
    for (const line of lines) {
        const header = matchHeader(line);
        if (header) headers.push(header);
    }
    if (headers.length === 0) return null;
    const dayFirst = inferDayFirst(headers);

    const messages: ParsedMessage[] = [];
    const senders = new Set<string>();

    for (const line of lines) {
        const header = matchHeader(line);

        if (!header) {
            // No timestamp: this is the continuation of the previous message.
            const previous = messages[messages.length - 1];
            if (previous && line !== '') {
                previous.text = `${previous.text}\n${line}`;
            }
            continue;
        }

        const senderMatch = SENDER_RE.exec(header.rest);
        // A header with no "Sender: " is a system notice (encryption note, group
        // creation, someone joining). It belongs to nobody and is dropped.
        if (!senderMatch) continue;

        const sender = senderMatch[1].trim();
        const text = senderMatch[2] ?? '';
        const timestampMs = toEpochMs(header, dayFirst);
        if (!Number.isFinite(timestampMs)) continue;

        senders.add(sender);
        const { kind, mediaKind } = classify(text);
        messages.push({
            sender,
            text,
            timestampMs,
            kind,
            mediaKind,
            // WhatsApp exports carry no reactions at all.
            reactions: [],
            isUnsent: kind === 'placeholder',
        });
    }

    if (messages.length === 0) return null;

    const participants = [...senders];
    return {
        network: 'whatsapp',
        threadName: threadNameFor(entry),
        participants,
        isGroup: participants.length > 2,
        messages,
    };
}

export const whatsappTextParser: SourceParser = {
    id: 'whatsapp-text',
    label: 'WhatsApp (chat export)',

    match(entry: ImportEntry, peek: string): number {
        if (!/\.txt$/i.test(entry.name)) return 0;
        const clean = peek.replace(INVISIBLE, '');
        const lines = clean.split(/\r?\n/).slice(0, 40);
        const headerCount = lines.filter((l) => HEADER_RE.test(l)).length;
        if (headerCount === 0) return 0;

        // A transcript is mostly headers; a prose file that happens to open with
        // a date is not.
        let score = 0.5 + Math.min(0.3, (headerCount / Math.max(1, lines.length)) * 0.4);
        if (/^_?chat\.txt$/i.test(entry.name)) score += 0.15;
        if (/^WhatsApp Chat/i.test(entry.name)) score += 0.15;
        return Math.min(1, score);
    },

    network: () => 'whatsapp',

    async parse(entries: ImportEntry[]): Promise<ParsedThreadDraft[]> {
        const threads: ParsedThreadDraft[] = [];
        for (const entry of entries) {
            try {
                const thread = parseWhatsappChat(await entry.text(), entry);
                if (thread) threads.push(thread);
            } catch {
                // A single unreadable transcript shouldn't sink the import.
            }
        }
        return threads;
    },
};
