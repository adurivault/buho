/**
 * A day's heart rate as time spent in each band of the health ramp, and as
 * the heartbeats it adds up to.
 *
 * Pure (no DB, no DOM). The readings go through the health explorer's own
 * pipeline — averaged into its slots, laid on a `SignalGrid`, counted by
 * `bandStacks` at the stops `rampFor` sets — so a zone on the calendar is one
 * colour of the explorer's legend, and the minutes in it are the cells of that
 * colour in the day's column there.
 */
import {
    bandStacks,
    buildSignalGrid,
    dayAt,
    type ColorStop,
    type SignalSlot,
} from '#lib/visualizations/signalGrid.ts';
import { isoDay } from './days';

/** One day's heart rate, split by band. */
export interface ZoneDay {
    /** 'YYYY-MM-DD' */
    date: string;
    /**
     * Minutes per band, one entry per stop: band `i` runs from stop `i` to stop
     * `i + 1`, the last one from its stop up. Readings below the first stop
     * count in the first band, as they are painted.
     */
    minutes: number[];
}

/**
 * Each day's minutes per band, for every day that has a reading.
 *
 * @param slots averaged readings, as `getHealthSlots` returns them.
 * @param slotMinutes the length of one slot — `SLOT_MINUTES` for those.
 */
export function zoneDays(slots: SignalSlot[], stops: ColorStop[], slotMinutes: number): ZoneDay[] {
    const grid = buildSignalGrid(slots, slotMinutes);
    const stacks = bandStacks(
        grid,
        stops.map((stop) => stop.value)
    );

    const days: ZoneDay[] = [];
    for (let day = 0; day < grid.dayCount; day++) {
        const minutes: number[] = [];
        let total = 0;
        for (let band = 0; band < stacks.bandCount; band++) {
            const value = stacks.byDay[day * stacks.bandCount + band] * slotMinutes;
            minutes.push(value);
            total += value;
        }
        if (total > 0) days.push({ date: isoDay(dayAt(grid, day)), minutes });
    }
    return days;
}

/** One day's heartbeats. */
export interface DayBeats {
    /** 'YYYY-MM-DD' */
    date: string;
    /**
     * The beats the day's readings add up to, with each slot the watch was off
     * counted at the range's usual heart rate for that time of day.
     */
    beats: number;
    /** Minutes the watch read the heart that day. */
    worn: number;
}

/**
 * Each day's heartbeats, for every day that has a reading. A slot with a
 * reading counts its average heart rate for its length; a slot without one,
 * the watch charging or on the table, counts the average of every reading in
 * that slot across the range. A night off the wrist then adds an ordinary
 * night rather than nothing, and the day stands against the rest whatever
 * the watch missed.
 *
 * @param slots averaged readings, as `getHealthSlots` returns them.
 * @param slotMinutes the length of one slot — `SLOT_MINUTES` for those.
 */
export function dayBeats(slots: SignalSlot[], slotMinutes: number): DayBeats[] {
    const grid = buildSignalGrid(slots, slotMinutes);
    const { dayCount, slotsPerDay, values } = grid;

    // The range's usual heart rate in each slot of the day; the overall one
    // where a slot never had a reading.
    const sums = new Float64Array(slotsPerDay);
    const counts = new Uint32Array(slotsPerDay);
    let total = 0;
    let read = 0;
    for (let slot = 0; slot < slotsPerDay; slot++) {
        for (let day = 0; day < dayCount; day++) {
            const value = values[slot * dayCount + day];
            if (Number.isNaN(value)) continue;
            sums[slot] += value;
            counts[slot]++;
            total += value;
            read++;
        }
    }
    if (read === 0) return [];
    const overall = total / read;
    const usual = Array.from(sums, (sum, slot) =>
        counts[slot] > 0 ? sum / counts[slot] : overall
    );

    const days: DayBeats[] = [];
    for (let day = 0; day < dayCount; day++) {
        let beats = 0;
        let worn = 0;
        for (let slot = 0; slot < slotsPerDay; slot++) {
            const value = values[slot * dayCount + day];
            if (Number.isNaN(value)) {
                beats += usual[slot] * slotMinutes;
            } else {
                beats += value * slotMinutes;
                worn += slotMinutes;
            }
        }
        if (worn > 0) days.push({ date: isoDay(dayAt(grid, day)), beats, worn });
    }
    return days;
}
