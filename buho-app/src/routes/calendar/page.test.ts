import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, test, vi } from 'vitest';
import CalendarPage from './+page.svelte';
import { dataStore } from '#lib/stores/dataStore.svelte.ts';
import { calendarStore } from '#lib/stores/calendarStore.svelte.ts';
import { formatDuration } from '#lib/utils/duration.ts';
import type { YearSummary } from '#lib/calendar/years.ts';
import type { YearData } from '#lib/calendar/yearData.ts';
import type { DayTimeline } from '#lib/calendar/timeline.ts';

const fixtures = vi.hoisted(() => {
    const summaries: YearSummary[] = [
        {
            module: 'listening',
            year: 2024,
            total: 600,
            firstDay: '2024-03-10',
            lastDay: '2024-12-31',
        },
        {
            module: 'listening',
            year: 2025,
            total: 1200,
            firstDay: '2025-01-01',
            lastDay: '2025-06-01',
        },
        {
            module: 'messages',
            year: 2025,
            total: 42,
            firstDay: '2025-01-02',
            lastDay: '2025-05-30',
        },
    ];
    const yearData = (year: number): YearData => ({
        year,
        listening: [{ date: `${year}-06-01`, value: 45 }],
        positions: null,
        messages: [{ date: `${year}-05-30`, value: 3 }],
        activity: null,
        steps: null,
        health: null,
    });
    const timeline = (date: string): DayTimeline => ({
        date,
        positions: null,
        listening: { plays: [{ start: 600, minutes: 4, track: 'a', artist: 'x' }], sessions: [] },
        messages: [],
        activity: null,
        steps: null,
        heartRate: null,
    });
    return { summaries, yearData, timeline };
});

vi.mock('#lib/data/queries/calendarQueries.ts', () => ({
    getYearSummaries: vi.fn(async () => fixtures.summaries),
    getHeartRateStops: vi.fn(async () => []),
    getYearData: vi.fn(async (year: number) => fixtures.yearData(year)),
    getDayTimeline: vi.fn(async (date: string) => fixtures.timeline(date)),
    getYearQuarters: vi.fn(async (year: number) => ({
        listening: [{ date: `${year}-06-01`, quarter: 40, value: 3 }],
        messages: [{ date: `${year}-05-30`, quarter: 80, value: 2 }],
    })),
}));

function loadMusicAndMessages() {
    dataStore.loadUserData('listening');
    dataStore.loadUserData('messages');
}

