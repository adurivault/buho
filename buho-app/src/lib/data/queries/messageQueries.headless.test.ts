// @vitest-environment node
//
// Headless test of the messages SQL. DuckDB-WASM's worker bundle can't run in
// JSDOM, but `duckdb-node-blocking` runs the same wasm core synchronously in
// Node, so every statement in messageQueries.ts is exercised against the real
// engine — QUANTILE_CONT with FILTER, UNNEST(STRING_SPLIT(…)) and the zero-filled
// month CROSS JOIN all behave in ways worth proving rather than assuming.
//
// `../db` is mocked so the exported query functions run unchanged: only their
// transport is swapped for the Node connection.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';
import { parseMessagesData } from '../parseMessages';
import type { MessageRow, RawMessage, RawMessageThread } from '$lib/types/messages';

const require = createRequire(import.meta.url);
const DIST = path.resolve(process.cwd(), 'node_modules/@duckdb/duckdb-wasm/dist');
const duckdb = require(path.join(DIST, 'duckdb-node-blocking.cjs'));
const BUNDLES = {
    mvp: { mainModule: path.join(DIST, 'duckdb-mvp.wasm'), mainWorker: null },
    eh: { mainModule: path.join(DIST, 'duckdb-eh.wasm'), mainWorker: null },
};

let db: any;
let conn: any;

/** Mirrors db.ts's camelCase mapping of result columns. */
const camel = (s: string) => s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());

const runQuery = vi.hoisted(() => vi.fn());
vi.mock('../db', () => ({ query: runQuery, queryColumnar: vi.fn() }));

const {
    getMessageMacroStats,
    getMonthlyMessagesByContact,
    getHourWeekdayGrid,
    getDailyMessageCounts,
    getContactBalance,
    getContactReplyTimes,
    getMonthlyVolumeForTopContacts,
    getReactionBreakdown,
    getContactReactionRates,
    getMessageBasePoints,
    getMessageTimeDomain,
} = await import('./messageQueries');

const ME = 'Augustin Du Rivet';
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
/** 2024-05-01 10:00 local — every offset below is relative to this. */
const T0 = new Date(2024, 4, 1, 10, 0, 0).getTime();

function message(sender: string, offsetMs: number, extra: Partial<RawMessage> = {}): RawMessage {
    return {
        senderName: sender,
        text: 'hello there',
        timestamp: T0 + offsetMs,
        type: 'text',
        media: [],
        reactions: [],
        isUnsent: false,
        ...extra,
    };
}

/**
 * Two contacts with deliberately different profiles:
 *   - Alice: chatty, I answer her in 2 min, she answers me in 30 min, she reacts;
 *   - Bob: two short sessions months apart, one of them opened by him.
 */
const THREADS: RawMessageThread[] = [
    {
        participants: [ME, 'Alice'],
        threadName: 'Alice_0',
        messages: [
            message(ME, 0, { reactions: [{ actor: 'Alice', reaction: '❤' }] }),
            message('Alice', 30 * MINUTE),
            message(ME, 32 * MINUTE),
            message('Alice', 62 * MINUTE, { reactions: [{ actor: ME, reaction: '😆' }] }),
            message(ME, 64 * MINUTE, {
                type: 'media',
                media: [{ uri: 'media/x.ogg' }],
                text: '',
                reactions: [{ actor: 'Alice', reaction: '❤' }],
            }),
            // next day → a new session, opened by Alice
            message('Alice', DAY),
            message(ME, DAY + 2 * MINUTE, { text: 'a much longer answer than the others, by far' }),
        ],
    },
    {
        participants: [ME, 'Bob'],
        threadName: 'Bob_1',
        messages: [
            message('Bob', 3 * HOUR),
            message(ME, 3 * HOUR + 10 * MINUTE),
            // 90 days of silence, then Bob revives the thread
            message('Bob', 90 * DAY),
            message(ME, 90 * DAY + 5 * MINUTE),
        ],
    },
];

let rows: MessageRow[];

