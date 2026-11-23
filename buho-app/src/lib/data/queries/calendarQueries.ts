/**
 * The calendar's reads: what each module recorded, year by year, day by day,
 * and across one day quarter-hour by quarter-hour.
 *
 * One rule places every record on a day: the calendar day, midnight to
 * midnight, of its own stored wall-clock time. That is the `date` column every
 * table carries and every module page counts by, so a day here is the same day
 * there. Positions are read from the positions themselves rather than from
 * `position_days`, whose days run 04:00 to 04:00.
 *
 * Every read takes `loaded` — `dataStore.loaded` — and leaves a module that is
 * not loaded alone: no SQL is sent for it, and it comes back null.
 *
 * The totals say how much each service was used, not how much of a life it
 * saw: a year of listening is the minutes the exports logged, a year of health
 * the days the watch recorded a heart rate on.
 */
import { DATA_MODULES, type ModuleId } from '#lib/data/modules.ts';
import type { HealthMetric } from '#lib/types/health.ts';
import type { ColorStop } from '#lib/visualizations/signalGrid.ts';
import { rampFor } from '#lib/visualizations/healthRamp.ts';
import type { DayValue } from '#lib/calendar/days.ts';
import type { YearSummary } from '#lib/calendar/years.ts';
import type { HealthZones, PositionDay, YearData } from '#lib/calendar/yearData.ts';
import type { QuarterCell } from '#lib/calendar/clock.ts';
import { dayBeats, zoneDays } from '#lib/calendar/zones.ts';
import {
    dayKm,
    listeningSessions,
    messagesByConversation,
    speedBins,
    quarterSeries,
    type ActivityEvent,
    type DayTimeline,
    type MessageTick,
    type PlaySpan,
    type PositionRow,
    type QuarterValue,
} from '#lib/calendar/timeline.ts';
import { query } from '../db';
import { measureSql, type Measure } from '../sql/measure';
import { isIsoDate, type DateRange, type SqlNumber, type SqlText } from './common';
import { getHealthMetrics, getHealthSlots, SLOT_MINUTES } from './healthQueries';
import { getDailyListeningCalendar } from './temporalQueries';

/** Which modules hold data — `dataStore.loaded`. */
export type LoadedModules = Record<ModuleId, boolean>;

const HEART_RATE: HealthMetric = 'heart_rate';

/** Kilometres over a group of position rows: the moving legs' lengths. */
const KM_SQL = `COALESCE(SUM(distance_meters) FILTER (WHERE segment_type = 'moving'), 0) / 1000.0`;

/** The position rows every positions view reads — the ones that have a place. */
const PLACED_SQL = 'lat IS NOT NULL AND lon IS NOT NULL';

/** Minutes since the day's midnight of a row's `timestamp`, on a table whose `date` is its day. */
const MINUTE_OF_DAY_SQL = 'CAST((epoch(timestamp) - epoch(date)) / 60.0 AS DOUBLE)';

/** The wall-clock quarter-hour of a row's `timestamp`, 0–95. */
const QUARTER_SQL = 'CAST(FLOOR((hour(timestamp) * 60 + minute(timestamp)) / 15) AS INTEGER)';

// ---------------------------------------------------------------------------
// Years
// ---------------------------------------------------------------------------

interface YearTotal {
    from: 'plays' | 'positions' | 'messages' | 'google_activity' | 'steps' | 'health_readings';
    total: string;
    where?: string;
}

/** What a module's year adds up to, and where it reads it from. */
function yearTotal(module: ModuleId, measure: Measure): YearTotal {
    switch (module) {
        case 'listening':
            return { from: 'plays', total: `COALESCE(${measureSql(measure)}, 0)` };
        case 'positions':
            return { from: 'positions', total: KM_SQL, where: PLACED_SQL };
        case 'messages':
            return { from: 'messages', total: 'COUNT(*)' };
        case 'activity':
            return { from: 'google_activity', total: 'COUNT(*)' };
        case 'steps':
            return { from: 'steps', total: 'COALESCE(SUM(steps), 0)' };
        case 'health':
            return {
                from: 'health_readings',
                total: 'COUNT(DISTINCT date)',
                where: `metric = '${HEART_RATE}'`,
            };
    }
}

