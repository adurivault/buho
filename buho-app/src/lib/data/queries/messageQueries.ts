import { query } from '../db';
import { REACTION_SEPARATOR } from '../import/buildRows';
import type { Network } from '$lib/types/messages';
import type { ConnectablePoint } from './behaviorQueries';

/**
 * A reply delay only counts inside a conversation session: once six hours have
 * passed the exchange has stopped, and the next message opens a new session
 * rather than answering the previous one (see parseMessages). Every reply-time
 * figure in this module therefore excludes session openers.
 */
const REPLY_CONDITION = 'reply_delay_seconds IS NOT NULL AND NOT is_session_start';

/** Network ids are stored lowercase; the explorer shows the service's real name. */
const NETWORK_LABEL_SQL = `
    CASE network
        WHEN 'messenger' THEN 'Messenger'
        WHEN 'instagram' THEN 'Instagram'
        WHEN 'whatsapp' THEN 'WhatsApp'
        ELSE 'Unknown'
    END
`;

/** Coarse message-length buckets for the explorer pie, short→long. */
export const LENGTH_BUCKETS = ['≤10', '11–40', '41–120', '120+'];
const LENGTH_BUCKET_SQL = `
    CASE
        WHEN char_count <= 10 THEN '≤10'
        WHEN char_count <= 40 THEN '11–40'
        WHEN char_count <= 120 THEN '41–120'
        ELSE '120+'
    END
`;

// ---------------------------------------------------------------------------
// Networks
// ---------------------------------------------------------------------------

export interface NetworkSummary {
    network: Network;
    threads: number;
    messages: number;
    firstDay: string | null;
    lastDay: string | null;
}

/**
 * What is currently stored, per messaging service. Imports accumulate, so this
 * is the only honest answer to "what's in here?" after a second drop.
 */
export async function getNetworkSummary(): Promise<NetworkSummary[]> {
    const sql = `
        SELECT
            network,
            CAST(COUNT(DISTINCT thread) AS BIGINT) as threads,
            CAST(COUNT(*) AS BIGINT) as messages,
            CAST(MIN(date) AS VARCHAR) as firstDay,
            CAST(MAX(date) AS VARCHAR) as lastDay
        FROM messages
        GROUP BY network
        ORDER BY messages DESC
    `;

    try {
        const result = await query<any>(sql);
        return result.map((row) => ({
            network: (row.network ?? 'unknown') as Network,
            threads: Number(row.threads) || 0,
            messages: Number(row.messages) || 0,
            firstDay: row.firstDay ?? null,
            lastDay: row.lastDay ?? null,
        }));
    } catch (error) {
        // Expected before the first import: the table doesn't exist yet.
        return [];
    }
}

// ---------------------------------------------------------------------------
// Macro stats
// ---------------------------------------------------------------------------

export interface MessageMacroStats {
    totalMessages: number;
    sentMessages: number;
    receivedMessages: number;
    contacts: number;
    activeDays: number;
    conversations: number;
    words: number;
    characters: number;
    mediaMessages: number;
    voiceNotes: number;
    reactionsReceived: number;
    reactionsGiven: number;
    /** Median time it takes me to answer, in seconds (null without enough data). */
    myMedianReplySeconds: number | null;
    /** Median time they take to answer me. */
    theirMedianReplySeconds: number | null;
    firstDay: string | null;
    lastDay: string | null;
}

const EMPTY_MACRO_STATS: MessageMacroStats = {
    totalMessages: 0,
    sentMessages: 0,
    receivedMessages: 0,
    contacts: 0,
    activeDays: 0,
    conversations: 0,
    words: 0,
    characters: 0,
    mediaMessages: 0,
    voiceNotes: 0,
    reactionsReceived: 0,
    reactionsGiven: 0,
    myMedianReplySeconds: null,
    theirMedianReplySeconds: null,
    firstDay: null,
    lastDay: null,
};

/**
 * Headline numbers over the whole export.
 *
 * A reaction sitting on a message I sent is one I *received*; the mirror holds
 * for messages I was sent. `conversations` counts distinct (contact, session)
 * pairs — bursts of messages separated by at least six hours of silence.
 */