beforeAll(async () => {
    db = await duckdb.createDuckDB(BUNDLES, new duckdb.VoidLogger(), duckdb.NODE_RUNTIME);
    await db.instantiate(() => { });
    conn = db.connect();

    conn.query(`CREATE TABLE messages (
        network VARCHAR, timestamp TIMESTAMP, date DATE, thread VARCHAR, contact VARCHAR, is_group BOOLEAN,
        sender VARCHAR, direction VARCHAR, msg_type VARCHAR, media_kind VARCHAR, text VARCHAR,
        char_count INTEGER, word_count INTEGER, emoji_count INTEGER, has_question BOOLEAN,
        reaction_count INTEGER, reactions VARCHAR, is_unsent BOOLEAN, gap_seconds DOUBLE,
        reply_delay_seconds DOUBLE, is_double_text BOOLEAN, session_id INTEGER,
        is_session_start BOOLEAN, msg_index INTEGER)`);

    rows = parseMessagesData(THREADS);
    const literal = (v: unknown) =>
        v === null || v === undefined
            ? 'NULL'
            : typeof v === 'string'
                ? `'${v.replace(/'/g, "''")}'`
                : typeof v === 'boolean'
                    ? (v ? 'TRUE' : 'FALSE')
                    : String(v);

    for (const [i, r] of rows.entries()) {
        conn.query(`INSERT INTO messages VALUES (${[
            r.network, r.timestamp, r.date, r.thread, r.contact, r.isGroup, r.sender, r.direction,
            r.msgType, r.mediaKind, r.text, r.charCount, r.wordCount, r.emojiCount,
            r.hasQuestion, r.reactionCount, r.reactions, r.isUnsent, r.gapSeconds,
            r.replyDelaySeconds, r.isDoubleText, r.sessionId, r.isSessionStart, i,
        ].map(literal).join(', ')})`);
    }

    runQuery.mockImplementation(async (sql: string) =>
        conn
            .query(sql)
            .toArray()
            .map((r: any) =>
                Object.fromEntries(
                    Object.entries(r.toJSON()).map(([k, v]) => [
                        camel(k),
                        typeof v === 'bigint' ? Number(v) : v,
                    ]),
                ),
            ),
    );
});

afterAll(() => {
    conn?.close();
    db?.terminate?.();
});

describe('getMessageMacroStats', () => {
    it('counts messages, contacts and conversations', async () => {
        const stats = await getMessageMacroStats();
        expect(stats.totalMessages).toBe(11);
        expect(stats.sentMessages).toBe(6);
        expect(stats.receivedMessages).toBe(5);
        expect(stats.contacts).toBe(2);
        // Alice: 2 sessions, Bob: 2 sessions (90 days apart)
        expect(stats.conversations).toBe(4);
        expect(stats.voiceNotes).toBe(1);
        expect(stats.mediaMessages).toBe(1);
    });

    it('attributes reactions to the side that received them', async () => {
        const stats = await getMessageMacroStats();
        expect(stats.reactionsReceived).toBe(2); // Alice reacted twice to me
        expect(stats.reactionsGiven).toBe(1); // I reacted once to Alice
    });

    it('returns plain numbers for the aggregates, not BigInt', async () => {
        const stats = await getMessageMacroStats();
        expect(typeof stats.totalMessages).toBe('number');
        expect(typeof stats.words).toBe('number');
        expect(Number.isFinite(stats.words)).toBe(true);
        expect(stats.words).toBeGreaterThan(0);
    });

    it('reads medians per side, ignoring session openers', async () => {
        const stats = await getMessageMacroStats();
        // My replies: 2 min (to Alice ×2), 10 min and 5 min (to Bob) → median 2–10 min
        expect(stats.myMedianReplySeconds).not.toBeNull();
        expect(stats.myMedianReplySeconds!).toBeGreaterThanOrEqual(120);
        expect(stats.myMedianReplySeconds!).toBeLessThanOrEqual(600);
        // Alice answers in 30 min both times; Bob never answers inside a session.
        expect(stats.theirMedianReplySeconds).toBe(30 * 60);
    });

    it('reports the covered span', async () => {
        const stats = await getMessageMacroStats();
        expect(stats.firstDay).toBe('2024-05-01');
        expect(stats.lastDay).toBe('2024-07-30');
    });
});

describe('getMonthlyMessagesByContact', () => {
    it('buckets messages by month and contact', async () => {
        const monthly = await getMonthlyMessagesByContact();
        const may = monthly.filter((r) => r.month === '2024-05-01');
        expect(may.find((r) => r.name === 'Alice')?.messages).toBe(7);
        expect(may.find((r) => r.name === 'Bob')?.messages).toBe(2);
        // Bob's revival lands 90 days later, in a different month
        expect(monthly.filter((r) => r.name === 'Bob')).toHaveLength(2);
    });
});

describe('getHourWeekdayGrid', () => {
    it('splits each (weekday, hour) cell by direction', async () => {
        const grid = await getHourWeekdayGrid();
        const total = grid.reduce((s, c) => s + c.messages, 0);
        expect(total).toBe(11);
        expect(new Set(grid.map((c) => c.direction))).toEqual(new Set(['sent', 'received']));
        for (const cell of grid) {
            expect(cell.hour).toBeGreaterThanOrEqual(0);
            expect(cell.hour).toBeLessThanOrEqual(23);
        }
    });
});

