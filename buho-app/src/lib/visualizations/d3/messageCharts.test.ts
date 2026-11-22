import { describe, it, expect } from 'vitest';
import {
    conversationBalanceChart,
    conversationStartersChart,
    replyTimeQuadrantChart,
    contactRidgelineChart,
    reactionBreakdownChart,
    formatDuration,
} from './messageCharts';
import { THEM_COLOR, YOU_COLOR } from './chart';
import type {
    ContactBalance,
    ContactReplyTimes,
    MonthlyContactCount,
    ReactionCount,
} from '#lib/data/queries/messageQueries.ts';

const balance: ContactBalance[] = [
    {
        contact: 'Alice',
        isGroup: false,
        messages: 200,
        sent: 140,
        received: 60,
        myDoubleTexts: 9,
        theirDoubleTexts: 2,
        sessions: 30,
        sessionsIStarted: 20,
        firstDay: '2024-05-01',
        lastDay: '2025-01-15',
    },
    {
        contact: 'Bob',
        isGroup: false,
        messages: 50,
        sent: 10,
        received: 40,
        myDoubleTexts: 0,
        theirDoubleTexts: 6,
        sessions: 8,
        sessionsIStarted: 1,
        firstDay: '2024-06-01',
        lastDay: '2024-12-01',
    },
    {
        contact: 'Book club',
        isGroup: true,
        messages: 900,
        sent: 60,
        received: 840,
        myDoubleTexts: 3,
        theirDoubleTexts: 40,
        sessions: 90,
        sessionsIStarted: 4,
        firstDay: '2024-05-01',
        lastDay: '2025-01-15',
    },
];

const replyTimes: ContactReplyTimes[] = [
    {
        contact: 'Alice',
        isGroup: false,
        messages: 200,
        myReplies: 40,
        theirReplies: 38,
        myMedianSeconds: 120,
        theirMedianSeconds: 900,
    },
    {
        contact: 'Bob',
        isGroup: false,
        messages: 50,
        myReplies: 10,
        theirReplies: 12,
        myMedianSeconds: 3600,
        theirMedianSeconds: 240,
    },
    {
        contact: 'Book club',
        isGroup: true,
        messages: 900,
        myReplies: 80,
        theirReplies: 300,
        myMedianSeconds: 4000,
        theirMedianSeconds: 20,
    },
];

const ridge: MonthlyContactCount[] = [
    { month: '2024-05-01', name: 'Alice', messages: 100 },
    { month: '2024-06-01', name: 'Alice', messages: 0 },
    { month: '2024-05-01', name: 'Bob', messages: 0 },
    { month: '2024-06-01', name: 'Bob', messages: 50 },
];

const reactions: ReactionCount[] = [
    { emoji: '❤', received: 86, given: 180 },
    { emoji: '😆', received: 65, given: 50 },
    { emoji: '👍', received: 91, given: 0 },
];

const svgOf = (node: Element) => node.querySelector('svg');

describe('message charts', () => {
    it('places one dot per one-to-one contact on the balance quadrant', () => {
        const node = conversationBalanceChart(balance);
        expect(svgOf(node)?.querySelectorAll('circle[fill-opacity]')).toHaveLength(2);
    });

    it('paints the side someone leans to: you in the accent, them in the neutral', () => {
        const fills = [
            ...conversationBalanceChart(balance).querySelectorAll('circle[fill-opacity]'),
        ].map((c) => c.getAttribute('fill'));
        expect(fills).toContain(YOU_COLOR);
        expect(fills).toContain(THEM_COLOR);
    });

    it('draws one bar per side for each contact who started conversations on both sides', () => {
        const node = conversationStartersChart(balance, { minSessions: 1 });
        expect(node.querySelectorAll('path.mine')).toHaveLength(2);
        expect(node.querySelectorAll('path.theirs')).toHaveLength(2);
    });

    it('falls back to an empty state when nobody has enough conversations to rank', () => {
        const node = conversationStartersChart(balance, { minSessions: 1000 });
        expect(node.classList.contains('chart-empty')).toBe(true);
    });

    // You are one voice among many in a group, so "me against them" would only
    // measure how many people are in the room.
    it('leaves group threads out of every per-contact comparison', () => {
        for (const node of [
            conversationBalanceChart(balance),
            conversationStartersChart(balance, { minSessions: 1 }),
            replyTimeQuadrantChart(replyTimes),
        ]) {
            expect(node.textContent).toContain('Alice');
            expect(node.textContent).not.toContain('Book club');
        }
    });

    it('labels every gridline on the log axes', () => {
        const node = replyTimeQuadrantChart(replyTimes);
        const labels = [...node.querySelectorAll('.chart-axis .tick text')].map(
            (t) => t.textContent
        );
        expect(labels.every((label) => label && label.length > 0)).toBe(true);
    });

    it('renders the contact ridgeline', () => {
        expect(svgOf(contactRidgelineChart(ridge))).not.toBeNull();
    });

    it('paints reactions you give as you, and the ones you receive as them', () => {
        const fills = new Set(
            [...reactionBreakdownChart(reactions).querySelectorAll('svg path[fill]')].map((p) =>
                p.getAttribute('fill')
            )
        );
        expect(fills).toEqual(new Set([YOU_COLOR, THEM_COLOR]));
    });

    it('falls back to an empty state instead of throwing on no data', () => {
        for (const node of [
            conversationBalanceChart([]),
            conversationStartersChart([]),
            replyTimeQuadrantChart([]),
            contactRidgelineChart([]),
            reactionBreakdownChart([]),
        ]) {
            expect(node.classList.contains('chart-empty')).toBe(true);
        }
    });

    it('formats durations across the scale', () => {
        expect(formatDuration(30)).toBe('30 s');
        expect(formatDuration(120)).toBe('2 min');
        expect(formatDuration(3600)).toBe('1 h');
        expect(formatDuration(4500)).toBe('1 h 15');
        expect(formatDuration(2 * 86400)).toBe('2.0 d');
    });
});