export async function getMessageMacroStats(): Promise<MessageMacroStats> {
    const sql = `
        SELECT
            CAST(COUNT(*) AS BIGINT) as totalMessages,
            CAST(COUNT(*) FILTER (WHERE direction = 'sent') AS BIGINT) as sentMessages,
            CAST(COUNT(*) FILTER (WHERE direction = 'received') AS BIGINT) as receivedMessages,
            CAST(COUNT(DISTINCT contact) AS BIGINT) as contacts,
            CAST(COUNT(DISTINCT date) AS BIGINT) as activeDays,
            CAST(COUNT(DISTINCT (contact || '#' || CAST(session_id AS VARCHAR))) AS BIGINT) as conversations,
            CAST(COALESCE(SUM(word_count), 0) AS BIGINT) as words,
            CAST(COALESCE(SUM(char_count), 0) AS BIGINT) as characters,
            CAST(COUNT(*) FILTER (WHERE media_kind <> 'none') AS BIGINT) as mediaMessages,
            CAST(COUNT(*) FILTER (WHERE media_kind = 'voice') AS BIGINT) as voiceNotes,
            CAST(COALESCE(SUM(reaction_count) FILTER (WHERE direction = 'sent'), 0) AS BIGINT) as reactionsReceived,
            CAST(COALESCE(SUM(reaction_count) FILTER (WHERE direction = 'received'), 0) AS BIGINT) as reactionsGiven,
            CAST(QUANTILE_CONT(reply_delay_seconds, 0.5)
                 FILTER (WHERE direction = 'sent' AND ${REPLY_CONDITION}) AS DOUBLE) as myMedianReplySeconds,
            CAST(QUANTILE_CONT(reply_delay_seconds, 0.5)
                 FILTER (WHERE direction = 'received' AND ${REPLY_CONDITION}) AS DOUBLE) as theirMedianReplySeconds,
            CAST(MIN(date) AS VARCHAR) as firstDay,
            CAST(MAX(date) AS VARCHAR) as lastDay
        FROM messages
    `;

    try {
        const [row] = await query<any>(sql);
        if (!row) return EMPTY_MACRO_STATS;
        return {
            totalMessages: Number(row.totalMessages) || 0,
            sentMessages: Number(row.sentMessages) || 0,
            receivedMessages: Number(row.receivedMessages) || 0,
            contacts: Number(row.contacts) || 0,
            activeDays: Number(row.activeDays) || 0,
            conversations: Number(row.conversations) || 0,
            words: Number(row.words) || 0,
            characters: Number(row.characters) || 0,
            mediaMessages: Number(row.mediaMessages) || 0,
            voiceNotes: Number(row.voiceNotes) || 0,
            reactionsReceived: Number(row.reactionsReceived) || 0,
            reactionsGiven: Number(row.reactionsGiven) || 0,
            myMedianReplySeconds: row.myMedianReplySeconds === null ? null : Number(row.myMedianReplySeconds),
            theirMedianReplySeconds: row.theirMedianReplySeconds === null ? null : Number(row.theirMedianReplySeconds),
            firstDay: row.firstDay ?? null,
            lastDay: row.lastDay ?? null,
        };
    } catch (error) {
        console.error('Error fetching message macro stats:', error);
        return EMPTY_MACRO_STATS;
    }
}

// ---------------------------------------------------------------------------
// Bar chart race
// ---------------------------------------------------------------------------

export interface MonthlyContactCount {
    month: string; // 'YYYY-MM-DD' (month bucket start)
    name: string;  // contact
    messages: number;
}

/**
 * Messages exchanged per contact and per month. Non-cumulative: BarChartRace
 * accumulates them itself.
 */
export async function getMonthlyMessagesByContact(): Promise<MonthlyContactCount[]> {
    const sql = `
        SELECT
            CAST(CAST(DATE_TRUNC('month', timestamp) AS DATE) AS VARCHAR) as month,
            contact as name,
            CAST(COUNT(*) AS BIGINT) as messages
        FROM messages
        WHERE timestamp IS NOT NULL
        GROUP BY month, name
        ORDER BY month ASC, messages DESC, name ASC
    `;

    try {
        const result = await query<any>(sql);
        return result.map((row) => ({
            month: row.month || '',
            name: row.name || 'Unknown',
            messages: Number(row.messages) || 0,
        }));
    } catch (error) {
        console.error('Error fetching monthly messages by contact:', error);
        return [];
    }
}

