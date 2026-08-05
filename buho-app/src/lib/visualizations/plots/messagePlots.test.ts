import { describe, it, expect, beforeAll, vi } from 'vitest';
import {
    hourWeekdayHeatmapPlot,
    messageCalendarPlot,
    conversationBalancePlot,
    replyTimeQuadrantPlot,
    contactRidgelinePlot,
    reactionBreakdownPlot,
    formatDuration,
} from './messagePlots';
import type {
    ContactBalance,
    ContactReplyTimes,
    DailyMessageCount,
    HourWeekdayCell,
    MonthlyContactCount,
    ReactionCount,
} from '$lib/data/queries/messageQueries';

// Plot paints its continuous color legends onto a canvas, which jsdom doesn't
// implement — without this stub the two plots carrying a `legend: true` scale
// fail here for a reason that has nothing to do with the chart spec.
beforeAll(() => {
    HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
        fillStyle: '',
        fillRect: vi.fn(),
    })) as unknown as typeof HTMLCanvasElement.prototype.getContext;
});

const grid: HourWeekdayCell[] = [
    { dow: 1, hour: 9, direction: 'sent', messages: 12 },
    { dow: 1, hour: 9, direction: 'received', messages: 8 },
    { dow: 4, hour: 23, direction: 'sent', messages: 3 },
];

const days: DailyMessageCount[] = [
    { date: '2024-05-01', messages: 12, sent: 7, received: 5, words: 90, contacts: 2 },
    { date: '2024-05-02', messages: 3, sent: 1, received: 2, words: 20, contacts: 1 },
    { date: '2025-01-15', messages: 40, sent: 22, received: 18, words: 300, contacts: 5 },
];

const balance: ContactBalance[] = [
    {
        contact: 'Alice', messages: 200, sent: 140, received: 60, myDoubleTexts: 9,
        theirDoubleTexts: 2, sessions: 30, sessionsIStarted: 20,
        firstDay: '2024-05-01', lastDay: '2025-01-15',
    },
    {
        contact: 'Bob', messages: 50, sent: 10, received: 40, myDoubleTexts: 0,
        theirDoubleTexts: 6, sessions: 8, sessionsIStarted: 1,
        firstDay: '2024-06-01', lastDay: '2024-12-01',
    },
];

const replyTimes: ContactReplyTimes[] = [
    { contact: 'Alice', messages: 200, myReplies: 40, theirReplies: 38, myMedianSeconds: 120, theirMedianSeconds: 900 },
    { contact: 'Bob', messages: 50, myReplies: 10, theirReplies: 12, myMedianSeconds: 3600, theirMedianSeconds: 240 },
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

describe('message plot factories', () => {
    it('renders the hour/weekday heatmap for each direction', () => {
        for (const direction of ['both', 'sent', 'received'] as const) {
            const node = hourWeekdayHeatmapPlot(grid, { direction });
            expect(node).toBeInstanceOf(Element);
        }
    });

    it('renders the calendar across several years', () => {
        expect(messageCalendarPlot(days)).toBeInstanceOf(Element);
    });

    it('renders the balance bars', () => {
        expect(conversationBalancePlot(balance)).toBeInstanceOf(Element);
    });

    it('renders the reply-time quadrant on log scales', () => {
        expect(replyTimeQuadrantPlot(replyTimes)).toBeInstanceOf(Element);
    });

    it('renders the contact ridgeline', () => {
        expect(contactRidgelinePlot(ridge)).toBeInstanceOf(Element);
    });

    it('renders the reaction breakdown', () => {
        expect(reactionBreakdownPlot(reactions)).toBeInstanceOf(Element);
    });

    it('falls back to an empty state instead of throwing on no data', () => {
        expect(hourWeekdayHeatmapPlot([])).toBeInstanceOf(Element);
        expect(messageCalendarPlot([])).toBeInstanceOf(Element);
        expect(conversationBalancePlot([])).toBeInstanceOf(Element);
        expect(replyTimeQuadrantPlot([])).toBeInstanceOf(Element);
        expect(contactRidgelinePlot([])).toBeInstanceOf(Element);
        expect(reactionBreakdownPlot([])).toBeInstanceOf(Element);
    });

    it('formats durations across the scale', () => {
        expect(formatDuration(30)).toBe('30 s');
        expect(formatDuration(120)).toBe('2 min');
        expect(formatDuration(3600)).toBe('1 h');
        expect(formatDuration(4500)).toBe('1 h 15');
        expect(formatDuration(2 * 86400)).toBe('2.0 d');
    });
});
