/**
 * The open day's event tracks, grouped into rows: one per conversation for
 * the messages, one per service for Google activity, the quieter ones folded
 * into "Others" so a day with forty conversations still fits.
 *
 * Pure (no DB, no DOM).
 */
import { clock } from './dates';
import type { ActivityEvent, ConversationMessages } from './timeline';

/** Events landing in the same minute, drawn as one tick. */
export interface Tick {
    minute: number;
    count: number;
    /** For messages: how many of them you sent; the rest you received. */
    sent?: number;
    tip: string;
}

export interface TickRow {
    label: string;
    count: number;
    ticks: Tick[];
}

/** How many rows a track shows before folding the rest into "Others". */
export const ROWS_KEPT = 3;

interface Event {
    minute: number;
    /** Who or what the event is about: a contact, a search. */
    what: string;
    /** For a message, whether you sent it. */
    sent?: boolean;
    /** For a message, the line its tooltip quotes: who wrote, and how it starts. */
    line?: string;
}

/** A tick's tooltip, from its minute and the events landing in it. */
type TipOf = (minute: number, inMinute: Event[]) => string;

/** Events bucketed by minute, in order. */
function ticksOf(events: Event[], tipOf: TipOf): Tick[] {
    const byMinute = new Map<number, Event[]>();
    for (const event of events) {
        const minute = Math.floor(event.minute);
        const at = byMinute.get(minute);
        if (at) at.push(event);
        else byMinute.set(minute, [event]);
    }
    return [...byMinute.entries()]
        .sort(([a], [b]) => a - b)
        .map(([minute, inMinute]) => {
            const tick: Tick = { minute, count: inMinute.length, tip: tipOf(minute, inMinute) };
            if (inMinute.some((event) => event.sent !== undefined)) {
                tick.sent = inMinute.filter((event) => event.sent).length;
            }
            return tick;
        });
}

/** The busiest groups kept as they are, the rest folded into one "Others" row. */
function foldRows(
    groups: { label: string; events: Event[] }[],
    tipOf: TipOf,
    keep: number
): TickRow[] {
    const sorted = [...groups].sort(
        (a, b) =>
            b.events.length - a.events.length ||
            (a.label < b.label ? -1 : a.label > b.label ? 1 : 0)
    );
    // Folding a single group would only rename it.
    const kept = sorted.length > keep + 1 ? sorted.slice(0, keep) : sorted;
    const rest = sorted.slice(kept.length);
    const rows = kept.map((group) => ({
        label: group.label,
        count: group.events.length,
        ticks: ticksOf(group.events, tipOf),
    }));
    if (rest.length > 0) {
        const events = rest.flatMap((group) => group.events);
        rows.push({ label: 'Others', count: events.length, ticks: ticksOf(events, tipOf) });
    }
    return rows;
}

/** Who or what the events of a minute were about, a few of them. */
function whoOf(inMinute: Event[]): string {
    const distinct = [...new Set(inMinute.map((event) => event.what))];
    return distinct.slice(0, 3).join(', ') + (distinct.length > 3 ? '…' : '');
}

/** How many messages a tooltip quotes, and how much of each. */
export const QUOTED_MESSAGES = 4;
export const QUOTE_LENGTH = 80;

/** The start of a message, cut at a word where it runs long. */
function quote(text: string): string {
    const flat = text.replace(/\s+/g, ' ').trim();
    if (flat.length <= QUOTE_LENGTH) return flat;
    const cut = flat.slice(0, QUOTE_LENGTH);
    const space = cut.lastIndexOf(' ');
    return `${space > QUOTE_LENGTH / 2 ? cut.slice(0, space) : cut}…`;
}

/** "09:05 · Léa", then the start of each message of the minute, then how many more. */
const messagesTip: TipOf = (minute, inMinute) => {
    const quoted = inMinute.slice(0, QUOTED_MESSAGES).map((event) => event.line ?? '');
    const more = inMinute.length - quoted.length;
    return [
        `${clock(minute)} · ${whoOf(inMinute)}`,
        ...quoted,
        ...(more > 0 ? [`+${more} more`] : []),
    ].join('\n');
};

/** The day's messages, a row per conversation, busiest first. */
export function conversationRows(
    conversations: ConversationMessages[],
    keep = ROWS_KEPT
): TickRow[] {
    return foldRows(
        conversations.map((row) => ({
            label: row.contact,
            events: row.messages.map((message) => ({
                minute: message.minute,
                what: row.contact,
                sent: message.sent,
                line: `${message.sent ? 'You' : message.sender}: ${quote(message.text)}`,
            })),
        })),
        messagesTip,
        keep
    );
}

const entriesTip: TipOf = (minute, inMinute) =>
    `${clock(minute)} · ${inMinute.length === 1 ? '1 entry' : `${inMinute.length} entries`} · ${whoOf(inMinute)}`;

const capitalise = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** The day's Google activity, a row per service, busiest first. */
export function serviceRows(
    events: ActivityEvent[],
    serviceName: (service: string) => string,
    keep = ROWS_KEPT
): TickRow[] {
    const byService = new Map<string, Event[]>();
    for (const event of events) {
        const what = event.label
            ? `${capitalise(event.action)} ${event.label}`
            : capitalise(event.action);
        const list = byService.get(event.service) ?? [];
        list.push({ minute: event.minute, what });
        byService.set(event.service, list);
    }
    return foldRows(
        [...byService.entries()].map(([service, list]) => ({
            label: serviceName(service),
            events: list,
        })),
        entriesTip,
        keep
    );
}
