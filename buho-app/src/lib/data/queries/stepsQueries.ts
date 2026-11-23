import type { SqlNumber, SqlText } from './common';
import { query, tableExists } from '#lib/data/db/index.ts';
import type { ConnectablePoint } from '#lib/data/queries/behaviorQueries.ts';

// ---------------------------------------------------------------------------
// Explorer base points
// ---------------------------------------------------------------------------

/**
 * Cadence bands, in steps per active minute. The boundaries are gait, not
 * arithmetic: below 60 is shuffling around a room, 100–140 is walking with
 * somewhere to be, and 160+ is running.
 *
 * The bands are the one description of pace shared by the pie (which filters on
 * the label) and the distribution panel (which filters on the numbers), so both
 * read them from here rather than restating the boundaries.
 */
export interface CadenceBand {
    label: string;
    /** Inclusive lower bound, in steps per minute. */
    min: number;
    /** Exclusive upper bound; Infinity on the open-ended top band. */
    max: number;
}

export const CADENCE_BANDS: CadenceBand[] = [
    { label: '< 60', min: 0, max: 60 },
    { label: '60–100', min: 60, max: 100 },
    { label: '100–140', min: 100, max: 140 },
    { label: '140–160', min: 140, max: 160 },
    { label: '160–180', min: 160, max: 180 },
    { label: '180+', min: 180, max: Infinity },
];

const CADENCE_BUCKET_SQL = `
    CASE
        WHEN cadence_spm IS NULL THEN 'Unknown'
        ${CADENCE_BANDS.filter((b) => Number.isFinite(b.max))
            .map((b) => `WHEN cadence_spm < ${b.max} THEN '${b.label}'`)
            .join('\n        ')}
        ELSE '${CADENCE_BANDS[CADENCE_BANDS.length - 1].label}'
    END
`;

/**
 * How hard the watch judged the window. The raw 0–7 scale means nothing on a
 * pie, so it collapses to the three bands the device itself acts on.
 */
const INTENSITY_BUCKET_SQL = `
    CASE
        WHEN intensity IS NULL THEN 'Unknown'
        WHEN intensity <= 1 THEN 'Sedentary'
        WHEN intensity <= 4 THEN 'Moderate'
        ELSE 'Vigorous'
    END
`;

/**
 * Gait bands, for the pies. Walking speed in km/h: under 4 is a stroll, 5 and
 * up is walking somewhere late. Step length in cm, around a typical 70.
 */
export const SPEED_BANDS: CadenceBand[] = [
    { label: '< 4', min: 0, max: 4 },
    { label: '4–4.5', min: 4, max: 4.5 },
    { label: '4.5–5', min: 4.5, max: 5 },
    { label: '5–5.5', min: 5, max: 5.5 },
    { label: '5.5+', min: 5.5, max: Infinity },
];

export const STRIDE_BANDS: CadenceBand[] = [
    { label: '< 60', min: 0, max: 60 },
    { label: '60–70', min: 60, max: 70 },
    { label: '70–80', min: 70, max: 80 },
    { label: '80+', min: 80, max: Infinity },
];

/** The pies' label for a packet no gait reading fell in. */
export const NOT_MEASURED = 'Not measured';

function bandSql(column: string, bands: CadenceBand[]): string {
    return `
        CASE
            WHEN ${column} IS NULL THEN '${NOT_MEASURED}'
            ${bands
                .filter((b) => Number.isFinite(b.max))
                .map((b) => `WHEN ${column} < ${b.max} THEN '${b.label}'`)
                .join('\n            ')}
            ELSE '${bands[bands.length - 1].label}'
        END
    `;
}

/**
 * The gait readings taken inside each packet's window, one median per metric.
 *
 * Gait is a property of the steps rather than a signal of its own: a phone
 * measures it a few dozen times a day, each time over a stretch of a walk, so
 * every reading belongs to the packet that counted those steps. Joined against
 * the steps view rather than the phone's own packets, so a reading taken in an
 * hour the watch holds describes the watch's packet for that hour.
 *
 * An export without gait has no table at all, hence the empty stand-in.
 */