// ---------------------------------------------------------------------------
// Temporal rhythm
// ---------------------------------------------------------------------------

export interface HourWeekdayCell {
    dow: number;  // 0 = Sunday, DuckDB's DAYOFWEEK
    hour: number; // 0–23
    direction: 'sent' | 'received';
    messages: number;
}

/** Messages per (weekday, hour, direction) — the rhythm heatmap. */
export async function getHourWeekdayGrid(): Promise<HourWeekdayCell[]> {
    const sql = `
        SELECT
            CAST(DAYOFWEEK(timestamp) AS INTEGER) as dow,
            CAST(HOUR(timestamp) AS INTEGER) as hour,
            direction,
            CAST(COUNT(*) AS BIGINT) as messages
        FROM messages
        WHERE timestamp IS NOT NULL
        GROUP BY dow, hour, direction
        ORDER BY dow ASC, hour ASC
    `;

    try {
        const result = await query<any>(sql);
        return result.map((row) => ({
            dow: Number(row.dow) || 0,
            hour: Number(row.hour) || 0,
            direction: row.direction === 'sent' ? 'sent' : 'received',
            messages: Number(row.messages) || 0,
        }));
    } catch (error) {
        console.error('Error fetching hour/weekday grid:', error);
        return [];
    }
}

export interface DailyMessageCount {
    date: string;
    messages: number;
    sent: number;
    received: number;
    words: number;
    contacts: number;
}

/** One row per day with at least one message — feeds the calendar and the streaks. */
export async function getDailyMessageCounts(): Promise<DailyMessageCount[]> {
    const sql = `
        SELECT
            CAST(date AS VARCHAR) as date,
            CAST(COUNT(*) AS BIGINT) as messages,
            CAST(COUNT(*) FILTER (WHERE direction = 'sent') AS BIGINT) as sent,
            CAST(COUNT(*) FILTER (WHERE direction = 'received') AS BIGINT) as received,
            CAST(COALESCE(SUM(word_count), 0) AS BIGINT) as words,
            CAST(COUNT(DISTINCT contact) AS BIGINT) as contacts
        FROM messages
        WHERE date IS NOT NULL
        GROUP BY date
        ORDER BY date ASC
    `;

    try {
        const result = await query<any>(sql);
        return result.map((row) => ({
            date: row.date || '',
            messages: Number(row.messages) || 0,
            sent: Number(row.sent) || 0,
            received: Number(row.received) || 0,
            words: Number(row.words) || 0,
            contacts: Number(row.contacts) || 0,
        }));
    } catch (error) {
        console.error('Error fetching daily message counts:', error);
        return [];
    }
}

// ---------------------------------------------------------------------------
// Per-contact behaviour
// ---------------------------------------------------------------------------

export interface ContactBalance {
    contact: string;
    messages: number;
    sent: number;
    received: number;
    myDoubleTexts: number;
    theirDoubleTexts: number;
    sessions: number;
    sessionsIStarted: number;
    firstDay: string;
    lastDay: string;
}

/**
 * Who carries each conversation: volume split by direction, relances on both
 * sides, and who opens the sessions.
 */
