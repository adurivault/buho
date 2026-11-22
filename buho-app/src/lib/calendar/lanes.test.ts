import { describe, expect, it } from 'vitest';
import { emptyNote, LANE_SPECS, layoutLanes, layoutYear, leadIn, weekSpan } from './lanes';
import { CALENDAR_ORDER } from './figures';
import { dayOfYear, fullDay, monthDay } from './dates';
import { buildYearDays } from './days';
import type { YearData } from './yearData';

const all = {
    listening: true,
    positions: true,
    messages: true,
    activity: true,
    steps: true,
    health: true,
};

describe('layoutLanes', () => {
    it('stacks every lane with its gap above it', () => {
        const { lanes, height } = layoutLanes(all, () => true);

        expect(lanes.map((l) => [l.key, l.top, l.height])).toEqual([
            ['positions-bars', 0, 44],
            ['positions-city', 48, 8],
            ['listening-bars', 74, 56],
            ['messages-bars', 148, 56],
            ['activity-bars', 222, 44],
            ['steps-bars', 284, 56],
            ['health-zones', 358, 44],
        ]);
        expect(height).toBe(402);
    });

    it('keeps a module that is not imported at full height and drops the ribbon with positions', () => {
        const { lanes, height } = layoutLanes(
            { ...all, positions: false, steps: false },
            () => true
        );

        expect(lanes.map((l) => [l.key, l.state, l.height])).toEqual([
            ['positions-bars', 'missing', 44],
            ['listening-bars', 'data', 56],
            ['messages-bars', 'data', 56],
            ['activity-bars', 'data', 44],
            ['steps-bars', 'missing', 56],
            ['health-zones', 'data', 44],
        ]);
        // As tall as with every module, the ribbon aside.
        expect(height).toBe(390);
    });

    it('leaves out the city ribbon when no day has a city', () => {
        const { lanes } = layoutLanes(all, (spec) => spec.kind !== 'city');

        expect(lanes.map((l) => l.key)).not.toContain('positions-city');
        // Messages move up into the room the ribbon left.
        expect(lanes.find((l) => l.module === 'messages')?.top).toBe(136);
    });

    it('lists the modules in the calendar’s one order', () => {
        const modules = LANE_SPECS.map((spec) => spec.module);
        expect(modules.filter((id, i) => modules.indexOf(id) === i)).toEqual(CALENDAR_ORDER);
    });

    it('marks a loaded lane with nothing this year empty', () => {
        const { lanes } = layoutLanes(all, (spec) => spec.module !== 'activity');
        expect(lanes.find((l) => l.module === 'activity')?.state).toBe('empty');
    });
});

describe('emptyNote and leadIn', () => {
    it('says when the export starts or ends rather than "nothing"', () => {
        expect(emptyNote({ first: '2024-03-10', last: '2026-11-02' }, 2023)).toBe(
            `Export starts ${fullDay('2024-03-10')}`
        );
        expect(emptyNote({ first: '2019-01-01', last: '2021-06-30' }, 2023)).toBe(
            `Export ends ${fullDay('2021-06-30')}`
        );
        expect(emptyNote({ first: '2019-01-01', last: '2026-06-30' }, 2023)).toBe(
            'No record in 2023'
        );
    });

    it('hatches the stretch before the export starts, and labels it when there is room', () => {
        const cover = { first: '2024-03-10', last: '2026-11-02' };
        expect(leadIn(cover, 2024, 366, dayOfYear)).toEqual({
            share: 69 / 366,
            text: `Export starts ${monthDay('2024-03-10')}`,
        });
        expect(leadIn({ ...cover, first: '2024-01-12' }, 2024, 366, dayOfYear)?.text).toBe('');
        expect(leadIn(cover, 2025, 365, dayOfYear)).toBeNull();
    });
});

describe('layoutYear', () => {
    const empty: YearData = {
        year: 2025,
        listening: null,
        positions: null,
        messages: null,
        activity: null,
        steps: null,
        health: null,
    };

    it('reads each lane from what it draws: bars, heart-rate bands, cities', () => {
        const days = buildYearDays(
            2025,
            { listening: [{ date: '2025-03-01', value: 40 }], positions: [] },
            {}
        );
        const data: YearData = {
            ...empty,
            positions: [{ date: '2025-03-01', km: 0, city: null }],
            health: { stops: [], days: [{ date: '2025-03-01', minutes: [10] }], beats: [] },
        };
        const loaded = { ...all, messages: false, activity: false, steps: false };

        const { lanes } = layoutYear(loaded, days, data);

        expect(lanes.map((l) => [l.key, l.state])).toEqual([
            ['positions-bars', 'empty'],
            ['listening-bars', 'data'],
            ['messages-bars', 'missing'],
            ['activity-bars', 'missing'],
            ['steps-bars', 'missing'],
            ['health-zones', 'data'],
        ]);
    });

    it('adds the city ribbon once a city is known', () => {
        const days = buildYearDays(2025, { positions: [{ date: '2025-03-01', value: 12 }] }, {});
        const data: YearData = {
            ...empty,
            positions: [{ date: '2025-03-01', km: 12, city: 'Lyon' }],
        };

        const { lanes } = layoutYear(all, days, data);

        expect(lanes.map((l) => l.key)).toContain('positions-city');
    });
});

describe('weekSpan', () => {
    // 2025 opens on a Wednesday: two days into its week.
    const offset = 2;

    it('keeps the first and last weeks whole, past the year’s ends', () => {
        // The 1st of January's week starts on the Monday before it, two days out.
        expect(weekSpan(0, offset, 365, 730)).toEqual([-4, 10]);
        expect(weekSpan(4, offset, 365, 730)).toEqual([-4, 10]);
        // The 31st of December's week runs four days past it.
        expect(weekSpan(364, offset, 365, 730)).toEqual([724, 738]);
    });

    it('spans a full week from its Monday’s column to its Sunday’s', () => {
        expect(weekSpan(5, offset, 365, 730)).toEqual([10, 24]);
        expect(weekSpan(11, offset, 365, 730)).toEqual([10, 24]);
        expect(weekSpan(12, offset, 365, 730)).toEqual([24, 38]);
    });

    it('lands on the lanes’ pixels when a day is a fraction of one wide', () => {
        const step = 1000 / 365;
        const [from, to] = weekSpan(40, offset, 365, 1000);
        // Day 40 is a Monday: its week is days 40 to 46.
        expect(from).toBe(Math.floor(40 * step));
        expect(to).toBe(Math.floor(47 * step));
    });
});
