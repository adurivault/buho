import type { MessageRow } from '#lib/types/messages.ts';
import { getConnection, insertStaged } from './client';
import type { StagedTable } from './staging';

/** Columns of `messages`, in schema order, minus the derived `msg_index`. */
export const MESSAGE_COLUMNS = `
    network, timestamp, date, thread, contact, is_group, sender, direction,
    msg_type, media_kind, text, char_count, word_count, emoji_count,
    has_question, reaction_count, reactions, is_unsent, gap_seconds,
    reply_delay_seconds, is_double_text, session_id, is_session_start
`;

/**
 * Move staged rows into `messages`, skipping those already stored.
 *
 * Exported so the headless DuckDB test exercises this exact statement rather
 * than a paraphrase of it — the anti-join is the whole reason a second import
 * doesn't duplicate the first.
 *
 * Unlike the other tables there is deliberately no QUALIFY: identical messages
 * *within one drop* are kept. Inside a single export they are two messages the
 * service recorded — "ok" sent twice in a second — not a re-import, and only a
 * re-import is what the dedupe is for.
 */
export function messagesDedupeSql(target: string, staging: string): string {
    return `
        INSERT INTO ${target} (${MESSAGE_COLUMNS})
        SELECT ${MESSAGE_COLUMNS} FROM ${staging} t
        WHERE NOT EXISTS (
            SELECT 1 FROM ${target} m
            WHERE m.network = t.network
              AND m.thread = t.thread
              AND m.timestamp = t.timestamp
              AND m.sender = t.sender
              AND m.text IS NOT DISTINCT FROM t.text
        )
    `;
}

/** The table's staging spec — exported so the headless test runs the real one. */
export const MESSAGES_TABLE: StagedTable<MessageRow> = {
    table: 'messages',
    schema: `
        network VARCHAR,
        timestamp TIMESTAMP,
        date DATE,
        thread VARCHAR,
        contact VARCHAR,
        is_group BOOLEAN,
        sender VARCHAR,
        direction VARCHAR,
        msg_type VARCHAR,
        media_kind VARCHAR,
        text VARCHAR,
        char_count INTEGER,
        word_count INTEGER,
        emoji_count INTEGER,
        has_question BOOLEAN,
        reaction_count INTEGER,
        reactions VARCHAR,
        is_unsent BOOLEAN,
        gap_seconds DOUBLE,
        reply_delay_seconds DOUBLE,
        is_double_text BOOLEAN,
        session_id INTEGER,
        is_session_start BOOLEAN,
        msg_index INTEGER
    `,
    columns: MESSAGE_COLUMNS,
    toRecord: (r: MessageRow) => ({
        network: r.network,
        timestamp: r.timestamp,
        date: r.date,
        thread: r.thread,
        contact: r.contact,
        is_group: r.isGroup,
        sender: r.sender,
        direction: r.direction,
        msg_type: r.msgType,
        media_kind: r.mediaKind,
        text: r.text,
        char_count: r.charCount,
        word_count: r.wordCount,
        emoji_count: r.emojiCount,
        has_question: r.hasQuestion,
        reaction_count: r.reactionCount,
        reactions: r.reactions,
        is_unsent: r.isUnsent,
        gap_seconds: r.gapSeconds,
        reply_delay_seconds: r.replyDelaySeconds,
        is_double_text: r.isDoubleText,
        session_id: r.sessionId,
        is_session_start: r.isSessionStart,
    }),
    // Anti-join on the natural key: only messages not already stored land in
    // the real table, so re-importing an archive is a no-op.
    dedupeSql: messagesDedupeSql,
};

/**
 * Insert parsed messages into the `messages` table, **appending** to whatever is
 * already there. The column named `timestamp` matches the two other sources so
 * the shared date-filter helpers work unchanged.
 *
 * Unlike the other two importers this one never drops the table: messages arrive
 * network by network, and importing WhatsApp must not erase Messenger. Which
 * means duplicates are now possible — re-dropping the same archive — so rows go
 * through a temp table and only those with no twin already stored are kept.
 *
 * The natural key is (network, thread, timestamp, sender, text). Its cost is
 * explicit: two byte-identical messages from the same sender in the same second
 * of the same thread collapse into one. That is rarer than a double import, and
 * much less damaging.
 *
 * Rows are serialized in batches, because message text makes the intermediate
 * JSON far heavier per row than a location segment.
 *
 * @throws {Error} If database is not initialized.
 */
export async function insertMessages(rows: MessageRow[]): Promise<void> {
    await insertStaged(MESSAGES_TABLE, rows);
    if (rows.length === 0) return;
    // Stable per-row key, mirroring seg_id: the explorer keeps its points in a
    // raw array and needs a key that survives independently of row order. It is
    // rebuilt after every import, since appending shifts nothing but adds rows.
    const connection = await getConnection();
    await connection.query(`UPDATE ${MESSAGES_TABLE.table} SET msg_index = rowid`);
}