export async function getContactBalance(): Promise<ContactBalance[]> {
    const sql = `
        SELECT
            contact,
            CAST(COUNT(*) AS BIGINT) as messages,
            CAST(COUNT(*) FILTER (WHERE direction = 'sent') AS BIGINT) as sent,
            CAST(COUNT(*) FILTER (WHERE direction = 'received') AS BIGINT) as received,
            CAST(COUNT(*) FILTER (WHERE is_double_text AND direction = 'sent') AS BIGINT) as myDoubleTexts,
            CAST(COUNT(*) FILTER (WHERE is_double_text AND direction = 'received') AS BIGINT) as theirDoubleTexts,
            CAST(COUNT(*) FILTER (WHERE is_session_start) AS BIGINT) as sessions,
            CAST(COUNT(*) FILTER (WHERE is_session_start AND direction = 'sent') AS BIGINT) as sessionsIStarted,
            CAST(MIN(date) AS VARCHAR) as firstDay,
            CAST(MAX(date) AS VARCHAR) as lastDay
        FROM messages
        GROUP BY contact
        ORDER BY messages DESC, contact ASC
    `;

    try {
        const result = await query<any>(sql);
        return result.map((row) => ({
            contact: row.contact || 'Unknown',
            messages: Number(row.messages) || 0,
            sent: Number(row.sent) || 0,
            received: Number(row.received) || 0,
            myDoubleTexts: Number(row.myDoubleTexts) || 0,
            theirDoubleTexts: Number(row.theirDoubleTexts) || 0,
            sessions: Number(row.sessions) || 0,
            sessionsIStarted: Number(row.sessionsIStarted) || 0,
            firstDay: row.firstDay || '',
            lastDay: row.lastDay || '',
        }));
    } catch (error) {
        console.error('Error fetching contact balance:', error);
        return [];
    }
}

export interface ContactReplyTimes {
    contact: string;
    messages: number;
    myReplies: number;
    theirReplies: number;
    myMedianSeconds: number | null;
    theirMedianSeconds: number | null;
}

/**
 * Median turn-around on each side of a conversation. `minReplies` drops contacts
 * with too few exchanges on either side to mean anything — a single reply would
 * otherwise land as a confident median.
 */
export async function getContactReplyTimes(minReplies = 5): Promise<ContactReplyTimes[]> {
    const sql = `
        SELECT
            contact,
            CAST(COUNT(*) AS BIGINT) as messages,
            CAST(COUNT(*) FILTER (WHERE direction = 'sent' AND ${REPLY_CONDITION}) AS BIGINT) as myReplies,
            CAST(COUNT(*) FILTER (WHERE direction = 'received' AND ${REPLY_CONDITION}) AS BIGINT) as theirReplies,
            CAST(QUANTILE_CONT(reply_delay_seconds, 0.5)
                 FILTER (WHERE direction = 'sent' AND ${REPLY_CONDITION}) AS DOUBLE) as myMedianSeconds,
            CAST(QUANTILE_CONT(reply_delay_seconds, 0.5)
                 FILTER (WHERE direction = 'received' AND ${REPLY_CONDITION}) AS DOUBLE) as theirMedianSeconds
        FROM messages
        GROUP BY contact
        HAVING COUNT(*) FILTER (WHERE direction = 'sent' AND ${REPLY_CONDITION}) >= ${Math.max(1, Math.floor(minReplies))}
           AND COUNT(*) FILTER (WHERE direction = 'received' AND ${REPLY_CONDITION}) >= ${Math.max(1, Math.floor(minReplies))}
        ORDER BY messages DESC
    `;

    try {
        const result = await query<any>(sql);
        return result.map((row) => ({
            contact: row.contact || 'Unknown',
            messages: Number(row.messages) || 0,
            myReplies: Number(row.myReplies) || 0,
            theirReplies: Number(row.theirReplies) || 0,
            myMedianSeconds: row.myMedianSeconds === null ? null : Number(row.myMedianSeconds),
            theirMedianSeconds: row.theirMedianSeconds === null ? null : Number(row.theirMedianSeconds),
        }));
    } catch (error) {
        console.error('Error fetching contact reply times:', error);
        return [];
    }
}

/**
 * Monthly volume for the busiest `topN` contacts, zero-filled across the whole
 * export span so the ridgeline draws a continuous baseline per contact.
 */