/**
 * Every year of every loaded module: its total and the first and last day it
 * recorded anything on, which is what lets the picker say "from 10 Mar".
 *
 * Totals are in each module's own unit: minutes listened (plays, under the
 * plays measure), kilometres travelled, messages sent and received, Google
 * activity entries, steps, and days with a heart-rate reading.
 *
 * @param measure what listening counts — `listeningMeasure.measure`.
 */
export async function getYearSummaries(
    loaded: LoadedModules,
    measure: Measure = 'minutes'
): Promise<YearSummary[]> {
    const summaries: YearSummary[] = [];

    for (const { id: module } of DATA_MODULES) {
        if (!loaded[module]) continue;
        const { from, total, where } = yearTotal(module, measure);
        const sql = `
            SELECT
                CAST(YEAR(date) AS INTEGER) AS year,
                CAST(${total} AS DOUBLE) AS total,
                CAST(MIN(date) AS VARCHAR) AS first_day,
                CAST(MAX(date) AS VARCHAR) AS last_day
            FROM ${from}
            WHERE date IS NOT NULL${where ? ` AND ${where}` : ''}
            GROUP BY 1
            ORDER BY 1
        `;

        try {
            const rows = await query<{
                year: SqlNumber;
                total: SqlNumber;
                firstDay: SqlText;
                lastDay: SqlText;
            }>(sql);
            for (const row of rows) {
                summaries.push({
                    module,
                    year: Number(row.year),
                    total: Number(row.total) || 0,
                    firstDay: String(row.firstDay),
                    lastDay: String(row.lastDay),
                });
            }
        } catch (error) {
            console.error(`Failed to total the years of ${module}:`, error);
        }
    }

    return summaries;
}

// ---------------------------------------------------------------------------
// One year, day by day
// ---------------------------------------------------------------------------

export interface YearDataOptions {
    /** What listening counts — `listeningMeasure.measure`. */
    measure?: Measure;
    /**
     * The heart-rate ramp, when the caller already holds it (see
     * {@link getHeartRateStops}). It depends on the whole history, not on the
     * year, so a page switching years need not recompute it every time.
     */
    heartRateStops?: ColorStop[] | null;
}

/**
 * The health explorer's ramp for heart rate, from the whole history — the
 * stops the calendar cuts its zones at. Empty when there is no heart rate.
 */
export async function getHeartRateStops(): Promise<ColorStop[]> {
    const summary = (await getHealthMetrics()).find((s) => s.metric === HEART_RATE);
    return summary ? rampFor(summary) : [];
}

/**
 * One year of every loaded module, a day per entry, only the days it recorded
 * something on. What the lanes, the week calendar and the parallel coordinates
 * draw; `dailyFigures` and `buildYearDays` rank it.
 */
export async function getYearData(
    year: number,
    loaded: LoadedModules,
    options: YearDataOptions = {}
): Promise<YearData> {
    const data: YearData = {
        year,
        listening: null,
        positions: null,
        messages: null,
        activity: null,
        steps: null,
        health: null,
    };
    if (!Number.isInteger(year) || year < 1000 || year > 9999) return data;
    const range = { startDate: `${year}-01-01`, endDate: `${year}-12-31` };

    if (loaded.listening) {
        data.listening = await getDailyListeningCalendar(options.measure ?? 'minutes', range);
    }
    if (loaded.positions) data.positions = await getPositionDays(range);
    if (loaded.messages) data.messages = await getDailyCounts('messages', 'COUNT(*)', range);
    if (loaded.activity) {
        data.activity = await getDailyCounts('google_activity', 'COUNT(*)', range);
    }
    if (loaded.steps) data.steps = await getDailyCounts('steps', 'SUM(steps)', range);
    if (loaded.health) data.health = await getHeartRateZones(range, options.heartRateStops);
    return data;
}

