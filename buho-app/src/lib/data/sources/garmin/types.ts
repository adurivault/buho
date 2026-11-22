/**
 * One reading of the watch's cumulative counters, before differencing.
 *
 * Collected from every monitoring file in the export; several files routinely
 * cover the same day, so the same reading can be seen more than once.
 */
export interface StepSample {
    /** Seconds since the FIT epoch, with compressed timestamps already resolved. */
    fitSeconds: number;
    /** The watch's UTC offset in minutes at the time of the reading. */
    offsetMinutes: number;
    /**
     * Which counter this reading came off. Walking and running are kept apart
     * here only because the watch increments them independently — differencing a
     * mixed series would be meaningless. They are summed once differenced.
     */
    activityType: string;
    /** Counter values, all cumulative from local midnight. */
    cycles: number;
    activeTime: number; // seconds
    distance: number; // meters
    calories: number;
    intensity: number | null;
}

/** Activity types whose `cycles` counter really counts steps. */
export const STEP_ACTIVITY_TYPES = new Set(['walking', 'running']);
