/**
 * The selected day as tracks on one clock: where you were, what played, who
 * wrote, what you looked up, how much you walked, how fast your heart beat.
 *
 * Pure (no DB, no DOM). Times are minutes since the day's midnight on the
 * record's own wall clock, so every track shares one 24-hour axis. On the night
 * the clocks go forward an hour of it stays empty, and on the night they go
 * back the repeated hour lands on the same stretch of the axis: the stored
 * timestamps are wall-clock digits, and they say nothing about which of the
 * two 01:30s a reading was.
 */
import type { ColorStop } from '#lib/visualizations/signalGrid.ts';

/** Minutes in the day's axis. */
export const DAY_MINUTES = 1440;

/** Quarter-hours on the day's axis — the resolution of the steps and heart-rate tracks. */
export const QUARTERS_PER_DAY = 96;

const clampToDay = (minute: number) => Math.min(DAY_MINUTES, Math.max(0, minute));

// ---------------------------------------------------------------------------
// Positions
// ---------------------------------------------------------------------------

/**
 * A position as the day's query returns it: a stay, or a stretch of movement
 * folded to the minute. Only what every recorder writes — times, coordinates,
 * distance — so a phone's history and a watch's read the same way.
 */
export interface PositionRow {
    /** Minutes since midnight; below 0 for a stay that began the day before. */
    start: number;
    /** Past {@link DAY_MINUTES} for one that runs on into the next day. */
    end: number;
    stationary: boolean;
    lat: number;
    lon: number;
    /** The nearest town, once the points have been located; null before. */
    city: string | null;
    meters: number;
}

/** Minutes in one point of the speed curve. */
export const SPEED_BIN_MINUTES = 5;

/** How fast you went in one stretch of the day, and how far. */
export interface SpeedBin {
    kmh: number;
    km: number;
}

/**
 * The day's speed, one figure per {@link SPEED_BIN_MINUTES}, null where
 * nothing was recorded.
 *
 * A stretch's distance is spread over the minutes it lasted, so a phone's leg
 * of ten minutes adds to both of the bins it crosses rather than all to the
 * first. A bin's speed is its distance over the minutes something was recorded
 * in it — a stay counts, at no distance — so a watch switched on halfway
 * through a bin is not read as going half as fast.
 *
 * @param rows ordered by start, as `getDayTimeline` returns them.
 */
export function speedBins(
    rows: PositionRow[],
    binMinutes = SPEED_BIN_MINUTES
): (SpeedBin | null)[] {
    const covered = new Uint8Array(DAY_MINUTES);
    const meters = new Float64Array(DAY_MINUTES);

    for (const row of rows) {
        if (row.start >= DAY_MINUTES || row.end < 0) continue;
        const from = clampToDay(row.start);
        const to = clampToDay(Math.max(row.start, row.end));
        if (to <= from) {
            // A single fix: its distance, if any, lands in its own minute.
            const minute = Math.min(DAY_MINUTES - 1, Math.floor(from));
            covered[minute] = 1;
            meters[minute] += row.meters;
            continue;
        }
        const length = Math.max(row.end, row.start) - row.start;
        for (let minute = Math.floor(from); minute < Math.ceil(to); minute++) {
            const overlap = Math.min(to, minute + 1) - Math.max(from, minute);
            if (overlap <= 0) continue;
            covered[minute] = 1;
            meters[minute] += (row.meters * overlap) / length;
        }
    }

    const bins: (SpeedBin | null)[] = [];
    for (let first = 0; first < DAY_MINUTES; first += binMinutes) {
        let minutes = 0;
        let distance = 0;
        for (let minute = first; minute < first + binMinutes; minute++) {
            minutes += covered[minute];
            distance += meters[minute];
        }
        if (minutes === 0) {
            bins.push(null);
            continue;
        }
        const km = distance / 1000;
        bins.push({ km, kmh: km / (minutes / 60) });
    }
    return bins;
}

/**
 * Positions further apart in time than this are not one trip: the recorder was
 * off between them, and nothing is drawn or placed across the gap.
 */
export const JOIN_GAP_MINUTES = 15;

/**
 * Where you were at minute `at`: the stay or minute of movement covering it,
 * else a point between the positions either side when they are close enough in
 * time to have been one trip, else nowhere — the recorder was off.
 */
export function positionAt(points: PositionRow[], at: number): { lat: number; lon: number } | null {
    let before: PositionRow | null = null;
    let after: PositionRow | null = null;
    for (const p of points) {
        if (p.start <= at && at <= Math.max(p.start, p.end)) return { lat: p.lat, lon: p.lon };
        if (p.end < at && (!before || p.end > before.end)) before = p;
        if (p.start > at && (!after || p.start < after.start)) after = p;
    }
    if (!before || !after || after.start - before.end > JOIN_GAP_MINUTES) return null;
    const t = (at - before.end) / (after.start - before.end);
    return {
        lat: before.lat + (after.lat - before.lat) * t,
        lon: before.lon + (after.lon - before.lon) * t,
    };
}

/**
 * Kilometres travelled on the day, by the rule the year's lanes count by: each
 * moving leg on the day it started. A night train that left the evening before
 * belongs to that evening, even though its span reaches into this morning.
 */
export function dayKm(rows: PositionRow[]): number {
    let meters = 0;
    for (const row of rows) {
        if (!row.stationary && row.start >= 0 && row.start < DAY_MINUTES) meters += row.meters;
    }
    return meters / 1000;
}

// ---------------------------------------------------------------------------
// Listening
// ---------------------------------------------------------------------------

/** One play on the day's axis. */
export interface PlaySpan {
    /** Minutes since midnight the play is stamped at. */
    start: number;
    /** How long it played, in minutes; null when the service does not say (Last.fm). */
    minutes: number | null;
    track: string | null;
    artist: string | null;
}