describe('calendar page', () => {
    afterEach(() => {
        dataStore.reset();
        calendarStore.reset();
    });

    test('offers the import and the demo when nothing is loaded', () => {
        render(CalendarPage);

        expect(
            screen.getByRole('heading', { name: 'Every module, day by day' })
        ).toBeInTheDocument();
        // In the header's pill and in the page itself, as on the module pages.
        expect(screen.getAllByRole('button', { name: 'Import my data' })).toHaveLength(2);
        expect(screen.getByRole('button', { name: 'Load demo data' })).toBeInTheDocument();
    });

    test('opens on the latest day, with the year’s totals and ghosts for the rest', async () => {
        loadMusicAndMessages();
        render(CalendarPage);

        const latest = await screen.findByRole('button', { name: '2025' });
        expect(latest).toHaveAttribute('aria-pressed', 'true');
        await waitFor(() => expect(calendarStore.day).toBe('2025-06-01'));

        expect(screen.getByRole('heading', { name: '2025-06-01' })).toBeInTheDocument();
        expect(screen.getAllByText(formatDuration(1200)).length).toBeGreaterThan(0);
        // Each module's year total sits under its lane's name.
        expect(screen.getAllByText('42').length).toBeGreaterThan(0);
        // Positions, Google activity, steps and health are not imported: a ghost
        // card each in the year and in the day, and a thin lane each.
        await waitFor(() =>
            expect(screen.getAllByRole('button', { name: 'Add' }).length).toBeGreaterThanOrEqual(8)
        );
    });

    test('lays the open year round a clock beside the lanes', async () => {
        loadMusicAndMessages();
        const { container } = render(CalendarPage);

        expect(
            await screen.findByRole('group', { name: 'Pick a day on the year’s clock' })
        ).toBeInTheDocument();
        // One path for each module with a quarter-hour to show, in its colour.
        const paths = [...container.querySelectorAll('.year-clock .dial .layer')];
        expect(paths.map((path) => path.getAttribute('style'))).toEqual([
            expect.stringContaining('--fill-listening'),
            expect.stringContaining('--fill-messages'),
        ]);
    });

    test('pointing at a lane shows its module alone on the clock and the week calendar', async () => {
        loadMusicAndMessages();
        const { container } = render(CalendarPage);

        await screen.findByRole('group', { name: 'Pick a day on the year’s clock' });
        const clock = container.querySelector('.year-clock') as HTMLElement;
        const lanes = container.querySelector('.lanes .body') as HTMLElement;
        const layers = () =>
            [...clock.querySelectorAll('.dial .layer')].map((path) => path.getAttribute('style'));
        const days = () =>
            [...container.querySelectorAll('.week-calendar .cell:not(.empty)')].map((cell) =>
                cell.getAttribute('style')
            );

        // 2025's two days with anything on them: listening's on 1 June, messages' on 30 May.
        expect(days()).toEqual([
            expect.stringContaining('--peak-messages'),
            expect.stringContaining('--peak-listening'),
        ]);

        // The messages lane is the second: the pointer lands inside it.
        const messages = [...container.querySelectorAll('.lanes .row')].find((row) =>
            row.textContent?.includes('Messages')
        ) as HTMLElement;
        const top = parseFloat(messages.style.top);
        await fireEvent.pointerMove(lanes, { clientY: top + 1 });
        expect(within(clock).getByText('Messages')).toBeInTheDocument();
        expect(layers()).not.toHaveLength(0);
        for (const style of layers()) expect(style).toContain('--peak-messages');
        expect(days()).toEqual([expect.stringContaining('--peak-messages')]);

        // Off the lanes, every module again.
        await fireEvent.pointerLeave(lanes);
        expect(within(clock).queryByText('Messages')).not.toBeInTheDocument();
        expect(layers()).toHaveLength(2);
        expect(days()).toHaveLength(2);
    });

    test('the arrow keys step through the days, and stop at the last one', async () => {
        loadMusicAndMessages();
        render(CalendarPage);
        await waitFor(() => expect(calendarStore.day).toBe('2025-06-01'));

        await fireEvent.keyDown(window, { key: 'ArrowRight' });
        expect(calendarStore.day).toBe('2025-06-01');

        await fireEvent.keyDown(window, { key: 'ArrowLeft' });
        expect(calendarStore.day).toBe('2025-05-31');
    });

    test('hovering a day marks it and previews it below, until the pointer leaves', async () => {
        loadMusicAndMessages();
        const { container } = render(CalendarPage);
        await waitFor(() => expect(calendarStore.day).toBe('2025-06-01'));

        const cell = await waitFor(() => {
            const found = container.querySelector('rect[data-day="2025-05-30"]');
            expect(found).not.toBeNull();
            return found!;
        });
        await fireEvent.pointerMove(cell);

        expect(cell).toHaveClass('hovered');
        await waitFor(() =>
            expect(screen.getByRole('heading', { name: '2025-05-30' })).toBeInTheDocument()
        );
        // Hovering previews; it does not select.
        expect(calendarStore.day).toBe('2025-06-01');

        await fireEvent.pointerLeave(container.querySelector('.week-calendar svg')!);
        await waitFor(() =>
            expect(screen.getByRole('heading', { name: '2025-06-01' })).toBeInTheDocument()
        );
        expect(cell).not.toHaveClass('hovered');
    });

    test('switching year keeps the date where that year covers it', async () => {
        loadMusicAndMessages();
        render(CalendarPage);
        await waitFor(() => expect(calendarStore.day).toBe('2025-06-01'));

        await fireEvent.click(screen.getByRole('button', { name: '2024' }));
        expect(calendarStore.day).toBe('2024-06-01');
        expect(screen.getByRole('button', { name: '2024' })).toHaveAttribute(
            'aria-pressed',
            'true'
        );
    });
});
