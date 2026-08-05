/**
 * Messaging service a conversation came from. `unknown` is a real outcome, not a
 * bug: an archive can be recognised as Meta JSON while its surrounding paths
 * give no way to tell Messenger from Instagram, and saying so beats guessing.
 */
export type Network = 'messenger' | 'instagram' | 'whatsapp' | 'unknown';

export const NETWORK_LABELS: Record<Network, string> = {
    messenger: 'Messenger',
    instagram: 'Instagram',
    whatsapp: 'WhatsApp',
    unknown: 'Unknown',
};

/** Coarse family of an attachment, derived from its file extension. */
export type MediaKind = 'photo' | 'video' | 'voice' | 'gif' | 'other' | 'none';

export type MessageDirection = 'sent' | 'received';

// ---------------------------------------------------------------------------
// The shape every source parser produces
// ---------------------------------------------------------------------------

/**
 * One message as a parser hands it over: the facts carried by the export, and
 * nothing derived. Everything conversational (reply delays, sessions…) is
 * computed once downstream — see `import/buildRows.ts`.
 */
export interface ParsedMessage {
    sender: string;
    text: string;
    /** Epoch milliseconds. */
    timestampMs: number;
    /** Export-level kind: text | media | link | placeholder | … */
    kind: string;
    mediaKind: MediaKind;
    /** Reaction emojis, in the order the export lists them. */
    reactions: string[];
    isUnsent: boolean;
}

/** One conversation, normalized across sources. */
export interface ParsedThread {
    network: Network;
    /**
     * Id of the parser that produced this thread. Two exports of the *same*
     * service can name their owner differently — Meta's standard download says
     * "Augustin Durivault" where its secure-storage download says "Augustin Du
     * Rivet" — so "who am I?" is settled per export, not per network.
     */
    sourceId: string;
    /** Display name of the conversation (contact name, or group title). */
    threadName: string;
    participants: string[];
    isGroup: boolean;
    messages: ParsedMessage[];
}

/**
 * What a parser returns. It doesn't know its own id — routing stamps `sourceId`
 * on the way out, since that is the layer that knows which export a thread came
 * from.
 */
export type ParsedThreadDraft = Omit<ParsedThread, 'sourceId'>;

// ---------------------------------------------------------------------------
// The normalized camelCase JSON export (see sources/normalizedJson.ts)
// ---------------------------------------------------------------------------

export interface RawReaction {
    actor?: string;
    reaction?: string;
}

export interface RawMediaRef {
    uri?: string;
}

export interface RawMessage {
    senderName?: string;
    text?: string | null;
    /** Epoch milliseconds. */
    timestamp?: number;
    type?: string; // text | media | link | placeholder
    media?: RawMediaRef[];
    reactions?: RawReaction[];
    isUnsent?: boolean;
}

export interface RawMessageThread {
    participants?: string[];
    threadName?: string;
    messages?: RawMessage[];
}

// ---------------------------------------------------------------------------
// The row that reaches DuckDB
// ---------------------------------------------------------------------------

/**
 * One row of the `messages` table.
 *
 * `timestamp`/`date` are local wall-clock strings ready for insertion, matching
 * `spotify_plays` and `google_maps_segments` (the DB stores naive TIMESTAMP /
 * DATE). Exports carry plain epoch milliseconds with no zone, so the wall-clock
 * is the browser's local rendering of that instant.
 *
 * The conversational fields (`gapSeconds` … `isSessionStart`) are derived once
 * at import by a sequential pass per thread, so no query has to re-window them.
 */
export interface MessageRow {
    network: Network;
    timestamp: string;      // local wall-clock "YYYY-MM-DD HH:MM:SS"
    date: string;           // local day "YYYY-MM-DD"
    thread: string;
    contact: string;        // the other party (thread name for groups)
    isGroup: boolean;
    sender: string;
    direction: MessageDirection;
    msgType: string;
    mediaKind: MediaKind;
    text: string;
    charCount: number;
    wordCount: number;
    emojiCount: number;
    hasQuestion: boolean;
    reactionCount: number;
    reactions: string;      // the reaction emojis, separated by REACTION_SEPARATOR
    isUnsent: boolean;
    /** Seconds since the previous message in the thread; null for the first. */
    gapSeconds: number | null;
    /** `gapSeconds`, but only when the sender changed — a real turn-around. */
    replyDelaySeconds: number | null;
    /** Same sender as the previous message, more than 5 minutes later. */
    isDoubleText: boolean;
    /** Monotonic per thread; a gap over 6 hours opens a new session. */
    sessionId: number;
    isSessionStart: boolean;
}
