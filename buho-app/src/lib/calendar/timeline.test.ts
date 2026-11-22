import { describe, expect, it } from 'vitest';
import {
    dayKm,
    listeningSessions,
    messagesByConversation,
    positionAt,
    quarterSeries,
    restingBpm,
    speedBins,
    QUARTERS_PER_DAY,
    type PositionRow,
} from './timeline';

const visit = (start: number, end: number) =>
    ({
        start,
        end,
        stationary: true,
        lat: 45.76,
        lon: 4.84,
        city: 'Lyon',
        meters: 0,
    }) satisfies PositionRow;

const leg = (start: number, end: number, meters: number) =>
    ({
        start,
        end,
        stationary: false,
        lat: 45.76,
        lon: 4.84,
        city: null,
        meters,
    }) satisfies PositionRow;

describe('speedBins', () => {
    it('spreads each stretch over the minutes it lasted', () => {
        // 800 m over ten minutes: 400 m in each of the two bins, 4.8 km/h.
        const bins = speedBins([leg(480, 490, 800)]);

        expect(bins).toHaveLength(288);
        expect(bins[96]?.kmh).toBeCloseTo(4.8);
        expect(bins[97]?.kmh).toBeCloseTo(4.8);
        expect(bins[96]?.km).toBeCloseTo(0.4);
        expect(bins[98]).toBeNull();
    });

    it('reads a stay as recorded and still, and silence as nothing', () => {
        const bins = speedBins([visit(-120, 30)]);

        expect(bins[0]).toEqual({ km: 0, kmh: 0 });
        expect(bins[5]).toEqual({ km: 0, kmh: 0 });
        expect(bins[6]).toBeNull();
    });

    it('measures a bin over the minutes something was recorded in it', () => {
        // A watch started at 18:03: 300 m in two minutes is 9 km/h, not 3.6.
        const bins = speedBins([leg(1083, 1085, 300)]);
        expect(bins[216]?.kmh).toBeCloseTo(9);
    });

    it('lands a single fix in its own minute', () => {
        const bins = speedBins([leg(600, 600, 50)]);
        expect(bins[120]).toEqual({ km: 0.05, kmh: 3 });
    });
});

describe('positionAt', () => {
    const at = (start: number, end: number, lat: number, stationary = false): PositionRow => ({
        ...leg(start, end, 0),
        stationary,
        lat,
    });

    it('finds the stay or the minute covering the time', () => {
        const points = [at(-60, 480, 45.7, true), at(600, 601, 45.8)];
        expect(positionAt(points, 300)?.lat).toBe(45.7);
        expect(positionAt(points, 600.5)?.lat).toBe(45.8);
    });

    it('places a time between two close positions on the line joining them', () => {
        const point = positionAt([at(600, 601, 45.0), at(611, 612, 46.0)], 606);
        expect(point?.lat).toBeCloseTo(45.5);
    });

    it('places nothing across a silence', () => {
        expect(positionAt([at(600, 601, 45.0), at(700, 701, 46.0)], 650)).toBeNull();
        expect(positionAt([at(600, 601, 45.0)], 900)).toBeNull();
    });
});

describe('dayKm', () => {
    it('counts each moving leg on the day it started', () => {
        const km = dayKm([
            leg(-30, 20, 40_000), // the night train from the evening before
            visit(20, 600),
            leg(600, 620, 1500),
            leg(1430, 1460, 2500), // leaves tonight, arrives tomorrow
        ]);
        expect(km).toBe(4);
    });
});

describe('listeningSessions', () => {
    it('groups plays with short breaks into one sitting', () => {
        const sessions = listeningSessions([
            { start: 480, minutes: 3.5, track: 'a', artist: 'x' },
            { start: 484, minutes: 4, track: 'b', artist: 'x' },
            { start: 495, minutes: 3, track: 'c', artist: 'y' }, // 7 minutes of quiet
            { start: 1200, minutes: 5, track: 'd', artist: 'y' },
        ]);

        expect(sessions).toEqual([
            { start: 480, end: 498, plays: 3, minutes: 10.5 },
            { start: 1200, end: 1205, plays: 1, minutes: 5 },
        ]);
    });

    it('counts a scrobble without a duration as a play of no length', () => {
        const sessions = listeningSessions([
            { start: 60, minutes: null, track: 'a', artist: 'x' },
            { start: 64, minutes: null, track: 'b', artist: 'x' },
        ]);
        expect(sessions).toEqual([{ start: 60, end: 64, plays: 2, minutes: 0 }]);
    });
});

describe('messagesByConversation', () => {
    it('gives each conversation a row, busiest first, the same name on two networks twice', () => {
        const message = (conversation: string, minute: number, sent: boolean) => ({
            conversation,
            contact: conversation.split(':')[1],
            sender: sent ? 'Me' : conversation.split(':')[1],
            text: 'salut',
            minute,
            sent,
        });
        const rows = messagesByConversation([
            message('whatsapp:Léa', 540, false),
            message('messenger:Léa', 541, true),
            message('whatsapp:Climbing', 545, false),
            message('whatsapp:Léa', 546, true),
        ]);

        expect(rows.map((r) => [r.conversation, r.contact, r.count, r.sent, r.received])).toEqual([
            ['whatsapp:Léa', 'Léa', 2, 1, 1],
            ['whatsapp:Climbing', 'Climbing', 1, 0, 1],
            ['messenger:Léa', 'Léa', 1, 1, 0],
        ]);
        expect(rows[0].messages).toEqual([
            { minute: 540, sent: false, sender: 'Léa', text: 'salut' },
            { minute: 546, sent: true, sender: 'Me', text: 'salut' },
        ]);
    });
});

describe('restingBpm', () => {
    it('reads the calmest quarter-hour, and nothing on a day without readings', () => {
        expect(restingBpm([null, 61.4, 52.6, 140, null])).toBe(53);
        expect(restingBpm([null, null])).toBeNull();
    });
});

describe('quarterSeries', () => {
    it('lays the figures on the 96 quarter-hours, empty where nothing was recorded', () => {
        const series = quarterSeries([
            { quarter: 0, value: 12 },
            { quarter: 95, value: 40 },
            { quarter: 96, value: 1 }, // off the clock
        ]);

        expect(series).toHaveLength(QUARTERS_PER_DAY);
        expect(series[0]).toBe(12);
        expect(series[95]).toBe(40);
        expect(series.filter((v) => v !== null)).toHaveLength(2);
    });
});
