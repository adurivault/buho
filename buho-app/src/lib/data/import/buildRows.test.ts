import { describe, it, expect } from 'vitest';
import { buildMessageRows } from './buildRows';
import type { ParsedMessage, ParsedThread } from '$lib/types/messages';

const T0 = new Date(2024, 4, 1, 10, 0, 0).getTime();

function msg(sender: string, offsetMin: number, text = 'hi'): ParsedMessage {
    return {
        sender,
        text,
        timestampMs: T0 + offsetMin * 60_000,
        kind: 'text',
        mediaKind: 'none',
        reactions: [],
        isUnsent: false,
    };
}

function thread(
    sourceId: string,
    contact: string,
    me: string,
    messages: ParsedMessage[],
): ParsedThread {
    return {
        network: 'messenger',
        sourceId,
        threadName: contact,
        participants: [me, contact],
        isGroup: false,
        messages,
    };
}

describe('buildMessageRows — identity across exports', () => {
    /**
     * Meta ships the same account under two different display names: the standard
     * download says "Augustin Durivault", the secure-storage download says
     * "Augustin Du Rivet". Both are Messenger. Voting across them elects one and
     * marks every message of the other export as received.
     */
    it('settles who the owner is per export, not per network', () => {
        const standard = [
            thread('meta-json', 'Alice', 'Augustin Durivault', [
                msg('Augustin Durivault', 0),
                msg('Alice', 1),
                msg('Augustin Durivault', 2),
            ]),
        ];
        const encrypted = [
            thread('normalized-json', 'Bob', 'Augustin Du Rivet', [
                msg('Augustin Du Rivet', 10),
                msg('Bob', 11),
            ]),
        ];

        const { rows } = buildMessageRows([...standard, ...encrypted]);

        expect(rows.filter((r) => r.direction === 'sent')).toHaveLength(3);
        // The name from the other export must not be mistaken for a contact.
        expect(rows.filter((r) => r.sender === 'Augustin Du Rivet')[0].direction).toBe('sent');
    });

    it('never treats one of the owner names as a contact', () => {
        const { rows } = buildMessageRows([
            thread('meta-json', 'Alice', 'Augustin Durivault', [msg('Augustin Durivault', 0), msg('Alice', 1)]),
            thread('normalized-json', 'Alice', 'Augustin Du Rivet', [msg('Augustin Du Rivet', 5), msg('Alice', 6)]),
        ]);

        expect(new Set(rows.map((r) => r.contact))).toEqual(new Set(['Alice']));
    });

    it('reports the owner name from the export that carried the most messages', () => {
        const { self } = buildMessageRows([
            thread('meta-json', 'Alice', 'Augustin Durivault', [
                msg('Augustin Durivault', 0),
                msg('Alice', 1),
                msg('Augustin Durivault', 2),
            ]),
            thread('normalized-json', 'Bob', 'Augustin Du Rivet', [msg('Augustin Du Rivet', 10)]),
        ]);

        expect(self.messenger).toBe('Augustin Durivault');
    });

    it('still works with a single export', () => {
        const { rows, self } = buildMessageRows([
            thread('meta-json', 'Alice', 'Me', [msg('Me', 0), msg('Alice', 1)]),
        ]);

        expect(self.messenger).toBe('Me');
        expect(rows.map((r) => r.direction)).toEqual(['sent', 'received']);
    });
});