async function gaitPerPacketSql(): Promise<string> {
    if (!(await tableExists('gait_readings'))) {
        return `SELECT NULL::INTEGER AS step_id, NULL::DOUBLE AS walking_speed, NULL::DOUBLE AS step_length WHERE false`;
    }
    return `
        SELECT
            s.step_id,
            median(g.value) FILTER (WHERE g.metric = 'walking_speed') AS walking_speed,
            median(g.value) FILTER (WHERE g.metric = 'step_length') AS step_length
        FROM steps s
        JOIN gait_readings g
            ON g.timestamp >= s.start_timestamp AND g.timestamp <= s.timestamp
        WHERE g.metric IN ('walking_speed', 'step_length')
        GROUP BY s.step_id
    `;
}

/** How long a packet's window ran, which is not how long it was moving. */
const SPAN_BUCKET_SQL = `
    CASE
        WHEN span_seconds < 120 THEN '< 2 min'
        WHEN span_seconds < 600 THEN '2–10 min'
        WHEN span_seconds < 1800 THEN '10–30 min'
        WHEN span_seconds < 3600 THEN '30–60 min'
        ELSE '1 h+'
    END
`;

/**
 * A step packet as the explorer holds it: constellation coordinates plus the
 * normalized dimension fields used to recompute `matched`/pies in JS. Same
 * scheme as every other explorer — x = day epoch (ms), y = fractional hour.
 */
export interface StepBasePoint extends ConnectablePoint {
    stepId: number;
    fCadence: string; // cadence band, or Unknown
    fIntensity: string; // Sedentary | Moderate | Vigorous
    fSpan: string; // how long the packet's window ran
    fSpeed: string; // walking speed band, or Not measured
    fStride: string; // step length band, or Not measured
    dow: string;
    year: string;
    steps: number;
    /** Movement counted inside the window — the packet's "real" duration. */
    activeMins: number;
    /** Wall-clock length of the window, always ≥ activeMins. */
    spanMins: number;
    distanceMeters: number;
    /** Pace over ALL of the window's movement, walking and running together. */
    cadenceSpm: number | null;
    /**
     * The same window read one counter at a time. A window that held a walk and
     * a run has two paces, and averaging them into `cadenceSpm` describes
     * neither — so the distribution reads these, and only these.
     */
    walkSteps: number;
    walkActiveMins: number;
    walkCadenceSpm: number | null;
    runSteps: number;
    runActiveMins: number;
    runCadenceSpm: number | null;
    /** Median of the gait readings taken in the window, km/h; null when none was. */
    walkingSpeed: number | null;
    /** Same, step length in cm. */
    stepLength: number | null;
}

/**
 * All constellation points, loaded ONCE. The point set never changes with the
 * filters (`matched` is recomputed in JS), which avoids rebuilding the quadtree
 * on every interaction — same contract as the three other explorers.
 */
