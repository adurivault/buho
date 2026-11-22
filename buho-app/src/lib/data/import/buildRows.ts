import type { MessageRow, Network, ParsedMessage, ParsedThread } from '#lib/types/messages.ts';
import { countEmoji, countWords } from './text';

const pad = (n: number) => String(n).padStart(2, '0');

/** A gap this long or longer opens a new conversation session. */
const SESSION_GAP_SECONDS = 6 * 3600;
/** Below this, a same-sender follow-up is one thought split in two, not a relance. */
const DOUBLE_TEXT_SECONDS = 300;

/**
 * Separator between the reaction emojis of one message. A comma never appears in
 * a reaction, so SQL can split the column back into individual emojis.
 */
export const REACTION_SEPARATOR = ',';

/** Local wall-clock rendering of an epoch instant, "YYYY-MM-DD HH:MM:SS". */
function wallClock(ms: number): string {
    const d = new Date(ms);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/**
 * Who the export belongs to, within one network: the participant that appears in
 * every thread. With a single thread (or a tie), the participant who sent the
 * most messages wins — the owner is by far the most prolific sender of their own
 * export.
 *
 * This runs **per network**, never across: your Facebook display name and your
 * WhatsApp name are different strings for the same person, and a global vote
 * would elect whichever network you imported more of.
 */
export function detectSelf(threads: ParsedThread[]): string | null {
    const threadCounts = new Map<string, number>();
    const sentCounts = new Map<string, number>();

    for (const thread of threads) {
        for (const participant of thread.participants) {
            threadCounts.set(participant, (threadCounts.get(participant) ?? 0) + 1);
        }
        for (const message of thread.messages) {
            sentCounts.set(message.sender, (sentCounts.get(message.sender) ?? 0) + 1);
        }
    }

    // A sender that never made the participant list still counts: some exports
    // (WhatsApp text) have no participant list at all.
    for (const sender of sentCounts.keys()) {
        if (!threadCounts.has(sender)) threadCounts.set(sender, 0);
    }

    let best: string | null = null;
    let bestThreads = -1;
    let bestSent = -1;
    for (const [name, threadCount] of threadCounts) {
        const sent = sentCounts.get(name) ?? 0;
        if (threadCount > bestThreads || (threadCount === bestThreads && sent > bestSent)) {
            best = name;
            bestThreads = threadCount;
            bestSent = sent;
        }
    }
    return best;
}

/** Which identity was taken as "me" on each network, for the import summary. */
export type SelfByNetwork = Partial<Record<Network, string>>;

export interface BuildRowsResult {
    rows: MessageRow[];
    self: SelfByNetwork;
}

/**
 * Turn parsed threads into table rows, deriving each message's conversational
 * context: the gap to the previous message, the reply delay when the speaker
 * actually changed, whether it is a relance (`isDoubleText`), and which
 * conversation session it belongs to.
 *
 * This is deliberately the *only* place those columns are computed. A session
 * and a reply delay have to mean the same thing on WhatsApp as on Messenger,
 * which they wouldn't for long if each parser derived its own.
 *
 * Messages without a usable timestamp are dropped; threads are walked in
 * chronological order regardless of the order the export listed them in.
 */
export function buildMessageRows(threads: ParsedThread[]): BuildRowsResult {
    // Grouped by export, not just by service: Meta's standard download and its
    // secure-storage download are both Messenger, yet each spells the owner's
    // name its own way. Voting across both would elect one and mislabel every
    // message of the other as "received".
    const byGroup = new Map<string, ParsedThread[]>();
    for (const thread of threads) {
        const key = `${thread.network}\u0000${thread.sourceId}`;
        const list = byGroup.get(key);
        if (list) list.push(thread);
        else byGroup.set(key, [thread]);
    }

    const self: SelfByNetwork = {};
    /** Every name that turned out to be the user; direction is judged against all. */
    const selves = new Set<string>();
    const selfWeight = new Map<Network, number>();

    for (const groupThreads of byGroup.values()) {
        const me = detectSelf(groupThreads);
        if (me === null) continue;
        selves.add(me);
        const network = groupThreads[0].network;
        // Keep the identity from the export that carried the most messages, so
        // the summary names the one the user will recognise.
        const existing = self[network];
        if (!existing || countMessages(groupThreads) > (selfWeight.get(network) ?? 0)) {
            self[network] = me;
            selfWeight.set(network, countMessages(groupThreads));
        }
    }

    const rows: MessageRow[] = [];

    for (const groupThreads of byGroup.values()) {
        for (const thread of groupThreads) {
            const contact = thread.isGroup
                ? thread.threadName
                : (thread.participants.find((p) => !selves.has(p)) ?? thread.threadName);

            const ordered = thread.messages
                .filter((m) => Number.isFinite(m.timestampMs))
                .sort((a, b) => a.timestampMs - b.timestampMs);

            let previousMs: number | null = null;
            let previousSender: string | null = null;
            let sessionId = 0;

            for (const message of ordered) {
                const gapSeconds =
                    previousMs === null
                        ? null
                        : Math.max(0, (message.timestampMs - previousMs) / 1000);
                const senderChanged = previousSender !== null && previousSender !== message.sender;
                const isSessionStart = gapSeconds === null || gapSeconds >= SESSION_GAP_SECONDS;
                if (isSessionStart) sessionId += 1;

                rows.push(
                    buildRow(thread.network, thread, contact, message, selves, {
                        gapSeconds,
                        replyDelaySeconds: senderChanged ? gapSeconds : null,
                        isDoubleText:
                            previousSender === message.sender &&
                            gapSeconds !== null &&
                            gapSeconds > DOUBLE_TEXT_SECONDS,
                        sessionId,
                        isSessionStart,
                    })
                );

                previousMs = message.timestampMs;
                previousSender = message.sender;
            }
        }
    }

    return { rows, self };
}

interface DerivedContext {
    gapSeconds: number | null;
    replyDelaySeconds: number | null;
    isDoubleText: boolean;
    sessionId: number;
    isSessionStart: boolean;
}

function countMessages(threads: ParsedThread[]): number {
    return threads.reduce((total, t) => total + t.messages.length, 0);
}

function buildRow(
    network: Network,
    thread: ParsedThread,
    contact: string,
    message: ParsedMessage,
    selves: Set<string>,
    derived: DerivedContext
): MessageRow {
    const timestamp = wallClock(message.timestampMs);
    return {
        network,
        timestamp,
        date: timestamp.slice(0, 10),
        thread: thread.threadName,
        contact,
        isGroup: thread.isGroup,
        sender: message.sender,
        direction: selves.has(message.sender) ? 'sent' : 'received',
        msgType: message.kind,
        mediaKind: message.mediaKind,
        text: message.text,
        charCount: message.text.length,
        wordCount: countWords(message.text),
        emojiCount: countEmoji(message.text),
        hasQuestion: message.text.includes('?'),
        reactionCount: message.reactions.length,
        reactions: message.reactions.join(REACTION_SEPARATOR),
        isUnsent: message.isUnsent,
        ...derived,
    };
}
