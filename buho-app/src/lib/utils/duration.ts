/**
 * Format a duration in minutes into a human-readable string.
 * Raw minute counts ("5000 min") are hard to grasp; switch to hours
 * (the natural unit for listening time) past one hour.
 */
export function formatDuration(minutes: number): string {
    if (!Number.isFinite(minutes)) return '—';
    const rounded = Math.round(minutes);
    if (Math.abs(rounded) < 60) return `${rounded.toLocaleString()} min`;

    const hours = minutes / 60;
    if (Math.abs(hours) < 10) {
        // One decimal under 10h so small differences stay visible (e.g. "2.5 h")
        const value = Math.round(hours * 10) / 10;
        return `${value.toLocaleString()} h`;
    }
    return `${Math.round(hours).toLocaleString()} h`;
}

/**
 * Format a listening duration with at most two adjacent units
 * (years / days / hours / minutes / seconds), most-significant first.
 * The secondary unit is dropped when it is zero ("2 days", not "2 days 0 hours").
 *
 * Hours roll up into days only past 72 h: below that the value stays in
 * hours ("71 hours 43 minutes"), at/above it days appear ("3 days 1 hour").
 * This handoff mirrors the explorer's 72 h hour-of-day cap. Days roll up into
 * years at 365 days ("1 year 12 days").
 */
export function formatDurationLong(minutes: number): string {
    if (!Number.isFinite(minutes)) return '—';
    const totalSeconds = Math.max(0, Math.round(minutes * 60));

    const YEAR = 365 * 86400;
    const DAY = 86400;
    const HOUR = 3600;
    const MIN = 60;

    let primary: [number, string];
    let secondary: [number, string];
    if (totalSeconds >= YEAR) {
        primary = [Math.floor(totalSeconds / YEAR), 'year'];
        secondary = [Math.floor((totalSeconds % YEAR) / DAY), 'day'];
    } else if (totalSeconds >= 72 * HOUR) {
        primary = [Math.floor(totalSeconds / DAY), 'day'];
        secondary = [Math.floor((totalSeconds % DAY) / HOUR), 'hour'];
    } else if (totalSeconds >= HOUR) {
        primary = [Math.floor(totalSeconds / HOUR), 'hour'];
        secondary = [Math.floor((totalSeconds % HOUR) / MIN), 'minute'];
    } else if (totalSeconds >= MIN) {
        primary = [Math.floor(totalSeconds / MIN), 'minute'];
        secondary = [totalSeconds % MIN, 'second'];
    } else {
        primary = [totalSeconds, 'second'];
        secondary = [0, 'second'];
    }

    const unit = ([n, label]: [number, string]) =>
        `${n.toLocaleString()} ${label}${n === 1 ? '' : 's'}`;

    return secondary[0] > 0 ? `${unit(primary)} ${unit(secondary)}` : unit(primary);
}