/** One figure a day from one table, for the days in `range` that have rows. */
async function getDailyCounts(
    from: 'messages' | 'google_activity' | 'steps',
    figure: string,
    range: DateRange
): Promise<DayValue[]> {
    const sql = `
        SELECT CAST(date AS VARCHAR) AS date, CAST(${figure} AS DOUBLE) AS value
        FROM ${from}
        WHERE date BETWEEN CAST($1 AS DATE) AND CAST($2 AS DATE)
        GROUP BY date
        ORDER BY date
    `;

    try {
        const rows = await query<{ date: string; value: SqlNumber }>(sql, [
            range.startDate,
            range.endDate,
        ]);
        return rows.map((row) => ({ date: String(row.date), value: Number(row.value) || 0 }));
    } catch (error) {
        console.error(`Failed to count ${from} per day:`, error);
        return [];
    }
}

/**
 * The hour the night before a day starts: the last located position between
 * then and 04:00 says where the night was spent. With none — the recorder was
 * off — the day's first located position says where it began instead.
 */
const NIGHT_FROM_HOUR = 16;

/**
 * Kilometres a day, and the town each day began in.
 *
 * The town is the one nearest to where you were at 04:00 — the last located
 * position of the night before it (see {@link NIGHT_FROM_HOUR}), or else the
 * day's first — as zone attribution named it from the coordinates alone. It needs no
 * place a recorder labelled, so a watch's tracks name their towns as a phone's
 * history does. Null until attribution has run.
 */
async function getPositionDays(range: DateRange): Promise<PositionDay[]> {
    const sql = `
        WITH km AS (
            SELECT date, ${KM_SQL} AS km
            FROM positions
            WHERE date BETWEEN CAST($1 AS DATE) AND CAST($2 AS DATE) AND ${PLACED_SQL}
            GROUP BY date
        ),
        located AS (
            SELECT timestamp, nearest_city
            FROM positions
            WHERE nearest_city IS NOT NULL
              AND timestamp >= CAST($1 AS DATE) - INTERVAL 1 DAY
              AND timestamp < CAST($2 AS DATE) + INTERVAL 1 DAY
        ),
        -- The night before each day: from ${NIGHT_FROM_HOUR}:00 the evening before to 04:00,
        -- shifted onto the day it leads into.
        night AS (
            SELECT
                CAST(timestamp + INTERVAL ${24 - NIGHT_FROM_HOUR} HOUR AS DATE) AS date,
                arg_max(nearest_city, timestamp) AS city
            FROM located
            WHERE hour(timestamp) >= ${NIGHT_FROM_HOUR} OR hour(timestamp) < 4
            GROUP BY 1
        ),
        morning AS (
            SELECT CAST(timestamp AS DATE) AS date, arg_min(nearest_city, timestamp) AS city
            FROM located
            GROUP BY 1
        )
        SELECT
            CAST(km.date AS VARCHAR) AS date,
            CAST(km.km AS DOUBLE) AS km,
            COALESCE(night.city, morning.city) AS city
        FROM km
        LEFT JOIN night ON night.date = km.date
        LEFT JOIN morning ON morning.date = km.date
        ORDER BY km.date
    `;

    try {
        const rows = await query<{ date: string; km: SqlNumber; city: SqlText }>(sql, [
            range.startDate,
            range.endDate,
        ]);
        return rows.map((row) => ({
            date: String(row.date),
            km: Number(row.km) || 0,
            city: row.city || null,
        }));
    } catch (error) {
        console.error('Failed to read positions per day:', error);
        return [];
    }
}

/**
 * Minutes a day in each heart-rate band, cut where the health explorer cuts
 * them (see `zoneDays`).
 */
