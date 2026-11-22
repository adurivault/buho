import { fireEvent, render, screen } from '@testing-library/svelte';
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';
import YearPicker from './YearPicker.svelte';
import DayTracks from './DayTracks.svelte';
import DayMap from './DayMap.svelte';
import { formatDuration } from '#lib/utils/duration.ts';
import { yearRows } from '#lib/calendar/years.ts';
import { speedBins, type DayTimeline, type PositionRow } from '#lib/calendar/timeline.ts';

const loaded = {
    listening: true,
    positions: false,
    messages: true,
    activity: false,
    steps: false,
    health: false,
};

describe('YearPicker', () => {
    const rows = yearRows([
        {
            module: 'listening',
            year: 2024,
            total: 6000,
            firstDay: '2024-03-10',
            lastDay: '2024-12-31',
        },
        {
            module: 'listening',
            year: 2025,
            total: 12_000,
            firstDay: '2025-01-01',
            lastDay: '2025-12-31',
        },
        {
            module: 'messages',
            year: 2025,
            total: 40,
            firstDay: '2025-01-02',
            lastDay: '2025-12-30',
        },
    ]);

    it('gives each year a button labelled by its last two digits, the open one pressed', () => {
        render(YearPicker, { rows, selected: 2025, loaded, measure: 'plays', onPick: vi.fn() });

        const open = screen.getByRole('button', { name: '2025' });
        expect(open).toHaveTextContent('’25');
        expect(open).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('button', { name: '2024' })).toHaveAttribute(
            'aria-pressed',
            'false'
        );
    });

    it('carries one bar per module, scaled to that module’s best year', () => {
        render(YearPicker, { rows, selected: 2025, loaded, measure: 'plays', onPick: vi.fn() });

        const bars = screen.getByRole('button', { name: '2024' }).querySelectorAll('.bar');
        expect(bars).toHaveLength(6);
        // Positions, first in the calendar's order, are not imported: a flat tick.
        expect(bars[0]).toHaveClass('empty');
        // Listening: half its best year, and only from March, so drawn faint.
        expect(bars[1]).toHaveStyle({ height: '8px' });
        expect(bars[1]).toHaveClass('partial');
    });

    it('puts the numbers in the tooltip and reports the pick', async () => {
        const onPick = vi.fn();
        render(YearPicker, { rows, selected: 2025, loaded, measure: 'plays', onPick });

        const button = screen.getByRole('button', { name: '2024' });
        expect(button.getAttribute('title')).toContain(
            `Listening ${(6000).toLocaleString()} plays`
        );
        await fireEvent.click(button);
        expect(onPick).toHaveBeenCalledWith(2024);
    });
});

describe('YearPicker arrows', () => {
    const rows = yearRows([
        {
            module: 'listening',
            year: 2021,
            total: 1,
            firstDay: '2021-01-01',
            lastDay: '2021-12-31',
        },
        {
            module: 'listening',
            year: 2023,
            total: 1,
            firstDay: '2023-01-01',
            lastDay: '2023-12-31',
        },
        {
            module: 'listening',
            year: 2024,
            total: 1,
            firstDay: '2024-01-01',
            lastDay: '2024-12-31',
        },
    ]);

    it('step to the next and previous years that hold anything, skipping empty ones', async () => {
        const onPick = vi.fn();
        render(YearPicker, { rows, selected: 2023, loaded, measure: 'plays', onPick });

        await fireEvent.click(screen.getByRole('button', { name: 'Previous year' }));
        expect(onPick).toHaveBeenLastCalledWith(2021);
        await fireEvent.click(screen.getByRole('button', { name: 'Next year' }));
        expect(onPick).toHaveBeenLastCalledWith(2024);
    });

    it('stop at either end', () => {
        render(YearPicker, { rows, selected: 2024, loaded, measure: 'plays', onPick: vi.fn() });
        expect(screen.getByRole('button', { name: 'Next year' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Previous year' })).toBeEnabled();
    });
});

const leg = (start: number, end: number, meters: number): PositionRow => ({
    start,
    end,
    stationary: false,
    lat: 45.76,
    lon: 4.84,
    city: null,
    meters,
});

describe('DayTracks', () => {
    const everything = {
        listening: true,
        positions: true,
        messages: true,
        activity: true,
        steps: true,
        health: true,
    };

    it('draws the day’s speed, and rows that share a name', () => {
        const day: DayTimeline = {
            date: '2025-03-10',
            positions: {
                bins: speedBins([leg(480, 490, 800), leg(490, 500, 600)]),
                km: 1.4,
                points: [leg(480, 490, 800), leg(490, 500, 600)],
            },
            listening: null,
            messages: null,
            // "google-news" and an unlisted "news" both read as News.
            activity: [
                { minute: 600, service: 'google-news', action: 'viewed', label: 'a' },
                { minute: 610, service: 'news', action: 'viewed', label: 'b' },
            ],
            steps: null,
            heartRate: null,
        };

        // Under `props`: a prop called `context` would otherwise be read as
        // Svelte's own mount option of that name.
        const { container } = render(DayTracks, {
            props: {
                day,
                loaded: everything,
                coverage: {},
                context: { measure: 'minutes' },
                onAdd: vi.fn(),
                onCursor: vi.fn(),
            },
        });

        // 08:00–08:20: four bins of five minutes, each with its own tooltip.
        expect(container.querySelectorAll('.speed-hit')).toHaveLength(4);
        expect(container.querySelector('.speed path')?.getAttribute('d')).toMatch(/^M96,/);
        expect(screen.getAllByText('News')).toHaveLength(2);
    });
});

describe('DayTracks on a day with nothing', () => {
    it('keeps every name in place: a zero or a dash under it, the messages heading kept', () => {
        const empty: DayTimeline = {
            date: '2025-03-10',
            positions: { bins: [], km: 0, points: [] },
            listening: { plays: [], sessions: [] },
            messages: [],
            activity: [],
            steps: Array.from({ length: 96 }, () => null),
            heartRate: { quarters: Array.from({ length: 96 }, () => null), stops: [] },
        };
        const span = { first: '2024-01-01', last: '2025-12-31' };

        render(DayTracks, {
            props: {
                day: empty,
                loaded: {
                    listening: true,
                    positions: true,
                    messages: true,
                    activity: true,
                    steps: true,
                    health: true,
                },
                coverage: { listening: span, messages: span, activity: span, steps: span },
                context: { measure: 'minutes' },
                onAdd: vi.fn(),
                onCursor: vi.fn(),
            },
        });

        expect(screen.getByText('Messages')).toBeInTheDocument();
        expect(screen.getByText('Google activity')).toBeInTheDocument();
        // No play is a figure; no step packet is not.
        expect(screen.getByText(formatDuration(0))).toBeInTheDocument();
        expect(screen.getAllByText('0')).toHaveLength(2);
        expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(3);
    });
});

describe('DayMap', () => {
    it('draws the day’s positions, and says so when there are none', () => {
        const { unmount } = render(DayMap, { points: [leg(480, 490, 800)] });
        expect(screen.getByLabelText("Map of the day's positions")).toBeInTheDocument();
        expect(screen.queryByText('No position this day')).not.toBeInTheDocument();
        unmount();

        // A stay that ended on the stroke of midnight belongs to the day before.
        render(DayMap, { points: [{ ...leg(-300, 0, 0), stationary: true }] });
        expect(screen.getByText('No position this day')).toBeInTheDocument();
    });
});
