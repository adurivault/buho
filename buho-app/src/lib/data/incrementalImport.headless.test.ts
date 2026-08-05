// @vitest-environment node
//
// Headless test of the incremental-import SQL against the real DuckDB engine.
// Imports accumulate now, so the anti-join in `messagesDedupeSql` is the only
// thing standing between a second drop of the same archive and a doubled table —
// worth proving on the engine rather than assuming from the query text.
import { describe, it, expect, beforeEach, afterAll, beforeAll } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';
import { MESSAGE_COLUMNS, messagesDedupeSql } from './db';
import { buildMessageRows } from './import/buildRows';
import type { MessageRow, Network, ParsedThread } from '$lib/types/messages';

const require = createRequire(import.meta.url);
const DIST = path.resolve(process.cwd(), 'node_modules/@duckdb/duckdb-wasm/dist');
const duckdb = require(path.join(DIST, 'duckdb-node-blocking.cjs'));
const BUNDLES = {
    mvp: { mainModule: path.join(DIST, 'duckdb-mvp.wasm'), mainWorker: null },
    eh: { mainModule: path.join(DIST, 'duckdb-eh.wasm'), mainWorker: null },
};

const SCHEMA = `
    network VARCHAR, timestamp TIMESTAMP, date DATE, thread VARCHAR, contact VARCHAR,
    is_group BOOLEAN, sender VARCHAR, direction VARCHAR, msg_type VARCHAR,
    media_kind VARCHAR, text VARCHAR, char_count INTEGER, word_count INTEGER,
    emoji_count INTEGER, has_question BOOLEAN, reaction_count INTEGER,
    reactions VARCHAR, is_unsent BOOLEAN, gap_seconds DOUBLE,
    reply_delay_seconds DOUBLE, is_double_text BOOLEAN, session_id INTEGER,
    is_session_start BOOLEAN, msg_index INTEGER
`;

let db: any;
let conn: any;

const T0 = new Date(2024, 4, 1, 10, 0, 0).getTime();

function thread(network: Network, name: string, texts: string[]): ParsedThread {
    return {
        network,
        // Stamped by routing in the real pipeline; a single value here, since
        // these fixtures all stand for one export.
        sourceId: 'test',
        threadName: name,
        participants: ['Me', name],
        isGroup: false,
        messages: texts.map((text, i) => ({
            sender: i % 2 === 0 ? 'Me' : name,
            text,
            timestampMs: T0 + i * 60_000,
            kind: 'text',
            mediaKind: 'none' as const,
            reactions: [],
            isUnsent: false,
        })),
    };
}

const literal = (v: unknown) =>
    v === null || v === undefined
        ? 'NULL'
        : typeof v === 'string'
            ? `'${v.replace(/'/g, "''")}'`
            : typeof v === 'boolean'
                ? (v ? 'TRUE' : 'FALSE')
                : String(v);

/** Mirrors insertMessages: stage the rows, then anti-join them into `messages`. */
function importRows(rows: MessageRow[]) {
    conn.query('DROP TABLE IF EXISTS messages_incoming');
    conn.query(`CREATE TABLE messages_incoming (${SCHEMA})`);
    for (const r of rows) {
        conn.query(`INSERT INTO messages_incoming (${MESSAGE_COLUMNS}) VALUES (${[
            r.network, r.timestamp, r.date, r.thread, r.contact, r.isGroup, r.sender,
            r.direction, r.msgType, r.mediaKind, r.text, r.charCount, r.wordCount,
            r.emojiCount, r.hasQuestion, r.reactionCount, r.reactions, r.isUnsent,
            r.gapSeconds, r.replyDelaySeconds, r.isDoubleText, r.sessionId, r.isSessionStart,
        ].map(literal).join(', ')})`);
    }
    conn.query(messagesDedupeSql('messages', 'messages_incoming'));
    conn.query('DROP TABLE IF EXISTS messages_incoming');
    conn.query('UPDATE messages SET msg_index = rowid');
}

function count(where = '1=1'): number {
    const [row] = conn.query(`SELECT COUNT(*) AS n FROM messages WHERE ${where}`)
        .toArray().map((r: any) => r.toJSON());
    return Number(row.n);
}

const MESSENGER = buildMessageRows([thread('messenger', 'Alice', ['hi', 'hey', 'how are you'])]).rows;
const WHATSAPP = buildMessageRows([thread('whatsapp', 'Bob', ['yo', 'sup'])]).rows;

beforeAll(async () => {
    db = await duckdb.createDuckDB(BUNDLES, new duckdb.VoidLogger(), duckdb.NODE_RUNTIME);
    await db.instantiate(() => { });
    conn = db.connect();
});

beforeEach(() => {
    conn.query('DROP TABLE IF EXISTS messages');
    conn.query(`CREATE TABLE messages (${SCHEMA})`);
});

afterAll(() => {
    conn?.close();
    db?.terminate?.();
});

describe('incremental message import', () => {
    it('stores every message of a first import', () => {
        importRows(MESSENGER);
        expect(count()).toBe(3);
    });

    it('is a no-op when the same export is imported twice', () => {
        importRows(MESSENGER);
        importRows(MESSENGER);
        expect(count()).toBe(3);
    });

    it('adds a second network without touching the first', () => {
        importRows(MESSENGER);
        importRows(WHATSAPP);

        expect(count()).toBe(5);
        expect(count("network = 'messenger'")).toBe(3);
        expect(count("network = 'whatsapp'")).toBe(2);
    });

    it('keeps identical text from two different services apart', () => {
        // The natural key includes the network, so the same words on WhatsApp and
        // on Messenger are two messages, not one.
        importRows(buildMessageRows([thread('messenger', 'Alice', ['hi'])]).rows);
        importRows(buildMessageRows([thread('whatsapp', 'Alice', ['hi'])]).rows);
        expect(count()).toBe(2);
    });

    it('appends genuinely new messages from a later export of the same thread', () => {
        importRows(MESSENGER);
        importRows(buildMessageRows([thread('messenger', 'Alice', ['hi', 'hey', 'how are you', 'still there?'])]).rows);
        expect(count()).toBe(4);
    });

    it('renumbers msg_index across everything stored', () => {
        importRows(MESSENGER);
        importRows(WHATSAPP);
        const [row] = conn
            .query('SELECT COUNT(DISTINCT msg_index) AS n, MAX(msg_index) AS max FROM messages')
            .toArray()
            .map((r: any) => r.toJSON());
        expect(Number(row.n)).toBe(5);
        expect(Number(row.max)).toBe(4);
    });
});
