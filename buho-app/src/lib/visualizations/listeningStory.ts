import type { ConnectablePoint } from '#lib/data/queries/behaviorQueries.ts';

/**
 * The narrative helpers behind the guide's opening act, where the whole listening
 * history is introduced one play at a time.
 *
 * They are pure functions over the constellation points so the guide page and the
 * canvas agree on the same day and the same wording, and so the choices below stay
 * testable.
 *
 * Timestamps: `ConnectablePoint.x` comes from `epoch(timestamp)` on a *local
 * wall-clock* column, so it is "local time read as UTC". Every calendar operation
 * here therefore works in UTC, which keeps it consistent with the `playedAt`
 * string and free of timezone arithmetic.
 */

export const DAY_MS = 86_400_000;

export interface FocusDay {
    /** 'YYYY-MM-DD'. */
    date: string;
    /** Midnight of that day, in the points' own (UTC-read) time base. */
    startMs: number;
    /** The day's plays, oldest first. */
    points: ConnectablePoint[];
}

function metaString(point: ConnectablePoint, key: string): string | null {
    const value = point.metadata?.[key];
    return typeof value === 'string' && value.length > 0 ? value : null;
}

export function trackOf(point: ConnectablePoint): string {
    return metaString(point, 'track') ?? 'an untitled track';
}

export function artistOf(point: ConnectablePoint): string {
    return metaString(point, 'artist') ?? 'an unknown artist';
}

/** 'YYYY-MM-DD' of a play, from the stored wall-clock string when it is there. */
export function dayKeyOf(point: ConnectablePoint): string {
    const playedAt = metaString(point, 'playedAt');
    if (playedAt && playedAt.length >= 10) return playedAt.slice(0, 10);
    return new Date(point.x).toISOString().slice(0, 10);
}

/** 'HH:MM' of a play, straight from its fractional hour. */
export function clockOf(point: ConnectablePoint): string {
    const total = Math.round(point.y * 60);
    const hours = Math.floor(total / 60) % 24;
    const minutes = total % 60;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/** Midnight of a 'YYYY-MM-DD' key, in the points' time base. */
export function dayStartMs(dayKey: string): number {
    return Date.parse(`${dayKey}T00:00:00Z`);
}

/**
 * A play's day with the time of day removed. The guide plots this rather than the
 * raw timestamp: the hour is already the vertical axis, so leaving it on the
 * horizontal one too would tilt every day into a diagonal.
 */
export function dayStartOf(point: ConnectablePoint): number {
    return Math.floor(point.x / DAY_MS) * DAY_MS;
}

/**
 * A long date ("Tuesday 14 March 2023") in the browser's locale, formatted in UTC
 * so it names the same day as the key it was built from.
 */
export function formatDayLabel(dayKey: string): string {
    const parsed = dayStartMs(dayKey);
    if (!Number.isFinite(parsed)) return dayKey;
    return new Date(parsed).toLocaleDateString(undefined, {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
    });
}

/** A day worth narrating runs across the waking hours, not one dense burst. */
const MIN_SPREAD_HOURS = 8;

/**
 * The busiest day of an export is usually a one-off outlier, and a thread of a few
 * dozen plays reads better on screen than one of several hundred — so aim high but
 * not at the top.
 */
const FOCUS_PERCENTILE = 0.85;

/**
 * The day the opening act zooms in on: busy enough to be interesting, spread out
 * enough to show a rhythm. Deterministic for a given set of points.
 */
export function pickFocusDay(points: ConnectablePoint[]): FocusDay | null {
    if (points.length === 0) return null;

    const byDay = new Map<string, ConnectablePoint[]>();
    for (const point of points) {
        const key = dayKeyOf(point);
        const bucket = byDay.get(key);
        if (bucket) bucket.push(point);
        else byDay.set(key, [point]);
    }

    const days = [...byDay.entries()].map(([date, dayPoints]) => ({
        date,
        dayPoints,
        spread: new Set(dayPoints.map((p) => Math.floor(p.y))).size,
    }));

    const spreadOut = days.filter((d) => d.spread >= MIN_SPREAD_HOURS);
    const pool = spreadOut.length > 0 ? spreadOut : days;

    const ranked = pool
        .slice()
        .sort(
            (a, b) =>
                a.dayPoints.length - b.dayPoints.length ||
                (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)
        );

    let index = Math.min(
        ranked.length - 1,
        Math.max(0, Math.round(FOCUS_PERCENTILE * (ranked.length - 1)))
    );
    // Ties are sorted oldest first, so walking forward lands on the most recent
    // day with that play count.
    const count = ranked[index].dayPoints.length;
    while (index + 1 < ranked.length && ranked[index + 1].dayPoints.length === count) {
        index += 1;
    }

    const chosen = ranked[index];
    return {
        date: chosen.date,
        startMs: dayStartMs(chosen.date),
        points: chosen.dayPoints.slice().sort((a, b) => a.x - b.x),
    };
}

/** "08:42 to 23:10" for a day's plays — the span, not the time spent listening. */
export function spanLabel(dayPoints: ConnectablePoint[]): string | null {
    if (dayPoints.length === 0) return null;
    const first = clockOf(dayPoints[0]);
    const last = clockOf(dayPoints[dayPoints.length - 1]);
    return first === last ? first : `${first} to ${last}`;
}