async function getHeartRateZones(
    range: DateRange,
    known: ColorStop[] | null | undefined
): Promise<HealthZones> {
    const stops = known ?? (await getHeartRateStops());
    if (stops.length === 0) return { stops, days: [], beats: [] };
    const slots = await getHealthSlots(HEART_RATE, range);
    return {
        stops,
        days: zoneDays(slots, stops, SLOT_MINUTES),
        beats: dayBeats(slots, SLOT_MINUTES),
    };
}

// ---------------------------------------------------------------------------
// One year, quarter-hour by quarter-hour
// ---------------------------------------------------------------------------

/**
 * Fewer steps than this in a quarter-hour is moving about a room, not
 * walking: a watch counts a few nearly every quarter-hour of the waking day.
 */
const WALKING_STEPS = 100;

/**
 * What each module counts per quarter-hour, and the least that makes a
 * quarter-hour count — anything at all, unless said otherwise.
 */
const PER_QUARTER: Partial<
    Record<ModuleId, { from: string; value: string; where?: string; least?: number }>
> = {
    listening: { from: 'plays', value: 'COUNT(*)' },
    positions: { from: 'positions', value: KM_SQL, where: PLACED_SQL },
    messages: { from: 'messages', value: 'COUNT(*)' },
    activity: { from: 'google_activity', value: 'COUNT(*)' },
    steps: { from: 'steps', value: 'COALESCE(SUM(steps), 0)', least: WALKING_STEPS },
    health: { from: 'health_readings', value: 'AVG(value)', where: `metric = '${HEART_RATE}'` },
};

/**
 * Every loaded module quarter-hour by quarter-hour across the year — plays,
 * kilometres, messages, entries, steps — for the year's clock. Only the
 * quarter-hours something happened in — for steps, the ones you walked in
 * (see {@link WALKING_STEPS}) — each record in the one its timestamp falls in,
 * as on the day's tracks. Health comes as each quarter-hour's average heart
 * rate, which the clock paints on its own, never among the rest: a watch
 * reads the heart all the time it is worn, which says nothing of what the
 * time held.
 */
export async function getYearQuarters(
    year: number,
    loaded: LoadedModules
): Promise<Partial<Record<ModuleId, QuarterCell[]>>> {
    const quarters: Partial<Record<ModuleId, QuarterCell[]>> = {};
    if (!Number.isInteger(year) || year < 1000 || year > 9999) return quarters;
    for (const { id } of DATA_MODULES) {
        const spec = PER_QUARTER[id];
        if (!spec || !loaded[id]) continue;
        const sql = `
            SELECT
                CAST(date AS VARCHAR) AS date,
                ${QUARTER_SQL} AS quarter,
                CAST(${spec.value} AS DOUBLE) AS value
            FROM ${spec.from}
            WHERE date BETWEEN CAST($1 AS DATE) AND CAST($2 AS DATE)${spec.where ? ` AND ${spec.where}` : ''}
            GROUP BY 1, 2
            HAVING ${spec.least ? `${spec.value} >= ${spec.least}` : `${spec.value} > 0`}
            ORDER BY 1, 2
        `;
        try {
            const rows = await query<{ date: string; quarter: SqlNumber; value: SqlNumber }>(sql, [
                `${year}-01-01`,
                `${year}-12-31`,
            ]);
            quarters[id] = rows.map((row) => ({
                date: String(row.date),
                quarter: Number(row.quarter),
                value: Number(row.value) || 0,
            }));
        } catch (error) {
            console.error(`Failed to read ${id} quarter-hour by quarter-hour:`, error);
        }
    }
    return quarters;
}

// ---------------------------------------------------------------------------
// One day
// ---------------------------------------------------------------------------

export interface DayTimelineOptions {
    /** As in {@link YearDataOptions}: the heart-rate ramp, when already held. */
    heartRateStops?: ColorStop[] | null;
}

/**
 * Everything every loaded module recorded on one day, as tracks on its clock.
 *
 * @param date 'YYYY-MM-DD'; anything else comes back with every track empty.
 */