describe('getDailyMessageCounts', () => {
    it('returns one row per active day, sent + received = messages', async () => {
        const days = await getDailyMessageCounts();
        expect(days.map((d) => d.date)).toEqual(['2024-05-01', '2024-05-02', '2024-07-30']);
        for (const day of days) {
            expect(day.sent + day.received).toBe(day.messages);
        }
        expect(days[0].contacts).toBe(2);
    });
});

describe('getContactBalance', () => {
    it('splits volume and session openings per contact', async () => {
        const balance = await getContactBalance();
        const alice = balance.find((b) => b.contact === 'Alice')!;
        expect(alice.messages).toBe(7);
        expect(alice.sent + alice.received).toBe(alice.messages);
        expect(alice.sessions).toBe(2);
        expect(alice.sessionsIStarted).toBe(1); // Alice opened the second one

        const bob = balance.find((b) => b.contact === 'Bob')!;
        expect(bob.sessions).toBe(2);
        expect(bob.sessionsIStarted).toBe(0); // Bob opened both
    });

    it('orders contacts by volume', async () => {
        const balance = await getContactBalance();
        expect(balance.map((b) => b.contact)).toEqual(['Alice', 'Bob']);
    });
});

describe('getContactReplyTimes', () => {
    it('drops contacts below the minimum number of replies on either side', async () => {
        // Bob never replies inside a session, so he can never qualify.
        const strict = await getContactReplyTimes(5);
        expect(strict).toHaveLength(0);

        const loose = await getContactReplyTimes(1);
        expect(loose.map((r) => r.contact)).toEqual(['Alice']);
    });

    it('reads a median per side', async () => {
        const [alice] = await getContactReplyTimes(1);
        expect(alice.myMedianSeconds).toBe(2 * 60);
        expect(alice.theirMedianSeconds).toBe(30 * 60);
        // Three of my messages answer Alice inside a session; the fourth opens one.
        expect(alice.myReplies).toBe(3);
        expect(alice.theirReplies).toBe(2);
    });
});

describe('getMonthlyVolumeForTopContacts', () => {
    it('zero-fills every month of the span for each contact', async () => {
        const rowsOut = await getMonthlyVolumeForTopContacts(15);
        // May, June, July × 2 contacts
        expect(rowsOut).toHaveLength(6);
        const bobJune = rowsOut.find((r) => r.name === 'Bob' && r.month === '2024-06-01');
        expect(bobJune?.messages).toBe(0);
        expect(rowsOut.find((r) => r.name === 'Bob' && r.month === '2024-07-01')?.messages).toBe(2);
    });

    it('keeps only the busiest contacts', async () => {
        const rowsOut = await getMonthlyVolumeForTopContacts(1);
        expect(new Set(rowsOut.map((r) => r.name))).toEqual(new Set(['Alice']));
    });
});

describe('getReactionBreakdown', () => {
    it('explodes the reaction column into one row per emoji, split by side', async () => {
        const reactions = await getReactionBreakdown();
        const heart = reactions.find((r) => r.emoji === '❤')!;
        expect(heart.received).toBe(2);
        expect(heart.given).toBe(0);
        const laugh = reactions.find((r) => r.emoji === '😆')!;
        expect(laugh.given).toBe(1);
        expect(laugh.received).toBe(0);
    });
});

describe('getContactReactionRates', () => {
    it('rates reactions against the messages I sent', async () => {
        const [alice] = await getContactReactionRates(1);
        expect(alice.contact).toBe('Alice');
        expect(alice.messagesSent).toBe(4);
        expect(alice.reactionsReceived).toBe(2);
        expect(alice.ratePer100).toBe(50);
    });
});

describe('getMessageBasePoints', () => {
    it('returns one point per message with its dimension fields', async () => {
        const points = await getMessageBasePoints();
        expect(points).toHaveLength(11);
        expect(new Set(points.map((p) => p.fDirection))).toEqual(new Set(['Sent', 'Received']));
        expect(points.every((p) => p.matched)).toBe(true);
        expect(points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
    });

    it('buckets message length and flags reacted messages', async () => {
        const points = await getMessageBasePoints();
        const longest = points.find((p) => (p.metadata.text as string).startsWith('a much longer'))!;
        expect(longest.fLength).toBe('41–120');
        expect(points.filter((p) => p.fReacted === 'Reacted')).toHaveLength(3);
    });

    it('carries the voice note as its own media kind', async () => {
        const points = await getMessageBasePoints();
        expect(points.filter((p) => p.fMediaKind === 'voice')).toHaveLength(1);
    });
});

describe('getMessageTimeDomain', () => {
    it('spans the first and last day', async () => {
        const domain = await getMessageTimeDomain();
        expect(domain).not.toBeNull();
        const [min, max] = domain!;
        expect(max).toBeGreaterThan(min);
        expect(new Date(max).getTime() - new Date(min).getTime()).toBeCloseTo(90 * DAY, -6);
    });
});
