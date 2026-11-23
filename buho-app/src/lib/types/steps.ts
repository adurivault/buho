/**
 * One row of the `step_packets` table — a "step packet".
 *
 * A watch does not log steps one by one. It keeps a counter that runs from local
 * midnight and writes it out whenever it feels like it: once a minute while you
 * walk, once in two hours while you sit. A packet is the difference between two
 * consecutive writes, so it says "4 891 steps happened somewhere in this window"
 * rather than pinning them to an instant.
 *
 * That window has two lengths, and both are kept because they answer different
 * questions: `spanSeconds` is how long the window lasted, `activeSeconds` is how
 * much of it the watch counted as movement.
 *
 * A packet stays one packet even when the watch wrote both of its step counters
 * at that instant — a window is a stretch of time, and it can hold a walk and a
 * run. What it carries alongside the totals is how much of them came off the
 * running counter, because that is the watch's own reading of what happened and
 * nothing else in the row can reconstruct it. Walking is the remainder: only
 * these two counters are collected (STEP_ACTIVITY_TYPES), so the totals are
 * exactly their sum.
 *
 * Labelling the packet itself "a walk" or "a run" is what this deliberately
 * avoids: a mixed window is genuinely both, and picking one would be a claim the
 * watch never made.
 *
 * A phone keeps a coarser record: windows of at most ten minutes, each with the
 * steps and the distance it counted and nothing else. It never says how much of
 * the window was movement, nor whether any of it was running, so those fields
 * are null on its packets rather than a zero that would read as "sat still" or
 * "only walked".
 *
 * `timestamp`/`startTimestamp`/`date` are local wall-clock strings ready for
 * insertion, resolved with the offset the recorder itself knew — an export spans
 * every timezone its owner travelled through.
 */
export interface StepPacket {
    /** The export it came from, as a catalog id: `garmin`, `apple-health`. */
    source: StepSource;
    timestamp: string; // local wall-clock "YYYY-MM-DD HH:MM:SS", packet end
    date: string; // local day "YYYY-MM-DD"
    startTimestamp: string; // local wall-clock, packet start
    steps: number;
    activeSeconds: number | null; // movement counted inside the window; null when not measured
    spanSeconds: number; // wall-clock length of the window
    distanceMeters: number | null;
    calories: number | null;
    cadenceSpm: number | null; // steps per active minute; null when nothing was active
    intensity: number | null; // 0–7 as reported by the watch for the window
    runningSteps: number | null; // of `steps`, how many came off the running counter
    runningActiveSeconds: number | null; // of `activeSeconds`, how many it accounted for
    /**
     * Whether the recorder was on the body: a watch that measured a pulse during
     * the window. Null when it cannot tell — a phone, or a watch without a
     * heart-rate sensor. It is what decides, hour by hour, whose steps count
     * when two recorders overlap (see the steps view).
     */
    worn: boolean | null;
}

/** The exports that write step packets. */
export type StepSource = 'garmin' | 'apple-health';

/**
 * How you walk, as a phone in a pocket reads it during a walk. Part of the
 * steps module, beside the counts: the same walks, measured another way.
 */
export type GaitMetric = 'walking_speed' | 'step_length' | 'double_support' | 'walking_asymmetry';

/** In reading order: the two anyone understands first, then the clinical two. */
export const GAIT_METRICS: { id: GaitMetric; label: string; unit: string }[] = [
    { id: 'walking_speed', label: 'Walking speed', unit: 'km/h' },
    { id: 'step_length', label: 'Step length', unit: 'cm' },
    { id: 'double_support', label: 'Double support', unit: '%' },
    { id: 'walking_asymmetry', label: 'Walking asymmetry', unit: '%' },
];

/** One row of the `gait_readings` table. A few dozen a day, each taken mid-walk. */
export interface GaitReading {
    /** The export it came from, as a catalog id. */
    source: 'apple-health';
    /** Local wall-clock "YYYY-MM-DD HH:MM:SS", when the measured stretch began. */
    timestamp: string;
    date: string;
    metric: GaitMetric;
    value: number;
}