export async function getDayTimeline(
    date: string,
    loaded: LoadedModules,
    options: DayTimelineOptions = {}
): Promise<DayTimeline> {
    const timeline: DayTimeline = {
        date,
        positions: null,
        listening: null,
        messages: null,
        activity: null,
        steps: null,
        heartRate: null,
    };
    if (!isIsoDate(date)) return timeline;

    if (loaded.positions) {
        const rows = await readDay<PositionRow>(POSITION_ROWS_SQL, date, toPositionRow);
        timeline.positions = { bins: speedBins(rows), km: dayKm(rows), points: rows };
    }
    if (loaded.listening) {
        const plays = await readDay<PlaySpan>(PLAYS_SQL, date, toPlaySpan);
        timeline.listening = { plays, sessions: listeningSessions(plays) };
    }
    if (loaded.messages) {
        timeline.messages = messagesByConversation(
            await readDay<MessageTick>(MESSAGES_SQL, date, toMessageTick)
        );
    }
    if (loaded.activity) {
        timeline.activity = await readDay<ActivityEvent>(ACTIVITY_SQL, date, toActivityEvent);
    }
    if (loaded.steps) {
        timeline.steps = quarterSeries(await readDay<QuarterValue>(STEPS_SQL, date, toQuarter));
    }
    if (loaded.health) {
        timeline.heartRate = {
            quarters: quarterSeries(await readDay<QuarterValue>(HEART_RATE_SQL, date, toQuarter)),
            stops: options.heartRateStops ?? (await getHeartRateStops()),
        };
    }
    return timeline;
}

/** Run one of the day's statements for `date` (bound as `$1`) and shape its rows. */
async function readDay<T>(
    sql: string,
    date: string,
    shape: (row: Record<string, unknown>) => T
): Promise<T[]> {
    try {
        return (await query<Record<string, unknown>>(sql, [date])).map(shape);
    } catch (error) {
        console.error(`Failed to read ${date} for the calendar:`, error);
        return [];
    }
}

const num = (value: unknown): number => Number(value) || 0;
const text = (value: unknown): string | null =>
    typeof value === 'string' && value !== '' ? value : null;

/**
 * How far back a stay may have begun and still reach into the day.
 *
 * The overlap itself is a test on `end_timestamp`, which the engine cannot
 * skip whole blocks of rows with; a bound on `timestamp` it can, so the read
 * covers a month of positions rather than the whole history before the day. A
 * single stay longer than that, with not one recorded movement, is not drawn.
 */
const STAY_LOOKBACK_DAYS = 31;

/**
 * Every position that touches the day — a stay begun the night before
 * included, with a start before midnight that `speedBins` clips — read from
 * what every recorder writes: times, coordinates and distance.
 *
 * Moving rows without a distance are left out: on a phone those are the
 * activities Timeline inferred, laid over the path that actually carries the
 * kilometres, and on a watch the closing fix of a track. Moving legs come back
 * one row per minute, so an hour's run recorded every second crosses as 60 rows
 * rather than 3,600; stays come back as they are.
 */
const POSITION_ROWS_SQL = `
    WITH s AS (
        SELECT *
        FROM positions
        WHERE timestamp < CAST($1 AS DATE) + INTERVAL 1 DAY
          AND timestamp >= CAST($1 AS DATE) - INTERVAL ${STAY_LOOKBACK_DAYS} DAY
          AND COALESCE(end_timestamp, timestamp) >= CAST($1 AS DATE)
          AND ${PLACED_SQL}
          AND NOT (segment_type = 'moving' AND distance_meters IS NULL)
    ),
    legs AS (
        SELECT
            MIN(timestamp) AS started,
            MAX(COALESCE(end_timestamp, timestamp)) AS ended,
            segment_type = 'stationary' AS stationary,
            AVG(lat) AS lat,
            AVG(lon) AS lon,
            mode(nearest_city) AS city,
            SUM(COALESCE(distance_meters, 0)) AS meters
        FROM s
        GROUP BY
            CASE WHEN segment_type = 'stationary' THEN timestamp
                 ELSE date_trunc('minute', timestamp) END,
            segment_type = 'stationary'
    )
    SELECT
        CAST((epoch(started) - epoch(CAST($1 AS DATE))) / 60.0 AS DOUBLE) AS start_minute,
        CAST((epoch(ended) - epoch(CAST($1 AS DATE))) / 60.0 AS DOUBLE) AS end_minute,
        stationary,
        CAST(lat AS DOUBLE) AS lat,
        CAST(lon AS DOUBLE) AS lon,
        city,
        CAST(meters AS DOUBLE) AS meters
    FROM legs
    ORDER BY started
`;

