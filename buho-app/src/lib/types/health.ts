/**
 * The health signals a monitoring file carries next to its step counters.
 *
 * Exploratory: one row per reading, one long table, no per-metric columns. What
 * is worth keeping is not settled yet, and a metric added here costs no schema.
 */
export type HealthMetric = 'heart_rate' | 'stress' | 'respiration';

/**
 * In reading order, which is not volume order: heart rate is the signal anyone
 * opens the page for, and stress is the one Garmin derived rather than measured.
 */
export const HEALTH_METRICS: { id: HealthMetric; label: string; unit: string }[] = [
    { id: 'heart_rate', label: 'Heart rate', unit: 'bpm' },
    { id: 'respiration', label: 'Respiration', unit: 'br/min' },
    { id: 'stress', label: 'Stress', unit: '' },
];

export interface HealthReading {
    /** Local wall-clock "YYYY-MM-DD HH:MM:SS", like every other Garmin row. */
    timestamp: string;
    date: string;
    metric: HealthMetric;
    value: number;
}
