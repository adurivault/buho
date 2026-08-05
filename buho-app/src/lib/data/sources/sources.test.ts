import { describe, it, expect } from 'vitest';
import { readThreads, routeEntries, buildArchiveContext } from './registry';
import { metaJsonParser } from './metaJson';
import { whatsappTextParser, inferDayFirst, parseWhatsappChat } from './whatsappText';
import { normalizedJsonParser } from './normalizedJson';
import type { ImportEntry } from './types';

/** An in-memory entry, standing in for a zip member or a picked file. */
function entry(path: string, content: string): ImportEntry {
    return {
        path,
        name: path.split('/').pop() ?? path,
        text: async () => content,
    };
}

// --- Fixtures --------------------------------------------------------------

/** Raw Meta thread file, mojibake included — exactly how Meta ships it. */
const META_THREAD = JSON.stringify({
    participants: [{ name: 'NoÃ©mi Renaudin' }, { name: 'Augustin' }],
    messages: [
        {
            sender_name: 'NoÃ©mi Renaudin',
            timestamp_ms: 1714550400000,
            content: "C'est notÃ© !",
            reactions: [{ reaction: 'â¤', actor: 'Augustin' }],
        },
        {
            sender_name: 'Augustin',
            timestamp_ms: 1714550700000,
            photos: [{ uri: 'messages/inbox/noemi_123/photos/1234_n.jpg' }],
        },
        {
            sender_name: 'Augustin',
            timestamp_ms: 1714550900000,
            audio_files: [{ uri: 'messages/inbox/noemi_123/audio/voice.opus' }],
        },
    ],
    title: 'NoÃ©mi Renaudin',
    thread_path: 'inbox/noemi_123',
});

const NORMALIZED_THREAD = JSON.stringify({
    participants: ['Augustin Du Rivet', 'David Nvs'],
    threadName: 'David Nvs_0',
    messages: [
        {
            senderName: 'Augustin Du Rivet',
            text: 'Hello',
            timestamp: 1714550400000,
            type: 'text',
            media: [],
            reactions: [],
            isUnsent: false,
        },
    ],
});

const WHATSAPP_IOS = `‎[06/03/2024, 14:32:01] Messages and calls are end-to-end encrypted.
[06/03/2024, 14:32:05] Alice: Salut !
[06/03/2024, 14:33:00] Augustin: Salut, ça va ?
On se voit demain ?
[06/03/2024, 14:35:00] Alice: ‎<attached: 00000042-PHOTO-2024-03-06-14-35-00.jpg>
[13/03/2024, 09:00:00] Alice: Coucou`;

const WHATSAPP_ANDROID = `06/03/2024, 14:32 - Alice: Salut !
06/03/2024, 14:33 - Augustin: Hello
07/03/2024, 08:15 - Alice: <Media omitted>`;

const WHATSAPP_US = `3/6/24, 2:32 PM - Alice: Hi there
3/6/24, 2:40 PM - Augustin: Hello
12/25/24, 9:00 AM - Alice: Merry Christmas`;

// --- Routing ---------------------------------------------------------------

describe('routeEntries', () => {
    it('sends each file to the parser that owns it', async () => {
        const entries = [
            entry('messages/inbox/noemi_123/message_1.json', META_THREAD),
            entry('David Nvs_0.json', NORMALIZED_THREAD),
            entry('WhatsApp Chat with Alice.txt', WHATSAPP_IOS),
        ];

        const { matched, unmatched } = await routeEntries(entries);
        const byParser = new Map([...matched].map(([p, e]) => [p.id, e.map((x) => x.name)]));

        expect(byParser.get('meta-json')).toEqual(['message_1.json']);
        expect(byParser.get('normalized-json')).toEqual(['David Nvs_0.json']);
        expect(byParser.get('whatsapp-text')).toEqual(['WhatsApp Chat with Alice.txt']);
        expect(unmatched).toHaveLength(0);
    });

    it('reports readable files it recognises nothing in, instead of swallowing them', async () => {
        const { matched, unmatched } = await routeEntries([
            entry('notes.txt', 'just some prose, no timestamps at all'),
            entry('settings.json', '{"theme":"dark"}'),
        ]);

        expect(matched.size).toBe(0);
        expect(unmatched.map((e) => e.name)).toEqual(['notes.txt', 'settings.json']);
    });

    it('never opens attachments', async () => {
        const exploding: ImportEntry = {
            path: 'media/photo.jpeg',
            name: 'photo.jpeg',
            text: async () => {
                throw new Error('binary read');
            },
        };
        const { matched, unmatched } = await routeEntries([exploding]);
        expect(matched.size).toBe(0);
        expect(unmatched).toHaveLength(0);
    });

    it('reads several services from one drop', async () => {
        const { threads } = await readThreads([
            entry('messages/inbox/noemi_123/message_1.json', META_THREAD),
            entry('WhatsApp Chat with Alice.txt', WHATSAPP_IOS),
        ]);

        expect(new Set(threads.map((t) => t.network))).toEqual(
            new Set(['unknown', 'whatsapp']),
        );
    });
});