export async function getStepBasePoints(): Promise<StepBasePoint[]> {
    const sql = `
        WITH gait AS (${await gaitPerPacketSql()})
        SELECT
            step_id as stepId,
            CAST(epoch(DATE(timestamp)) * 1000 AS BIGINT) as x,
            CAST(hour(timestamp) + (minute(timestamp) / 60.0) + (second(timestamp) / 3600.0) AS DOUBLE) as y,
            CAST(timestamp AS VARCHAR) as recordedAt,
            CAST(start_timestamp AS VARCHAR) as startedAt,
            ${CADENCE_BUCKET_SQL} as fCadence,
            ${INTENSITY_BUCKET_SQL} as fIntensity,
            ${SPAN_BUCKET_SQL} as fSpan,
            ${bandSql('gait.walking_speed', SPEED_BANDS)} as fSpeed,
            ${bandSql('gait.step_length', STRIDE_BANDS)} as fStride,
            gait.walking_speed as walkingSpeed,
            gait.step_length as stepLength,
            CAST(DAYOFWEEK(timestamp) AS VARCHAR) as dow,
            CAST(YEAR(timestamp) AS VARCHAR) as year,
            CAST(steps AS INTEGER) as steps,
            CAST(active_seconds / 60.0 AS DOUBLE) as activeMins,
            CAST(span_seconds / 60.0 AS DOUBLE) as spanMins,
            CAST(COALESCE(distance_meters, 0) AS DOUBLE) as distanceMeters,
            cadence_spm as cadenceSpm,
            -- Walking is the remainder: only the walking and running counters
            -- are collected, so the totals are exactly their sum.
            CAST(steps - COALESCE(running_steps, 0) AS INTEGER) as walkSteps,
            CAST((active_seconds - COALESCE(running_active_seconds, 0)) / 60.0 AS DOUBLE) as walkActiveMins,
            CASE
                WHEN active_seconds - COALESCE(running_active_seconds, 0) > 0
                THEN CAST((steps - COALESCE(running_steps, 0))
                    / (active_seconds - COALESCE(running_active_seconds, 0)) * 60 AS DOUBLE)
            END as walkCadenceSpm,
            CAST(COALESCE(running_steps, 0) AS INTEGER) as runSteps,
            CAST(COALESCE(running_active_seconds, 0) / 60.0 AS DOUBLE) as runActiveMins,
            CASE
                WHEN COALESCE(running_active_seconds, 0) > 0
                THEN CAST(running_steps / running_active_seconds * 60 AS DOUBLE)
            END as runCadenceSpm
        FROM steps
        LEFT JOIN gait USING (step_id)
        WHERE timestamp IS NOT NULL
        ORDER BY x ASC
    `;

    try {
        const result = await query<{
            stepId: SqlNumber;
            x: SqlNumber;
            y: SqlNumber;
            steps: SqlNumber;
            activeMins: SqlNumber;
            spanMins: SqlNumber;
            distanceMeters: SqlNumber;
            cadenceSpm: SqlNumber;
            walkSteps: SqlNumber;
            walkActiveMins: SqlNumber;
            walkCadenceSpm: SqlNumber;
            runSteps: SqlNumber;
            runActiveMins: SqlNumber;
            runCadenceSpm: SqlNumber;
            dow: SqlText;
            year: SqlText;
            recordedAt: string;
            startedAt: string;
            fCadence: string;
            fIntensity: string;
            fSpan: string;
            fSpeed: string;
            fStride: string;
            walkingSpeed: SqlNumber;
            stepLength: SqlNumber;
        }>(sql);
        return result.map((row) => ({
            stepId: Number(row.stepId) || 0,
            x: Number(row.x),
            y: Number(row.y),
            matched: true,
            metadata: {
                steps: Number(row.steps) || 0,
                activeMins: Number(row.activeMins) || 0,
                spanMins: Number(row.spanMins) || 0,
                distanceMeters: Number(row.distanceMeters) || 0,
                cadenceSpm: row.cadenceSpm == null ? null : Number(row.cadenceSpm),
                recordedAt: row.recordedAt,
                startedAt: row.startedAt,
                walkingSpeed: row.walkingSpeed == null ? null : Number(row.walkingSpeed),
                stepLength: row.stepLength == null ? null : Number(row.stepLength),
            },
            fCadence: row.fCadence,
            fIntensity: row.fIntensity,
            fSpan: row.fSpan,
            fSpeed: row.fSpeed,
            fStride: row.fStride,
            dow: String(row.dow),
            year: String(row.year),
            steps: Number(row.steps) || 0,
            activeMins: Number(row.activeMins) || 0,
            spanMins: Number(row.spanMins) || 0,
            distanceMeters: Number(row.distanceMeters) || 0,
            cadenceSpm: row.cadenceSpm == null ? null : Number(row.cadenceSpm),
            walkSteps: Number(row.walkSteps) || 0,
            walkActiveMins: Number(row.walkActiveMins) || 0,
            walkCadenceSpm: row.walkCadenceSpm == null ? null : Number(row.walkCadenceSpm),
            runSteps: Number(row.runSteps) || 0,
            runActiveMins: Number(row.runActiveMins) || 0,
            runCadenceSpm: row.runCadenceSpm == null ? null : Number(row.runCadenceSpm),
            walkingSpeed: row.walkingSpeed == null ? null : Number(row.walkingSpeed),
            stepLength: row.stepLength == null ? null : Number(row.stepLength),
        }));
    } catch (error) {
        console.error('Failed to load step base points:', error);
        return [];
    }
}

/** [min, max] of the stored days, in epoch ms — the constellation's x domain. */
export async function getStepsTimeDomain(): Promise<[number, number] | null> {
    const sql = `
        SELECT
            CAST(epoch(DATE(MIN(timestamp))) * 1000 AS BIGINT) as lo,
            CAST(epoch(DATE(MAX(timestamp))) * 1000 AS BIGINT) as hi
        FROM steps
        WHERE timestamp IS NOT NULL
    `;

    try {
        const [row] = await query<{ lo: SqlNumber; hi: SqlNumber }>(sql);
        if (!row || row.lo == null || row.hi == null) return null;
        return [Number(row.lo), Number(row.hi)];
    } catch {
        return null;
    }
}