export async function getMonthlyVolumeForTopContacts(topN = 15): Promise<MonthlyContactCount[]> {
    const limit = Math.max(1, Math.floor(topN));
    const sql = `
        WITH top_contacts AS (
            SELECT contact FROM messages GROUP BY contact ORDER BY COUNT(*) DESC LIMIT ${limit}
        ),
        months AS (
            SELECT UNNEST(GENERATE_SERIES(
                DATE_TRUNC('month', (SELECT MIN(timestamp) FROM messages)),
                DATE_TRUNC('month', (SELECT MAX(timestamp) FROM messages)),
                INTERVAL 1 MONTH
            )) as month_start
        ),
        counts AS (
            SELECT contact, DATE_TRUNC('month', timestamp) as month_start, COUNT(*) as messages
            FROM messages
            WHERE contact IN (SELECT contact FROM top_contacts)
            GROUP BY contact, month_start
        )
        SELECT
            CAST(CAST(m.month_start AS DATE) AS VARCHAR) as month,
            t.contact as name,
            CAST(COALESCE(c.messages, 0) AS BIGINT) as messages
        FROM months m
        CROSS JOIN top_contacts t
        LEFT JOIN counts c ON c.contact = t.contact AND c.month_start = m.month_start
        ORDER BY name ASC, month ASC
    `;

    try {
        const result = await query<any>(sql);
        return result.map((row) => ({
            month: row.month || '',
            name: row.name || 'Unknown',
            messages: Number(row.messages) || 0,
        }));
    } catch (error) {
        console.error('Error fetching monthly volume for top contacts:', error);
        return [];
    }
}

// ---------------------------------------------------------------------------
// Reactions
// ---------------------------------------------------------------------------

export interface ReactionCount {
    emoji: string;
    /** Reactions I received (they reacted to a message I sent). */
    received: number;
    /** Reactions I gave (I reacted to a message they sent). */
    given: number;
}

/**
 * Reaction emojis, split by who they came from. The parser stores them joined by
 * {@link REACTION_SEPARATOR}, so one row per emoji comes back from an UNNEST.
 */
export async function getReactionBreakdown(): Promise<ReactionCount[]> {
    const sql = `
        WITH exploded AS (
            SELECT direction, UNNEST(STRING_SPLIT(reactions, '${REACTION_SEPARATOR}')) as emoji
            FROM messages
            WHERE reactions IS NOT NULL AND reactions <> ''
        )
        SELECT
            emoji,
            CAST(COUNT(*) FILTER (WHERE direction = 'sent') AS BIGINT) as received,
            CAST(COUNT(*) FILTER (WHERE direction = 'received') AS BIGINT) as given
        FROM exploded
        WHERE emoji <> ''
        GROUP BY emoji
        ORDER BY (COUNT(*)) DESC
    `;

    try {
        const result = await query<any>(sql);
        return result.map((row) => ({
            emoji: row.emoji || '',
            received: Number(row.received) || 0,
            given: Number(row.given) || 0,
        }));
    } catch (error) {
        console.error('Error fetching reaction breakdown:', error);
        return [];
    }
}

export interface ContactReactionRate {
    contact: string;
    messagesSent: number;
    reactionsReceived: number;
    /** Reactions received per 100 messages I sent to this contact. */
    ratePer100: number;
}

/** Which contacts actually react to what I send. */
export async function getContactReactionRates(minMessages = 20): Promise<ContactReactionRate[]> {
    const sql = `
        SELECT
            contact,
            CAST(COUNT(*) AS BIGINT) as messagesSent,
            CAST(COALESCE(SUM(reaction_count), 0) AS BIGINT) as reactionsReceived
        FROM messages
        WHERE direction = 'sent'
        GROUP BY contact
        HAVING COUNT(*) >= ${Math.max(1, Math.floor(minMessages))}
        ORDER BY (CAST(COALESCE(SUM(reaction_count), 0) AS DOUBLE) / COUNT(*)) DESC
    `;

    try {
        const result = await query<any>(sql);
        return result.map((row) => {
            const messagesSent = Number(row.messagesSent) || 0;
            const reactionsReceived = Number(row.reactionsReceived) || 0;
            return {
                contact: row.contact || 'Unknown',
                messagesSent,
                reactionsReceived,
                ratePer100: messagesSent > 0 ? (reactionsReceived / messagesSent) * 100 : 0,
            };
        });
    } catch (error) {
        console.error('Error fetching contact reaction rates:', error);
        return [];
    }
}

// ---------------------------------------------------------------------------
// Explorer
// ---------------------------------------------------------------------------