// --- Meta ------------------------------------------------------------------

describe('metaJsonParser', () => {
    const ctx = buildArchiveContext([
        entry('your_facebook_activity/messages/inbox/noemi_123/message_1.json', META_THREAD),
    ]);

    it('repairs the latin1 mojibake Meta ships', async () => {
        const [thread] = await metaJsonParser.parse(
            [entry('messages/inbox/noemi_123/message_1.json', META_THREAD)],
            ctx,
        );
        expect(thread.threadName).toBe('Noémi Renaudin');
        expect(thread.messages[0].text).toBe("C'est noté !");
        expect(thread.messages[0].sender).toBe('Noémi Renaudin');
        expect(thread.messages[0].reactions).toEqual(['❤']);
    });

    it('collapses the attachment buckets into one media kind', async () => {
        const [thread] = await metaJsonParser.parse(
            [entry('messages/inbox/noemi_123/message_1.json', META_THREAD)],
            ctx,
        );
        expect(thread.messages.map((m) => m.mediaKind)).toEqual(['none', 'photo', 'voice']);
        expect(thread.messages.map((m) => m.kind)).toEqual(['text', 'media', 'media']);
    });

    it('merges message_1/message_2 of the same folder into one thread', async () => {
        const threads = await metaJsonParser.parse(
            [
                entry('messages/inbox/noemi_123/message_1.json', META_THREAD),
                entry('messages/inbox/noemi_123/message_2.json', META_THREAD),
            ],
            ctx,
        );
        expect(threads).toHaveLength(1);
        expect(threads[0].messages).toHaveLength(6);
    });

    it('claims a group thread whose participant list fills the whole peek', () => {
        // Real regression: a 40-person group spends the first 2 KB listing names,
        // so `sender_name` never appears in the peek and the content check fails.
        // 16 threads were being dropped from a real export because of it.
        const participants = Array.from({ length: 60 }, (_, i) => ({
            name: `Participant With A Fairly Long Name ${i}`,
        }));
        const bigGroup = JSON.stringify({
            participants,
            messages: [{ sender_name: 'Someone', timestamp_ms: 1714550400000, content: 'hi' }],
        });
        const entry = {
            path: 'your_facebook_activity/messages/inbox/bigparty_889510171093778/message_1.json',
            name: 'message_1.json',
            text: async () => bigGroup,
        };
        const peek = bigGroup.slice(0, 2048);

        expect(peek).not.toContain('"sender_name"'); // the trap
        expect(metaJsonParser.match(entry, peek)).toBeGreaterThan(0);
    });

    it('reads every mailbox, not just the inbox', () => {
        // `e2ee_cutover` holds everything said before a conversation was switched
        // to end-to-end encryption — years of history for some threads.
        for (const box of [
            'inbox',
            'e2ee_cutover',
            'archived_threads',
            'filtered_threads',
            'message_requests',
        ]) {
            const entry = {
                path: `your_facebook_activity/messages/${box}/someone_123/message_1.json`,
                name: 'message_1.json',
                text: async () => '{}',
            };
            expect(metaJsonParser.match(entry, '{}')).toBeGreaterThan(0);
        }
    });

    it('tells Instagram from Messenger by the paths around the thread', () => {
        const instagram = buildArchiveContext([
            entry('your_instagram_activity/messages/inbox/x/message_1.json', META_THREAD),
        ]);
        const messenger = buildArchiveContext([
            entry('your_facebook_activity/messages/inbox/x/message_1.json', META_THREAD),
        ]);
        const bare = buildArchiveContext([entry('messages/inbox/x/message_1.json', META_THREAD)]);

        expect(metaJsonParser.network(instagram)).toBe('instagram');
        expect(metaJsonParser.network(messenger)).toBe('messenger');
        // Nothing names the service: saying so beats guessing.
        expect(metaJsonParser.network(bare)).toBe('unknown');
    });
});

