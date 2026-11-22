import { describe, expect, it } from 'vitest';
import { formatDuration } from '#lib/utils/duration.ts';
import { axisTopText, dayFigureText, dayTrackText, emptyTrackText, yearTotalText } from './figures';
import type { DayTimeline } from './timeline';

// Numbers go through toLocaleString(), so the expectations do too.
const n = (value: number) => value.toLocaleString();

describe('yearTotalText', () => {
    it('prints each module in its own unit', () => {
        expect(yearTotalText('listening', 74_040, 'minutes')).toBe(formatDuration(74_040));
        expect(yearTotalText('listening', 3200, 'plays')).toBe(`${n(3200)} plays`);
        expect(yearTotalText('positions', 4321.4, 'minutes')).toBe(`${n(4321)} km`);
        expect(yearTotalText('messages', 1, 'minutes')).toBe('1 message');
        expect(yearTotalText('activity', 12, 'minutes')).toBe('12 entries');
        expect(yearTotalText('steps', 2_500_000, 'minutes')).toBe(`${n(2_500_000)} steps`);
        expect(yearTotalText('health', 240, 'minutes')).toBe('240 days');
    });
});

describe('dayFigureText', () => {
    const context = { measure: 'minutes' as const };

    it('prints a day the way its lane ranks it', () => {
        expect(dayFigureText('positions', 12.34, context)).toBe(`${n(12.3)} km`);
        expect(dayFigureText('activity', 1, context)).toBe('1 entry');
        expect(dayFigureText('health', 103_450, context)).toBe(`${n(103_450)} heartbeats`);
        expect(dayFigureText('listening', 4, { ...context, measure: 'plays' })).toBe('4 plays');
    });
});

describe('dayTrackText', () => {
    const context = { measure: 'minutes' as const };
    const quarters = (values: Record<number, number>) =>
        Array.from({ length: 96 }, (_, q) => values[q] ?? null);

    const day: DayTimeline = {
        date: '2025-03-10',
        positions: {
            bins: [],
            km: 6.5,
            points: [
                {
                    start: 480,
                    end: 500,
                    stationary: false,
                    lat: 45.76,
                    lon: 4.84,
                    city: null,
                    meters: 1500,
                },
            ],
        },
        listening: {
            plays: [
                { start: 480, minutes: 3, track: 'a', artist: 'x' },
                { start: 484, minutes: null, track: 'b', artist: 'x' },
            ],
            sessions: [],
        },
        messages: [
            {
                conversation: 'whatsapp:Léa',
                contact: 'Léa',
                count: 3,
                sent: 1,
                received: 2,
                messages: [
                    { minute: 540, sent: false, sender: 'Léa', text: 'salut' },
                    { minute: 545, sent: true, sender: 'Me', text: 'salut' },
                    { minute: 546, sent: false, sender: 'Léa', text: 'ça va ?' },
                ],
            },
        ],
        activity: [],
        steps: quarters({ 32: 1200, 33: 800 }),
        heartRate: { quarters: quarters({ 10: 52.6, 40: 120 }), stops: [] },
    };

    it('reads each figure off the day’s tracks, short under the track’s name', () => {
        expect(dayTrackText('positions', day, context)).toBe(`${n(6.5)} km`);
        expect(dayTrackText('listening', day, context)).toBe(formatDuration(3));
        expect(dayTrackText('listening', day, { ...context, measure: 'plays' })).toBe('2 plays');
        expect(dayTrackText('messages', day, context)).toBe('3');
        expect(dayTrackText('steps', day, context)).toBe(n(2000));
        expect(dayTrackText('health', day, context)).toBe('53 bpm at rest');
    });

    it('says nothing for a module with nothing that day, or not loaded', () => {
        expect(dayTrackText('activity', day, context)).toBeNull();
        expect(dayTrackText('activity', { ...day, activity: null }, context)).toBeNull();
        expect(dayTrackText('steps', { ...day, steps: quarters({}) }, context)).toBeNull();
    });
});

describe('axisTopText', () => {
    it('keeps the top of an axis short, the axis being named below it', () => {
        expect(axisTopText('listening', 180, 'minutes')).toBe(formatDuration(180));
        expect(axisTopText('listening', 40, 'plays')).toBe('40');
        expect(axisTopText('positions', 120.4, 'minutes')).toBe('120 km');
        expect(axisTopText('steps', 18_000, 'minutes')).toBe(n(18_000));
        expect(axisTopText('health', 118_402, 'minutes')).toBe(n(118_402));
    });
});

describe('emptyTrackText', () => {
    it('reads a silent day as zero for a log the export covers, as unknown otherwise', () => {
        expect(emptyTrackText('listening', true, 'minutes')).toBe(formatDuration(0));
        expect(emptyTrackText('listening', true, 'plays')).toBe('0 plays');
        expect(emptyTrackText('messages', true, 'minutes')).toBe('0');
        expect(emptyTrackText('messages', false, 'minutes')).toBe('—');
        expect(emptyTrackText('steps', true, 'minutes')).toBe('—');
    });
});