/**
 * A constellation point for the messages explorer, plus the normalized dimension
 * fields used to recompute `matched` and the pies in JS (mirror of Spotify's
 * ExplorerBasePoint). x = day epoch (ms), y = fractional hour of day.
 */
export interface MessageBasePoint extends ConnectablePoint {
    msgIndex: number;
    fNetwork: string;     // Messenger | Instagram | WhatsApp | Unknown
    fContact: string;
    fDirection: string;   // Sent | Received
    fType: string;        // text | media | link | placeholder
    fMediaKind: string;   // photo | video | voice | gif | other | none
    fReacted: string;     // Reacted | No reaction
    fLength: string;      // length bucket
    dow: string;
    year: string;
    words: number;
    chars: number;
}

/**
 * All constellation points, loaded ONCE. The point set never changes with the
 * filters (`matched` is recomputed in JS), which avoids rebuilding the quadtree
 * on every interaction.
 */
export async function getMessageBasePoints(): Promise<MessageBasePoint[]> {
    const sql = `
        SELECT
            msg_index as msgIndex,
            CAST(epoch(DATE(timestamp)) * 1000 AS BIGINT) as x,
            CAST(hour(timestamp) + (minute(timestamp) / 60.0) + (second(timestamp) / 3600.0) AS DOUBLE) as y,
            CAST(timestamp AS VARCHAR) as sentAt,
            sender,
            ${NETWORK_LABEL_SQL} as fNetwork,
            contact as fContact,
            CASE WHEN direction = 'sent' THEN 'Sent' ELSE 'Received' END as fDirection,
            COALESCE(NULLIF(TRIM(msg_type), ''), 'text') as fType,
            COALESCE(NULLIF(TRIM(media_kind), ''), 'none') as fMediaKind,
            CASE WHEN reaction_count > 0 THEN 'Reacted' ELSE 'No reaction' END as fReacted,
            ${LENGTH_BUCKET_SQL} as fLength,
            CAST(DAYOFWEEK(timestamp) AS VARCHAR) as dow,
            CAST(YEAR(timestamp) AS VARCHAR) as year,
            CAST(COALESCE(word_count, 0) AS INTEGER) as words,
            CAST(COALESCE(char_count, 0) AS INTEGER) as chars,
            text,
            reactions
        FROM messages
        WHERE timestamp IS NOT NULL
        ORDER BY x ASC
    `;

    try {
        const result = await query<any>(sql);
        return result.map((row) => ({
            msgIndex: Number(row.msgIndex) || 0,
            x: Number(row.x),
            y: Number(row.y),
            matched: true,
            metadata: {
                network: row.fNetwork,
                contact: row.fContact,
                direction: row.fDirection,
                sentAt: row.sentAt,
                sender: row.sender,
                text: row.text ?? '',
                type: row.fType,
                mediaKind: row.fMediaKind,
                reactions: row.reactions ?? '',
            },
            fNetwork: row.fNetwork || 'Unknown',
            fContact: row.fContact || 'Unknown',
            fDirection: row.fDirection || 'Received',
            fType: row.fType || 'text',
            fMediaKind: row.fMediaKind || 'none',
            fReacted: row.fReacted || 'No reaction',
            fLength: row.fLength || '≤10',
            dow: row.dow ?? 'Unknown',
            year: row.year ?? 'Unknown',
            words: Number(row.words) || 0,
            chars: Number(row.chars) || 0,
        }));
    } catch (error) {
        console.error('Error fetching message base points:', error);
        return [];
    }
}

/** Full time span of the constellation, in epoch milliseconds. */
export async function getMessageTimeDomain(): Promise<[number, number] | null> {
    const sql = `
        SELECT
            CAST(epoch(DATE(MIN(timestamp))) * 1000 AS BIGINT) as minMs,
            CAST(epoch(DATE(MAX(timestamp))) * 1000 AS BIGINT) as maxMs
        FROM messages
        WHERE timestamp IS NOT NULL
    `;

    try {
        const [row] = await query<any>(sql);
        if (!row || row.minMs === null || row.maxMs === null) return null;
        return [Number(row.minMs), Number(row.maxMs)];
    } catch (error) {
        console.error('Error fetching message time domain:', error);
        return null;
    }
}