function toPositionRow(row: Record<string, unknown>): PositionRow {
    return {
        start: num(row.startMinute),
        end: num(row.endMinute),
        stationary: row.stationary === true,
        lat: num(row.lat),
        lon: num(row.lon),
        city: text(row.city),
        meters: num(row.meters),
    };
}

const PLAYS_SQL = `
    SELECT
        ${MINUTE_OF_DAY_SQL} AS start_minute,
        CAST(ms_played / 60000.0 AS DOUBLE) AS minutes,
        track_name AS track,
        artist_name AS artist
    FROM plays
    WHERE date = CAST($1 AS DATE)
    ORDER BY timestamp
`;

function toPlaySpan(row: Record<string, unknown>): PlaySpan {
    return {
        start: num(row.startMinute),
        minutes: row.minutes == null ? null : Number(row.minutes),
        track: text(row.track),
        artist: text(row.artist),
    };
}

/**
 * How much of each message the day's read takes: enough for the start the
 * tooltip quotes, not a whole conversation's text crossing over per hover.
 */
const MESSAGE_PREVIEW_LENGTH = 120;

const MESSAGES_SQL = `
    SELECT
        network || ':' || thread AS conversation,
        COALESCE(contact, thread) AS contact,
        sender,
        CASE
            WHEN COALESCE(text, '') <> '' THEN left(text, ${MESSAGE_PREVIEW_LENGTH})
            ELSE '(' || COALESCE(NULLIF(media_kind, 'none'), msg_type, 'message') || ')'
        END AS text,
        ${MINUTE_OF_DAY_SQL} AS minute,
        direction = 'sent' AS sent
    FROM messages
    WHERE date = CAST($1 AS DATE)
    ORDER BY timestamp
`;

function toMessageTick(row: Record<string, unknown>): MessageTick {
    return {
        conversation: String(row.conversation ?? ''),
        contact: String(row.contact ?? ''),
        sender: String(row.sender ?? ''),
        text: String(row.text ?? ''),
        minute: num(row.minute),
        sent: row.sent === true,
    };
}

const ACTIVITY_SQL = `
    SELECT ${MINUTE_OF_DAY_SQL} AS minute, service, action, label
    FROM google_activity
    WHERE date = CAST($1 AS DATE)
    ORDER BY timestamp
`;

function toActivityEvent(row: Record<string, unknown>): ActivityEvent {
    return {
        minute: num(row.minute),
        service: String(row.service ?? ''),
        action: String(row.action ?? ''),
        label: String(row.label ?? ''),
    };
}

const STEPS_SQL = `
    SELECT ${QUARTER_SQL} AS quarter, CAST(SUM(steps) AS DOUBLE) AS value
    FROM steps
    WHERE date = CAST($1 AS DATE)
    GROUP BY 1
    ORDER BY 1
`;

const HEART_RATE_SQL = `
    SELECT ${QUARTER_SQL} AS quarter, CAST(AVG(value) AS DOUBLE) AS value
    FROM health_readings
    WHERE metric = '${HEART_RATE}' AND date = CAST($1 AS DATE)
    GROUP BY 1
    ORDER BY 1
`;

function toQuarter(row: Record<string, unknown>): QuarterValue {
    return { quarter: num(row.quarter), value: num(row.value) };
}
