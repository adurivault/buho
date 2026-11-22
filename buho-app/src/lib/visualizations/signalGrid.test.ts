import { describe, expect, it } from 'vitest';
import { bandStacks, buildSignalGrid, dayAt, hourAt, valueAt } from './signalGrid';

const DAY_MS = 86_400_000;
const day = (n: number) => Date.UTC(2024, 0, 1 + n);

/** Cells in one stack, all bands together. */
function stackTotal(stacks: Float32Array, index: number, bandCount: number): number {
    let total = 0;
    for (let band = 0; band < bandCount; band++) total += stacks[index * bandCount + band];
    return total;
}

describe('buildSignalGrid', () => {
    it('lands a reading on the cell its day and hour name', () => {
        const grid = buildSignalGrid([{ x: day(0), slot: 78, value: 61 }], 5);

        expect(grid.slotsPerDay).toBe(288);
        expect(valueAt(grid, 0, 78)).toBe(61); // 6.5 h = slot 78 of 5 minutes
        expect(hourAt(grid, 78)).toBe(6.5);
        expect(dayAt(grid, 0)).toBe(day(0));
    });

    it('gives an unrecorded day its column all the same', () => {
        const grid = buildSignalGrid(
            [
                { x: day(0), slot: 0, value: 60 },
                { x: day(4), slot: 0, value: 70 },
            ],
            60
        );

        // Closing the gap would slide every later day one column left, and the
        // holes are the whole point of the view.
        expect(grid.dayCount).toBe(5);
        expect(valueAt(grid, 4, 0)).toBe(70);
        expect(dayAt(grid, 4) - dayAt(grid, 0)).toBe(4 * DAY_MS);
    });

    it('leaves a cell with no reading empty rather than zero', () => {
        const grid = buildSignalGrid([{ x: day(0), slot: 0, value: 60 }], 60);

        expect(valueAt(grid, 0, 12)).toBeNaN();
        expect(grid.filled).toBe(1);
        expect(grid.values.length).toBe(24);
    });

    it('reads outside the grid as empty, not as a wrapped cell', () => {
        const grid = buildSignalGrid([{ x: day(0), slot: 0, value: 60 }], 60);

        expect(valueAt(grid, -1, 0)).toBeNaN();
        expect(valueAt(grid, 1, 0)).toBeNaN();
        expect(valueAt(grid, 0, 24)).toBeNaN();
    });

    it('gives every slot of a day its own row', () => {
        // The regression this exists for: the slot used to arrive as a
        // fractional hour and be turned back into an index with `× 60`. Seven
        // of these 288 — 04:05, 08:10, 08:25 and four in the afternoon — are
        // not exactly representable, came back a hair under, and floored onto
        // the row above. Their own row was then empty for every day of the
        // export, which is what the raster showed as clean horizontal stripes.
        const rows = Array.from({ length: 288 }, (_, slot) => ({
            x: day(0),
            slot,
            value: slot,
        }));

        const grid = buildSignalGrid(rows, 5);

        expect(grid.filled).toBe(288);
        for (let slot = 0; slot < 288; slot++) {
            expect(valueAt(grid, 0, slot), `slot ${slot} is empty`).toBe(slot);
        }
    });

    it('survives having nothing to lay out', () => {
        const grid = buildSignalGrid([], 5);

        expect(grid.dayCount).toBe(0);
        expect(grid.filled).toBe(0);
        expect(grid.values.length).toBe(0);
    });
});

describe('bandStacks', () => {
    // Two days, two slots, values chosen to land one per band of a 0–100 ramp
    // split in four: 10 → band 0, 30 → band 1, 60 → band 2, 90 → band 3.
    const grid = buildSignalGrid(
        [
            { x: day(0), slot: 0, value: 10 },
            { x: day(0), slot: 1, value: 30 },
            { x: day(1), slot: 0, value: 60 },
            { x: day(1), slot: 1, value: 90 },
        ],
        60
    );
    const stops = [0, 25, 50, 75];

    it('counts each cell into the band its value falls in', () => {
        const stacks = bandStacks(grid, stops);

        expect([...stacks.byDay.slice(0, 4)]).toEqual([1, 1, 0, 0]);
        expect([...stacks.byDay.slice(4, 8)]).toEqual([0, 0, 1, 1]);
        expect([...stacks.bySlot.slice(0, 4)]).toEqual([1, 0, 1, 0]);
    });

    it('makes a bar as long as the cells it holds, not as tall as their mean', () => {
        const stacks = bandStacks(grid, stops);

        // Length is coverage: how much of that day was recorded at all. A mean
        // would say nothing about it.
        expect(stackTotal(stacks.byDay, 0, 4)).toBe(2);
        expect(stacks.dayPeak).toBe(2);
        expect(stacks.slotPeak).toBe(2);
    });

    it('joins readings past either end to the band at that end', () => {
        const wide = buildSignalGrid(
            [
                { x: day(0), slot: 0, value: -50 },
                { x: day(0), slot: 1, value: 500 },
            ],
            60
        );
        const stacks = bandStacks(wide, stops);

        // The same clamp the surface is painted with, so a bar can never
        // disagree with the cells above it.
        expect(stacks.byDay[0]).toBe(1);
        expect(stacks.byDay[3]).toBe(1);
    });

    it('counts only the window it is given', () => {
        const stacks = bandStacks(grid, stops, {
            fromDay: 1,
            toDay: 2,
            fromSlot: 0,
            toSlot: 2,
        });

        expect(stackTotal(stacks.byDay, 0, 4)).toBe(0);
        expect(stackTotal(stacks.byDay, 1, 4)).toBe(2);
        // Row counts follow the brush too, so the hourly profile describes the
        // selection rather than the whole export.
        expect([...stacks.bySlot.slice(0, 4)]).toEqual([0, 0, 1, 0]);
    });

    it('cuts the bands where the ramp is, not at even fractions', () => {
        // A tail stop set far past the others: 60 and 90 both used to fall in
        // the top half of an even split and stack as one colour, which is what
        // hid every effort inside a heart rate's red end.
        const tailed = buildSignalGrid(
            [
                { x: day(0), slot: 0, value: 60 },
                { x: day(0), slot: 1, value: 90 },
            ],
            60
        );
        const stacks = bandStacks(tailed, [0, 25, 50, 200]);

        expect([...stacks.byDay.slice(0, 4)]).toEqual([0, 0, 2, 0]);

        // A band runs from its own stop up to the next, so only a reading that
        // reaches the tail stop counts in the tail: 180 is still on the way.
        const peaked = buildSignalGrid(
            [
                { x: day(0), slot: 0, value: 180 },
                { x: day(0), slot: 1, value: 220 },
            ],
            60
        );
        expect([...bandStacks(peaked, [0, 25, 50, 200]).byDay.slice(0, 4)]).toEqual([0, 0, 1, 1]);
    });

    it('leaves an unrecorded row empty instead of guessing at it', () => {
        const stacks = bandStacks(grid, stops);

        expect(stackTotal(stacks.bySlot, 5, 4)).toBe(0);
    });
});