/** Plays close enough together to read as one sitting. */
export interface ListeningSession {
    start: number;
    end: number;
    plays: number;
    /** Minutes actually played — the plays' durations, not the session's span. */
    minutes: number;
}

/**
 * How long the music may stop inside one sitting: long enough for a change of
 * album or a phone call, short enough that the commute and the evening stay two.
 */
export const SESSION_GAP_MINUTES = 10;

/**
 * Group the day's plays into sittings.
 *
 * @param plays ordered by start.
 */
export function listeningSessions(
    plays: PlaySpan[],
    gapMinutes = SESSION_GAP_MINUTES
): ListeningSession[] {
    const sessions: ListeningSession[] = [];
    for (const play of plays) {
        const minutes = play.minutes ?? 0;
        const end = play.start + minutes;
        const last = sessions[sessions.length - 1];
        if (last && play.start - last.end <= gapMinutes) {
            last.end = Math.max(last.end, end);
            last.plays += 1;
            last.minutes += minutes;
        } else {
            sessions.push({ start: play.start, end, plays: 1, minutes });
        }
    }
    return sessions;
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

/** One message on the day's axis. */
export interface MessageTick {
    /** The thread it belongs to, on its network: one conversation. */
    conversation: string;
    /** Who the conversation is with: the other person, or the group's name. */
    contact: string;
    /** Who wrote the message — in a group, one of its members. */
    sender: string;
    /** The start of the message, or what it carried when it had no text: "(photo)". */
    text: string;
    minute: number;
    sent: boolean;
}

/** One conversation's messages that day. */
export interface ConversationMessages {
    conversation: string;
    contact: string;
    count: number;
    sent: number;
    received: number;
    /** Each message, in order: its minute, whether you sent it, who wrote it, how it starts. */
    messages: { minute: number; sent: boolean; sender: string; text: string }[];
}

/**
 * The day's messages, one row per conversation, busiest first: the same person
 * on two networks is two conversations, and a group is one however many write
 * in it.
 *
 * Ties are broken on the name by code point rather than by the reader's
 * locale, so the order is the same on every machine.
 *
 * @param messages ordered by time.
 */
export function messagesByConversation(messages: MessageTick[]): ConversationMessages[] {
    const byConversation = new Map<string, ConversationMessages>();
    for (const message of messages) {
        let row = byConversation.get(message.conversation);
        if (!row) {
            row = {
                conversation: message.conversation,
                contact: message.contact,
                count: 0,
                sent: 0,
                received: 0,
                messages: [],
            };
            byConversation.set(message.conversation, row);
        }
        row.count += 1;
        if (message.sent) row.sent += 1;
        else row.received += 1;
        row.messages.push({
            minute: message.minute,
            sent: message.sent,
            sender: message.sender,
            text: message.text,
        });
    }
    return [...byConversation.values()].sort(
        (a, b) => b.count - a.count || (a.contact < b.contact ? -1 : a.contact > b.contact ? 1 : 0)
    );
}

// ---------------------------------------------------------------------------
// Quarter-hour tracks
// ---------------------------------------------------------------------------

/** One quarter-hour's figure, as the day's steps and heart-rate queries return it. */
export interface QuarterValue {
    /** 0–95: the quarter-hour of the wall clock. */
    quarter: number;
    value: number;
}

/**
 * The day's heart rate at rest, read as its calmest quarter-hour: the lowest
 * quarter-hour mean, which over a night's sleep is close to what a watch calls
 * resting. Null for a day with no reading.
 */
export function restingBpm(quarters: (number | null)[]): number | null {
    let lowest: number | null = null;
    for (const value of quarters) {
        if (value !== null && (lowest === null || value < lowest)) lowest = value;
    }
    return lowest === null ? null : Math.round(lowest);
}

/** A quarter-hour track: one figure per quarter, null where nothing was recorded. */
export function quarterSeries(rows: QuarterValue[]): (number | null)[] {
    const series: (number | null)[] = new Array(QUARTERS_PER_DAY).fill(null);
    for (const row of rows) {
        if (row.quarter >= 0 && row.quarter < QUARTERS_PER_DAY) series[row.quarter] = row.value;
    }
    return series;
}

// ---------------------------------------------------------------------------
// The whole day
// ---------------------------------------------------------------------------

/** One Google activity entry on the day's axis. */
export interface ActivityEvent {
    minute: number;
    /** 'youtube', 'search', 'maps'… — see `SERVICE_LABELS`. */
    service: string;
    /** 'watched', 'searched', 'viewed'… */
    action: string;
    /** The video title, the query, the place. */
    label: string;
}

/** The selected day, track by track; null for a module that is not loaded. */
export interface DayTimeline {
    /** 'YYYY-MM-DD' */
    date: string;
    positions: {
        /** See {@link speedBins}. */
        bins: (SpeedBin | null)[];
        /** See {@link dayKm}. */
        km: number;
        /** Every stay and minute of movement touching the day, for the map. */
        points: PositionRow[];
    } | null;
    listening: {
        plays: PlaySpan[];
        sessions: ListeningSession[];
    } | null;
    messages: ConversationMessages[] | null;
    activity: ActivityEvent[] | null;
    /**
     * Steps per quarter-hour. A packet counts in the quarter its window closed
     * in, which is where the steps explorer places it too.
     */
    steps: (number | null)[] | null;
    heartRate: {
        /** Mean heart rate per quarter-hour. */
        quarters: (number | null)[];
        /** The health explorer's ramp to paint it on; empty without a heart-rate history. */
        stops: ColorStop[];
    } | null;
}
