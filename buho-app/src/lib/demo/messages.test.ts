import { describe, expect, it } from 'vitest';
import { generateConversations } from './messages';
import { SELF } from './people';
import { buildMessageRows } from '#lib/data/import/buildRows.ts';
import { moduleById } from '#lib/data/modules.ts';
import type { MessageRow } from '#lib/types/messages.ts';

/**
 * These assert the *shape* of the history, not its contents.
 *
 * A generated history passes every test that can be written about its validity
 * — real timestamps, real senders — and still makes the app look broken, because
 * nothing checks that it has a day, a ranking or a past. Each number below is
 * one a chart in `/messages` depends on, with a threshold set well clear of what
 * uniform noise produces, so this suite fails if the model ever flattens out.
 */

const UNTIL = new Date('2026-01-01');
const threads = generateConversations({ seed: 7, years: 8, messages: 20_000, until: UNTIL });
const { rows, self } = buildMessageRows(threads);

const by = <T>(pick: (row: MessageRow) => T) => {
    const counts = new Map<T, number>();
    for (const row of rows) counts.set(pick(row), (counts.get(pick(row)) ?? 0) + 1);
    return counts;
};

const share = (predicate: (row: MessageRow) => boolean) =>
    rows.filter(predicate).length / rows.length;

describe('the sample goes through the real import path', () => {
    it('is recognised as the owner speaking, network by network', () => {
        // The whole direction column depends on `detectSelf` picking the right
        // participant, and it runs per network precisely because the sample
        // spells the owner differently on WhatsApp than on Meta.
        expect(self.whatsapp).toBe(SELF.whatsapp);
        expect(self.messenger).toBe(SELF.messenger);
        expect(self.instagram).toBe(SELF.instagram);
    });

    it('derives both directions, and neither dominates outright', () => {
        const sent = share((row) => row.direction === 'sent');
        expect(sent).toBeGreaterThan(0.3);
        expect(sent).toBeLessThan(0.7);
    });

    it('builds sessions and reply delays rather than leaving them null', () => {
        expect(share((row) => row.isSessionStart)).toBeGreaterThan(0.02);
        expect(rows.some((row) => row.isDoubleText)).toBe(true);
        expect(rows.filter((row) => row.replyDelaySeconds !== null).length).toBeGreaterThan(
            rows.length * 0.4
        );
    });

    it('declares the module it fills', () => {
        expect(moduleById('messages').hasDemo).toBe(true);
    });
});

describe('the same seed gives the same conversations', () => {
    it('is reproducible', () => {
        const again = generateConversations({ seed: 7, years: 8, messages: 20_000, until: UNTIL });
        expect(again).toHaveLength(threads.length);
        expect(again[0].messages[0]).toEqual(threads[0].messages[0]);
    });

    it('and a different seed gives different ones', () => {
        const other = generateConversations({ seed: 8, years: 8, messages: 20_000, until: UNTIL });
        expect(other[0].messages[0]).not.toEqual(threads[0].messages[0]);
    });
});

