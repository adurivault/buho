import { describe, it, expect } from 'vitest';
import { parseMessagesData } from './parseMessages';
import type { RawMessage, RawMessageThread } from '$lib/types/messages';

const ME = 'Augustin Du Rivet';
const T0 = Date.UTC(2024, 4, 1, 10, 0, 0);
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

function message(sender: string, offsetMs: number, extra: Partial<RawMessage> = {}): RawMessage {
    return {
        senderName: sender,
        text: 'hello',
        timestamp: T0 + offsetMs,
        type: 'text',
        media: [],
        reactions: [],
        isUnsent: false,
        ...extra,
    };
}

function thread(other: string, messages: RawMessage[], index = 0): RawMessageThread {
    return {
        participants: [ME, other],
        threadName: `${other}_${index}`,
        messages,
    };
}

describe('parseMessagesData', () => {
    it('rejects non-array input', () => {
        expect(() => parseMessagesData(null as never)).toThrow();
        expect(() => parseMessagesData({} as never)).toThrow();
        expect(parseMessagesData([])).toEqual([]);
    });

    it('detects the export owner and labels directions', () => {
        const rows = parseMessagesData([
            thread('David Nvs', [message(ME, 0), message('David Nvs', MINUTE)]),
            thread('Lea Bettini', [message(ME, 0)], 1),
        ]);

        expect(rows.map((r) => r.direction)).toEqual(['sent', 'received', 'sent']);
    });

    it('strips the numeric suffix from the thread name and names the contact', () => {
        const [row] = parseMessagesData([thread('David Nvs', [message(ME, 0)], 12)]);
        expect(row.thread).toBe('David Nvs');
        expect(row.contact).toBe('David Nvs');
        expect(row.isGroup).toBe(false);
    });

    it('treats a 3+ participant thread as a group named after the thread', () => {
        const [row] = parseMessagesData([
            {
                participants: [ME, 'David Nvs', 'Lea Bettini'],
                threadName: 'Les copains_4',
                messages: [message(ME, 0)],
            },
        ]);
        expect(row.isGroup).toBe(true);
        expect(row.contact).toBe('Les copains');
    });

    it('sorts messages chronologically and derives the gap', () => {
        const rows = parseMessagesData([
            thread('David Nvs', [message('David Nvs', 5 * MINUTE), message(ME, 0)]),
        ]);

        expect(rows[0].sender).toBe(ME);
        expect(rows[0].gapSeconds).toBeNull();
        expect(rows[1].gapSeconds).toBe(300);
    });

    it('records a reply delay only when the speaker changes', () => {
        const rows = parseMessagesData([
            thread('David Nvs', [
                message(ME, 0),
                message(ME, 2 * MINUTE),
                message('David Nvs', 10 * MINUTE),
            ]),
        ]);

        expect(rows[0].replyDelaySeconds).toBeNull();
        expect(rows[1].replyDelaySeconds).toBeNull(); // same sender: not a turn-around
        expect(rows[2].replyDelaySeconds).toBe(8 * 60);
    });

    it('flags a double text only past the 5-minute threshold', () => {
        const rows = parseMessagesData([
            thread('David Nvs', [
                message(ME, 0),
                message(ME, 4 * MINUTE),
                message(ME, 20 * MINUTE),
            ]),
        ]);

        expect(rows[1].isDoubleText).toBe(false);
        expect(rows[2].isDoubleText).toBe(true);
    });

    it('opens a new session after a 6-hour silence', () => {
        const rows = parseMessagesData([
            thread('David Nvs', [
                message(ME, 0),
                message('David Nvs', 5 * HOUR),
                message('David Nvs', 12 * HOUR),
            ]),
        ]);

        expect(rows.map((r) => r.sessionId)).toEqual([1, 1, 2]);
        expect(rows.map((r) => r.isSessionStart)).toEqual([true, false, true]);
    });

    it('derives the media kind from the attachment extension', () => {
        const kinds = parseMessagesData([
            thread('David Nvs', [
                message(ME, 0, { type: 'media', media: [{ uri: 'media/a.jpeg' }] }),
                message(ME, MINUTE, { type: 'media', media: [{ uri: 'media/b.mp4' }] }),
                message(ME, 2 * MINUTE, { type: 'media', media: [{ uri: 'media/c.ogg' }] }),
                message(ME, 3 * MINUTE, { type: 'media', media: [{ uri: 'media/d.gif' }] }),
                message(ME, 4 * MINUTE, { type: 'text' }),
            ]),
        ]).map((r) => r.mediaKind);

        expect(kinds).toEqual(['photo', 'video', 'voice', 'gif', 'none']);
    });

    it('counts text metrics and reactions', () => {
        const [row] = parseMessagesData([
            thread('David Nvs', [
                message(ME, 0, {
                    text: 'ça va ? 😆😆',
                    reactions: [
                        { actor: 'David Nvs', reaction: '❤' },
                        { actor: 'David Nvs', reaction: '👍' },
                    ],
                }),
            ]),
        ]);

        expect(row.wordCount).toBe(4);
        expect(row.charCount).toBe('ça va ? 😆😆'.length);
        expect(row.emojiCount).toBe(2);
        expect(row.hasQuestion).toBe(true);
        expect(row.reactionCount).toBe(2);
        expect(row.reactions).toBe('❤,👍');
    });

    it('repairs Latin-1 mojibake in names and text', () => {
        const [row] = parseMessagesData([
            {
                participants: [ME, 'NoÃ©mi Renaudin'],
                threadName: 'NoÃ©mi Renaudin_14',
                messages: [message(ME, 0, { text: "c'est notÃ© !" })],
            },
        ]);

        expect(row.contact).toBe('Noémi Renaudin');
        expect(row.text).toBe("c'est noté !");
    });

    it('drops messages without a usable timestamp', () => {
        const rows = parseMessagesData([
            thread('David Nvs', [message(ME, 0), { senderName: ME, text: 'x' }]),
        ]);
        expect(rows).toHaveLength(1);
    });

    it('stores local wall-clock timestamps matching the date column', () => {
        const [row] = parseMessagesData([thread('David Nvs', [message(ME, 0)])]);
        expect(row.timestamp).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
        expect(row.date).toBe(row.timestamp.slice(0, 10));
    });
});