// --- Normalized ------------------------------------------------------------

describe('normalizedJsonParser', () => {
    it('claims the camelCase format and not the Meta one', () => {
        const normalized = entry('David Nvs_0.json', NORMALIZED_THREAD);
        const meta = entry('message_1.json', META_THREAD);

        expect(normalizedJsonParser.match(normalized, NORMALIZED_THREAD)).toBeGreaterThan(0);
        expect(normalizedJsonParser.match(meta, META_THREAD)).toBe(0);
        expect(metaJsonParser.match(normalized, NORMALIZED_THREAD)).toBe(0);
    });

    it('strips the numeric suffix from the thread name', async () => {
        const [thread] = await normalizedJsonParser.parse(
            [entry('David Nvs_0.json', NORMALIZED_THREAD)],
            buildArchiveContext([]),
        );
        expect(thread.threadName).toBe('David Nvs');
        expect(thread.network).toBe('messenger');
    });
});

// --- WhatsApp --------------------------------------------------------------

describe('whatsappTextParser', () => {
    const file = entry('WhatsApp Chat with Alice.txt', WHATSAPP_IOS);

    it('reads the iOS bracket grammar and drops the system notice', () => {
        const thread = parseWhatsappChat(WHATSAPP_IOS, file)!;
        expect(thread.network).toBe('whatsapp');
        expect(thread.threadName).toBe('Alice');
        // 4 real messages; the encryption notice has no sender and is dropped.
        expect(thread.messages).toHaveLength(4);
        expect(thread.participants.sort()).toEqual(['Alice', 'Augustin']);
    });

    it('folds a continuation line into the message above it', () => {
        const thread = parseWhatsappChat(WHATSAPP_IOS, file)!;
        expect(thread.messages[1].text).toBe('Salut, ça va ?\nOn se voit demain ?');
    });

    it('reads the Android dash grammar', () => {
        const thread = parseWhatsappChat(WHATSAPP_ANDROID, entry('_chat.txt', WHATSAPP_ANDROID))!;
        expect(thread.messages).toHaveLength(3);
        expect(thread.messages[2].mediaKind).toBe('other');
        expect(thread.messages[2].kind).toBe('media');
    });

    it('reads a 12-hour clock and converts PM correctly', () => {
        const thread = parseWhatsappChat(WHATSAPP_US, entry('_chat.txt', WHATSAPP_US))!;
        const first = new Date(thread.messages[0].timestampMs);
        expect(first.getHours()).toBe(14);
        expect(first.getMinutes()).toBe(32);
    });

    it('infers month-first when a second component exceeds 12', () => {
        const thread = parseWhatsappChat(WHATSAPP_US, entry('_chat.txt', WHATSAPP_US))!;
        // "12/25/24" can only be 25 December, which settles the whole file as M/D.
        const christmas = new Date(thread.messages[2].timestampMs);
        expect(christmas.getMonth()).toBe(11);
        expect(christmas.getDate()).toBe(25);
        // …and therefore "3/6/24" is 6 March, not 3 June.
        const first = new Date(thread.messages[0].timestampMs);
        expect(first.getMonth()).toBe(2);
        expect(first.getDate()).toBe(6);
    });

    it('infers day-first when a first component exceeds 12', () => {
        const thread = parseWhatsappChat(WHATSAPP_IOS, file)!;
        // "13/03/2024" pins the file to D/M.
        const last = new Date(thread.messages[3].timestampMs);
        expect(last.getDate()).toBe(13);
        expect(last.getMonth()).toBe(2);
    });

    it('defaults to day-first when nothing disambiguates', () => {
        expect(inferDayFirst([{ day: 6, month: 3 } as never])).toBe(true);
    });

    it('classifies an attachment by its extension', () => {
        const thread = parseWhatsappChat(WHATSAPP_IOS, file)!;
        expect(thread.messages[2].mediaKind).toBe('photo');
    });

    it('does not claim a prose .txt that merely opens with a date', () => {
        const prose = entry('notes.txt', 'Bought milk today.\nCalled the plumber.');
        expect(whatsappTextParser.match(prose, 'Bought milk today.')).toBe(0);
    });
});