describe('the structure the charts are built to find', () => {
    it('lands near the size it was asked for', () => {
        expect(rows.length).toBeGreaterThan(14_000);
        expect(rows.length).toBeLessThan(28_000);
    });

    /** "Who you talk to": one or two people far ahead, and a long tail. */
    it('ranks contacts as a power law, not a flat wall', () => {
        const counts = [...by((row) => row.contact).values()].sort((a, b) => b - a);
        expect(counts.length).toBeGreaterThan(12);
        expect(counts[0]).toBeGreaterThan(counts[4] * 2);
        expect(counts.at(-1)!).toBeLessThan(counts[0] / 10);
    });

    /** "Friendships over time": people arrive and leave. */
    it('gives contacts eras rather than running them all flat', () => {
        const spans = [...by((row) => row.contact).keys()].map((contact) => {
            const dates = rows.filter((row) => row.contact === contact).map((row) => row.date);
            return {
                first: dates.reduce((a, b) => (a < b ? a : b)),
                last: dates.reduce((a, b) => (a > b ? a : b)),
            };
        });
        // Not everybody starts on day one, and not everybody is still there.
        expect(new Set(spans.map((span) => span.first.slice(0, 7))).size).toBeGreaterThan(6);
        expect(spans.filter((span) => span.last < '2025-01-01').length).toBeGreaterThan(2);
    });

    /** The constellation's vertical axis: a day has a shape, and the night is quiet. */
    it('puts the conversation in the evening and almost none of it at 4am', () => {
        const hours = by((row) => Number(row.timestamp.slice(11, 13)));
        const total = rows.length;
        const at = (hour: number) => (hours.get(hour) ?? 0) / total;

        expect(at(4)).toBeLessThan(0.006);
        expect(at(20)).toBeGreaterThan(at(4) * 8);
    });

    /** The constellation again: a history with holes in it, not a smear. */
    it('leaves whole days out of the history', () => {
        const days = new Set(rows.map((row) => row.date));
        const span = [...days].sort();
        const first = Date.parse(span[0]);
        const last = Date.parse(span.at(-1)!);
        const covered = days.size / Math.round((last - first) / 86_400_000);
        expect(covered).toBeLessThan(0.98);
    });

    /** "Who chases whom" and "who answers faster": both are per contact. */
    it('varies the balance and the reply speed between contacts', () => {
        const balances: number[] = [];
        const medians: number[] = [];
        for (const contact of by((row) => row.contact).keys()) {
            const mine = rows.filter((row) => row.contact === contact);
            if (mine.length < 200) continue;
            balances.push(mine.filter((row) => row.direction === 'sent').length / mine.length);
            const delays = mine
                .filter((row) => row.direction === 'received' && row.replyDelaySeconds !== null)
                .map((row) => row.replyDelaySeconds!)
                .sort((a, b) => a - b);
            if (delays.length > 20) medians.push(delays[Math.floor(delays.length / 2)]);
        }
        expect(Math.max(...balances) - Math.min(...balances)).toBeGreaterThan(0.15);
        expect(Math.max(...medians)).toBeGreaterThan(Math.min(...medians) * 2);
    });

    /** "Who reaches out first": who opens is its own trait, not the balance again. */
    it('varies who opens the conversations, independently of who writes the most', () => {
        const opened: number[] = [];
        for (const contact of by((row) => row.contact).keys()) {
            const mine = rows.filter((row) => row.contact === contact);
            const starts = mine.filter((row) => row.isSessionStart);
            if (starts.length < 30) continue;
            opened.push(starts.filter((row) => row.direction === 'sent').length / starts.length);
        }
        // Someone you always call, someone who always calls you.
        expect(Math.min(...opened)).toBeLessThan(0.3);
        expect(Math.max(...opened)).toBeGreaterThan(0.7);
    });

    /**
     * Reactions are a fact about the export, not a taste: WhatsApp transcripts
     * carry none at all. A sample that put them there would be teaching people
     * to expect a column their own import cannot fill.
     */
    it('reacts on Meta exports and never on WhatsApp', () => {
        const meta = rows.filter((row) => row.network !== 'whatsapp');
        expect(meta.some((row) => row.reactionCount > 0)).toBe(true);
        expect(
            rows.filter((row) => row.network === 'whatsapp').every((row) => row.reactionCount === 0)
        ).toBe(true);
    });

    it('covers every network, each in its own era', () => {
        const networks = by((row) => row.network);
        expect([...networks.keys()].sort()).toEqual(['instagram', 'messenger', 'whatsapp']);

        const lastOf = (network: string) =>
            rows
                .filter((row) => row.network === network)
                .reduce((a, row) => (row.date > a ? row.date : a), '');
        // Messenger is the past; WhatsApp is now.
        expect(lastOf('messenger') < lastOf('whatsapp')).toBe(true);
    });

    it('holds groups as well as one-to-one threads', () => {
        expect(share((row) => row.isGroup)).toBeGreaterThan(0.02);
        // A group is loud, and you are a smaller part of it.
        const groups = rows.filter((row) => row.isGroup);
        expect(
            groups.filter((row) => row.direction === 'sent').length / groups.length
        ).toBeLessThan(0.35);
        expect(new Set(groups.map((row) => row.sender)).size).toBeGreaterThan(4);
    });

    it('carries attachments, links and the odd unsent message', () => {
        expect(share((row) => row.mediaKind !== 'none')).toBeGreaterThan(0.02);
        expect(rows.some((row) => row.mediaKind === 'voice')).toBe(true);
        expect(rows.some((row) => row.msgType === 'link')).toBe(true);
        expect(rows.some((row) => row.isUnsent)).toBe(true);
    });

    /** Length buckets, the words measure and `has_question` all live here. */
    it('writes messages of very different lengths', () => {
        const words = rows.filter((row) => row.msgType === 'text').map((row) => row.wordCount);
        const sorted = [...words].sort((a, b) => a - b);
        const median = sorted[Math.floor(sorted.length / 2)];

        expect(median).toBeLessThan(12);
        expect(Math.max(...words)).toBeGreaterThan(median * 5);
        expect(share((row) => row.hasQuestion)).toBeGreaterThan(0.05);
        expect(rows.some((row) => row.emojiCount > 0)).toBe(true);
    });
});
