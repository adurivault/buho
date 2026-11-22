import { render, screen, fireEvent } from '@testing-library/svelte';
import '@testing-library/jest-dom/vitest';
import { describe, expect, test, vi } from 'vitest';
import ContactRankingPanel from './ContactRankingPanel.svelte';

// Loud: I write almost everything. Even: the bigger conversation, split down the
// middle — so it sets the scale while sitting right on the axis.
const ROWS = [
    { contact: 'Loud', messages: 200, sent: 190, isGroup: false },
    { contact: 'Even', messages: 220, sent: 110, isGroup: true },
];

/** Numeric part of an inline percentage, e.g. "2.63%" → 2.63. The DOM keeps six
 *  significant digits ("90.9091%"), so assertions on it hold to three decimals. */
const percent = (el: Element | null | undefined, prop: 'width' | 'left') =>
    parseFloat((el as HTMLElement).style[prop]);

function bar(container: HTMLElement, contact: string) {
    const row = [...container.querySelectorAll('button.row')].find((b) =>
        b.textContent?.includes(contact)
    )!;
    const el = row.querySelector('.bar')!;
    const left = percent(el, 'left');
    const width = percent(el, 'width');
    return {
        left,
        width,
        /** Where the green meets the blue, in percent of the row. */
        boundary: left + (width * percent(row.querySelector('.seg.you'), 'width')) / 100,
    };
}

describe('ContactRankingPanel', () => {
    test('centres every bar and scales its length by total volume', () => {
        const { container } = render(ContactRankingPanel, { props: { rows: ROWS } });

        // The biggest conversation spans the row, so the scale is Even's 220.
        const even = bar(container, 'Even');
        expect(even.width).toBeCloseTo(100, 3);
        expect(even.left).toBeCloseTo(0, 3);

        // Loud is shorter, and centred rather than anchored to either edge.
        const loud = bar(container, 'Loud');
        expect(loud.width).toBeCloseTo((200 / 220) * 100, 3);
        expect(loud.left).toBeCloseTo(50 - loud.width / 2, 3);
    });

    test('reads the imbalance off the boundary, not off the bar edges', () => {
        const { container } = render(ContactRankingPanel, { props: { rows: ROWS } });

        // An even conversation puts the boundary dead centre, whatever its volume.
        expect(bar(container, 'Even').boundary).toBeCloseTo(50, 3);

        // 95% mine pushes it right, by the imbalance scaled to the bar's length.
        const loud = bar(container, 'Loud');
        expect(loud.boundary).toBeCloseTo(50 + loud.width * (0.95 - 0.5), 3);
    });

    test('gives every person in a group their own segment', () => {
        const { container } = render(ContactRankingPanel, {
            props: {
                rows: [
                    {
                        contact: 'Crew',
                        messages: 100,
                        sent: 40,
                        isGroup: true,
                        parts: [
                            { sender: 'Ana', value: 35 },
                            { sender: 'Bo', value: 25 },
                        ],
                    },
                ],
            },
        });

        const segs = [...container.querySelectorAll('.seg')];
        expect(segs).toHaveLength(3);
        // Widths are shares of the whole conversation, so the three add up to it.
        expect(parseFloat((segs[0] as HTMLElement).style.width)).toBeCloseTo(40, 3);
        expect(parseFloat((segs[1] as HTMLElement).style.width)).toBeCloseTo(35, 3);

        const fills = segs.map((s) => (s as HTMLElement).style.background);
        expect(new Set(fills).size).toBe(3);
    });

    test('leaves a one-to-one thread as a single block per side', () => {
        const { container } = render(ContactRankingPanel, { props: { rows: ROWS } });

        const row = [...container.querySelectorAll('button.row')].find((b) =>
            b.textContent?.includes('Loud')
        )!;
        expect(row.querySelectorAll('.seg')).toHaveLength(2);
    });

    test('flags group threads, where "them" is several people', () => {
        render(ContactRankingPanel, { props: { rows: ROWS } });

        const group = screen.getAllByText('group');
        expect(group).toHaveLength(1);
        expect(group[0].parentElement?.textContent).toContain('Even');
    });

    test('answers for the hovered segment, not for the whole row', async () => {
        const { container } = render(ContactRankingPanel, {
            props: {
                rows: [
                    {
                        contact: 'Crew',
                        messages: 100,
                        sent: 40,
                        isGroup: true,
                        parts: [
                            { sender: 'Ana', value: 35 },
                            { sender: 'Bo', value: 25 },
                        ],
                    },
                ],
                measureLabel: 'words',
            },
        });

        const segs = container.querySelectorAll('.seg');
        await fireEvent.pointerEnter(segs[1]);
        expect(screen.getByText('Ana')).toBeInTheDocument();
        expect(screen.getByText('35 words · 35% of Crew')).toBeInTheDocument();

        // Moving on relabels rather than stacking a second tooltip.
        await fireEvent.pointerEnter(segs[0]);
        expect(screen.getByText('You')).toBeInTheDocument();
        expect(screen.getByText('40 words · 40% of Crew')).toBeInTheDocument();
        expect(screen.queryByText('35 words · 35% of Crew')).not.toBeInTheDocument();
    });

    test('falls back to the whole conversation off the segments', async () => {
        const { container } = render(ContactRankingPanel, {
            props: { rows: ROWS, measureLabel: 'words' },
        });

        const row = [...container.querySelectorAll('button.row')].find((b) =>
            b.textContent?.includes('Loud')
        )!;
        const summary = 'you 190 words, them 10 · 95% written by you';

        await fireEvent.pointerMove(row);
        expect(screen.getByText(summary)).toBeInTheDocument();

        await fireEvent.pointerLeave(row);
        expect(screen.queryByText(summary)).not.toBeInTheDocument();
    });

    test('toggles the selection off when the selected row is clicked again', async () => {
        const onSelect = vi.fn();
        const { container } = render(ContactRankingPanel, {
            props: { rows: ROWS, selected: 'Loud', onSelect },
        });

        const rowFor = (contact: string) =>
            [...container.querySelectorAll('button.row')].find((b) =>
                b.textContent?.includes(contact)
            )!;

        await fireEvent.click(rowFor('Loud'));
        expect(onSelect).toHaveBeenCalledWith(null);

        await fireEvent.click(rowFor('Even'));
        expect(onSelect).toHaveBeenCalledWith('Even');
    });
});
