import { describe, expect, it } from 'vitest';
import { conversationRows, serviceRows } from './tracks';
import type { ConversationMessages } from './timeline';

/** A conversation where every message is received, unless `sent` says which were yours. */
const talk = (
    contact: string,
    minutes: number[],
    sent: number[] = [],
    text = 'salut'
): ConversationMessages => ({
    conversation: `whatsapp:${contact}`,
    contact,
    count: minutes.length,
    sent: sent.length,
    received: minutes.length - sent.length,
    messages: minutes.map((minute) => ({
        minute,
        sent: sent.includes(minute),
        sender: sent.includes(minute) ? 'Me' : contact,
        text,
    })),
});

describe('conversationRows', () => {
    it('keeps the busiest conversations and folds the rest into Others', () => {
        const rows = conversationRows([
            talk('Léa', [540, 545, 546, 600]),
            talk('Hugo', [700, 701, 702]),
            talk('Camille', [800, 801]),
            talk('Inès', [900]),
            talk('Théo', [901.5]),
        ]);

        expect(rows.map((r) => [r.label, r.count])).toEqual([
            ['Léa', 4],
            ['Hugo', 3],
            ['Camille', 2],
            ['Others', 2],
        ]);
        expect(rows[3].ticks).toEqual([
            { minute: 900, count: 1, sent: 0, tip: '15:00 · Inès\nInès: salut' },
            { minute: 901, count: 1, sent: 0, tip: '15:01 · Théo\nThéo: salut' },
        ]);
    });

    it('does not fold a single conversation into Others', () => {
        const rows = conversationRows([
            talk('A', [1, 2, 3]),
            talk('B', [4, 5]),
            talk('C', [6]),
            talk('D', [7]),
        ]);
        expect(rows.map((r) => r.label)).toEqual(['A', 'B', 'C', 'D']);
    });

    it('draws the messages of one minute as one tick, counting who wrote', () => {
        const [row] = conversationRows([talk('Léa', [545.2, 545.9, 546], [545.9])]);
        expect(row.ticks.map((t) => [t.minute, t.count, t.sent])).toEqual([
            [545, 2, 1],
            [546, 1, 0],
        ]);
        // When and with whom, then the start of each message and who wrote it.
        expect(row.ticks[0].tip).toBe('09:05 · Léa\nLéa: salut\nYou: salut');
    });

    it('quotes the start of a long message, cut at a word, and counts the rest', () => {
        const long =
            'On se retrouve devant la gare vers sept heures et on file directement au concert ensemble';
        const [row] = conversationRows([
            talk('Léa', [600, 600.1, 600.2, 600.3, 600.4, 600.5], [], long),
        ]);
        const lines = row.ticks[0].tip.split('\n');

        expect(lines).toHaveLength(6); // the heading, four quotes, "+2 more"
        expect(lines[1]).toBe(
            'Léa: On se retrouve devant la gare vers sept heures et on file directement au…'
        );
        expect(lines[5]).toBe('+2 more');
    });
});

describe('serviceRows', () => {
    it('groups the entries by service, each tick saying what was done', () => {
        const rows = serviceRows(
            [
                { minute: 450, service: 'search', action: 'searched', label: 'weather tomorrow' },
                {
                    minute: 1335,
                    service: 'youtube',
                    action: 'watched',
                    label: 'Ten-minute stretch',
                },
                { minute: 451, service: 'search', action: 'searched', label: 'train times' },
            ],
            (service) => (service === 'search' ? 'Search' : 'YouTube')
        );

        expect(rows.map((r) => [r.label, r.count])).toEqual([
            ['Search', 2],
            ['YouTube', 1],
        ]);
        expect(rows[0].ticks[0].tip).toBe('07:30 · 1 entry · Searched weather tomorrow');
    });
});
