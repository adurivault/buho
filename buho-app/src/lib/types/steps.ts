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
 * `timestamp`/`startTimestamp`/`date` are local wall-clock strings ready for
 * insertion, resolved with the offset the watch itself recorded — a Garmin
 * export spans every timezone its owner travelled through.
 */
export interface StepPacket {
    timestamp: string; // local wall-clock "YYYY-MM-DD HH:MM:SS", packet end
    date: string; // local day "YYYY-MM-DD"
    startTimestamp: string; // local wall-clock, packet start
    steps: number;
    activeSeconds: number; // movement counted inside the window
    spanSeconds: number; // wall-clock length of the window
    distanceMeters: number;
    calories: number;
    cadenceSpm: number | null; // steps per active minute; null when nothing was active
    intensity: number | null; // 0–7 as reported by the watch for the window
    runningSteps: number; // of `steps`, how many came off the running counter
    runningActiveSeconds: number; // of `activeSeconds`, how many it accounted for
}
