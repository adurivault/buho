/**
 * A sampled signal laid out as an image: one column per day, one row per slot
 * of the day.
 *
 * This is what separates the health readings from every other dataset in Buho.
 * Plays, messages and positions are events — irregular, and their presence is
 * the information. A watch samples: while it is worn, every minute has a
 * reading, so the grid is dense by construction and it is the *holes* that
 * carry meaning. Drawing that as a point cloud spends a mark per cell to
 * describe a surface, and leaves the holes indistinguishable from low values.
 *
 * Stored in image order — row-major, rows are slots — so filling an ImageData
 * is a single walk over `values`.
 */
export interface SignalGrid {
    /** Epoch ms of column 0, at the local date's midnight. */
    firstDay: number;
    dayCount: number;
    slotsPerDay: number;
    slotMinutes: number;
    /** `slotsPerDay × dayCount`, NaN wherever nothing was recorded. */
    values: Float32Array;
    /** Cells that hold a reading — the rest is watch-off time. */
    filled: number;
}

export interface SignalSlot {
    /** Epoch ms of the day, as DuckDB's `epoch(DATE(ts)) * 1000` gives it. */
    x: number;
    /**
     * Index of the slot within the day, already whole.
     *
     * Deliberately not an hour: recovering an index from a fractional hour
     * means `y * 60`, and 8:10 comes back as 489.99999999999994, which floors
     * onto the row above. The reading overwrites its neighbour and its own row
     * is empty for every day there is.
     */
    slot: number;
    value: number;
}

const DAY_MS = 86_400_000;

export function buildSignalGrid(rows: SignalSlot[], slotMinutes: number): SignalGrid {
    const slotsPerDay = Math.max(1, Math.round((24 * 60) / slotMinutes));

    if (rows.length === 0) {
        return {
            firstDay: 0,
            dayCount: 0,
            slotsPerDay,
            slotMinutes,
            values: new Float32Array(0),
            filled: 0,
        };
    }

    let firstDay = Infinity;
    let lastDay = -Infinity;
    for (const row of rows) {
        if (row.x < firstDay) firstDay = row.x;
        if (row.x > lastDay) lastDay = row.x;
    }

    // Every day between the ends gets a column, recorded or not: closing the
    // gaps would slide the calendar and hide exactly what this view is for.
    const dayCount = Math.max(1, Math.round((lastDay - firstDay) / DAY_MS) + 1);
    const values = new Float32Array(slotsPerDay * dayCount).fill(NaN);
    let filled = 0;

    for (const row of rows) {
        const day = Math.round((row.x - firstDay) / DAY_MS);
        const slot = row.slot;
        if (day < 0 || day >= dayCount || slot < 0 || slot >= slotsPerDay) continue;
        const index = slot * dayCount + day;
        if (Number.isNaN(values[index])) filled++;
        values[index] = row.value;
    }

    return { firstDay, dayCount, slotsPerDay, slotMinutes, values, filled };
}

/** Epoch ms of a column. */
export function dayAt(grid: SignalGrid, day: number): number {
    return grid.firstDay + day * DAY_MS;
}

/** Hour of day at the top of a row. */
export function hourAt(grid: SignalGrid, slot: number): number {
    return (slot * grid.slotMinutes) / 60;
}

/** The reading in a cell, or NaN if the watch recorded nothing there. */
export function valueAt(grid: SignalGrid, day: number, slot: number): number {
    if (day < 0 || day >= grid.dayCount || slot < 0 || slot >= grid.slotsPerDay) return NaN;
    return grid.values[slot * grid.dayCount + day];
}

/**
 * How each column and each row splits across the value bands.
 *
 * The marginals are stacked rather than averaged, for the same reason the
 * constellation's satellites are: a bar's length says how much was recorded and
 * its segments say what it was made of. A mean would collapse an hour that was
 * half rest and half effort onto a middling value nobody ever had.
 *
 * They are plain reductions over the grid — no second pass of binning over
 * scattered points, which is what made the hourly bars alternate when the two
 * bin sizes disagreed.
 */
export interface BandStacks {
    bandCount: number;
    /** `day * bandCount + band` → cells of that day in that band. */
    byDay: Float32Array;
    /** `slot * bandCount + band` → cells of that slot in that band. */
    bySlot: Float32Array;
    /** Longest bar on each axis, so the two scales stay absolute. */
    dayPeak: number;
    slotPeak: number;
}

export interface StackWindow {
    fromDay: number;
    toDay: number;
    fromSlot: number;
    toSlot: number;
}

/** One colour of a ramp, and the value it sits at. Ascending by value. */
export interface ColorStop {
    value: number;
    color: string;
}

/**
 * @param stops the value of each ramp colour, ascending. A band runs from its
 * own stop to the next, so the segments of a bar are the colours of the cells
 * they count — which is only true if the bands are cut where the ramp is,
 * rather than at even fractions of the range. The two agreed while every ramp
 * was evenly spaced; a tail stop set well past the others is what parts them.
 */
export function bandStacks(grid: SignalGrid, stops: number[], window?: StackWindow): BandStacks {
    const fromDay = Math.max(0, window?.fromDay ?? 0);
    const toDay = Math.min(grid.dayCount, window?.toDay ?? grid.dayCount);
    const fromSlot = Math.max(0, window?.fromSlot ?? 0);
    const toSlot = Math.min(grid.slotsPerDay, window?.toSlot ?? grid.slotsPerDay);

    const bands = Math.max(1, stops.length);
    const byDay = new Float32Array(grid.dayCount * bands);
    const bySlot = new Float32Array(grid.slotsPerDay * bands);

    for (let slot = fromSlot; slot < toSlot; slot++) {
        const base = slot * grid.dayCount;
        for (let day = fromDay; day < toDay; day++) {
            const value = grid.values[base + day];
            if (Number.isNaN(value)) continue;
            // Readings past either end of the ramp join the band at that end —
            // the same clamp the surface itself is painted with.
            let band = 0;
            while (band + 1 < bands && value >= stops[band + 1]) band++;
            byDay[day * bands + band]++;
            bySlot[slot * bands + band]++;
        }
    }

    return {
        bandCount: bands,
        byDay,
        bySlot,
        dayPeak: peakOf(byDay, bands),
        slotPeak: peakOf(bySlot, bands),
    };
}

/** The tallest stack, i.e. the most cells any one column or row holds. */
function peakOf(stacks: Float32Array, bandCount: number): number {
    let peak = 0;
    for (let i = 0; i < stacks.length; i += bandCount) {
        let total = 0;
        for (let band = 0; band < bandCount; band++) total += stacks[i + band];
        if (total > peak) peak = total;
    }
    return peak;
}
