import type { SqlNumber, SqlText } from './common';
import { query, queryColumnar } from '../db';
import { IS_CONTINUOUS_SOURCE_SQL, isContinuousSource } from '../sources/coverage';
import type { ConnectablePoint, ConstellationTimeDomain } from './behaviorQueries';

// Coarse km/h buckets for the explore Speed dimension pie. Values above the
// glitch threshold and NULLs (stationary / unresolved) collapse to 'Unknown'.
// The pie sorts them by magnitude.
const SPEED_BUCKET_SQL = `
    CASE
        WHEN speed_kmh IS NULL OR speed_kmh > 400 THEN 'Unknown'
        WHEN speed_kmh < 1 THEN '0'
        WHEN speed_kmh < 5 THEN '1–5'
        WHEN speed_kmh < 15 THEN '5–15'
        WHEN speed_kmh < 30 THEN '15–30'
        WHEN speed_kmh < 50 THEN '30–50'
        WHEN speed_kmh < 90 THEN '50–90'
        WHEN speed_kmh < 130 THEN '90–130'
        ELSE '130+'
    END
`;

// 8-point compass heading for the explore Direction dimension pie. NULL azimuth
// (stationary / single-point legs) collapses to 'Unknown'.
const AZIMUTH_BUCKET_SQL = `
    CASE
        WHEN azimuth_degrees IS NULL THEN 'Unknown'
        WHEN azimuth_degrees < 22.5 OR azimuth_degrees >= 337.5 THEN 'N'
        WHEN azimuth_degrees < 67.5 THEN 'NE'
        WHEN azimuth_degrees < 112.5 THEN 'E'
        WHEN azimuth_degrees < 157.5 THEN 'SE'
        WHEN azimuth_degrees < 202.5 THEN 'S'
        WHEN azimuth_degrees < 247.5 THEN 'SW'
        WHEN azimuth_degrees < 292.5 THEN 'W'
        ELSE 'NW'
    END
`;

/**
 * A constellation point for the Google Maps explorer, plus the normalized
 * dimension fields used to recompute `matched`/pies in JS (mirror of Spotify's
 * ExplorerBasePoint). Constellation x/y use the same scheme as Spotify:
 * x = day epoch (ms), y = fractional hour of day.
 */
/** Human labels for the provider slugs, so the pie doesn't read like a table key. */
export const SOURCE_LABELS: Record<string, string> = {
    'google-timeline': 'Google Timeline',
    garmin: 'Garmin',
};

export const sourceLabel = (slug: string): string => SOURCE_LABELS[slug] ?? slug;

/**
 * What you were doing while moving, in the few buckets worth colouring by.
 *
 * The raw field is whatever the exporter wrote — Google's `in passenger
 * vehicle`, `in subway`, `motorcycling`, next to Garmin's `running`,
 * `road_biking`, `hiking` — dozens of strings across two vocabularies, most of
 * them one-offs. Bucketed, they come down to the handful of ways a person
 * actually crosses ground, which is the number of colours a reader can hold.
 *
 * `Other` is last and stays neutral: it is the catch-all *and* the unlabelled
 * majority of a Google export, where only the semantic `activity` entries carry
 * a type at all.
 */
export const ACTIVITY_KINDS = [
    'On foot',
    'Running',
    'Cycling',
    'Driving',
    'Transit',
    'Flying',
    'Other',
] as const;

/** Index of the catch-all bucket, which is also the "not recorded" answer. */
export const ACTIVITY_OTHER = ACTIVITY_KINDS.length - 1;

/**
 * The bucketing, over a lowercased `a`. Order matters: `in passenger vehicle`
 * has to be claimed by Driving before the generic `in %` sweeps it into Transit.
 */
const ACTIVITY_KIND_SQL = `
    CASE
        WHEN a = '' THEN ${ACTIVITY_OTHER}
        WHEN a IN ('walking', 'walk', 'on foot', 'hiking', 'hike') THEN 0
        WHEN a LIKE '%running%' OR a = 'run' THEN 1
        WHEN a LIKE '%cycl%' OR a LIKE '%bik%' THEN 2
        WHEN a IN ('in passenger vehicle', 'driving', 'motorcycling', 'in vehicle') THEN 3
        WHEN a = 'flying' THEN 5
        WHEN a LIKE 'in %' OR a LIKE 'on %' THEN 4
        ELSE ${ACTIVITY_OTHER}
    END
`;

export interface LocationBasePoint extends ConnectablePoint {
    // Passes the active dimension filters, ignoring the map's geographic viewport
    // (unlike `matched`, which also folds the viewport box in). The map trail reads
    // this so it can span points outside the current view.
    matchedDims?: boolean;
    segId: number; // stable segment key, for patchGeoAttributes
    // Who recorded the point. A phone logs one a minute, a watch one a second
    // while an activity runs, so this is what keeps the two legible together.
    fSource: string;
    fSegmentType: string; // stationary | moving
    fActivityType: string; // walking, in passenger vehicle, … (or Unknown)
    fSemanticType: string; // Home, Work, Unknown, …
    dow: string; // DAYOFWEEK as string, 0..6
    year: string; // YEAR as string
    mins: number; // segment duration in minutes
    distanceMeters: number; // 0 for stationary / missing
    placeId: string; // '' when absent
    country: string; // geo attribution; 'Unknown' when absent
    region: string;
    department: string;
    nearestCity: string;
    arrondissement: string; // Paris/Lyon/Marseille only; 'Unknown' otherwise
    presenceMins: number; // gap until the next point in time (capped at 24h)
    fNovelty: string; // 'New' the first time its ~110m cell is ever seen, else 'Seen'
    fSpeed: string; // derived-speed bucket (moving only), else 'Unknown'
    fAzimuth: string; // 8-point compass heading (moving only), else 'Unknown'
}

/**
 * All constellation points, loaded once. The point set never changes with
 * filters (the `matched` flag is recomputed in JS), so the quadtree is built
 * only once. Mirror of getExplorerBasePoints.
 */
export async function getPositionsExplorerBasePoints(): Promise<LocationBasePoint[]> {
    const sql = `
        SELECT
            seg_id as segId,
            source as fSource,
            CAST(epoch(DATE(timestamp)) * 1000 AS BIGINT) as x,
            CAST(hour(timestamp) + (minute(timestamp) / 60.0) + (second(timestamp) / 3600.0) AS DOUBLE) as y,
            CAST(timestamp AS VARCHAR) as playedAt,
            segment_type as fSegmentType,
            COALESCE(NULLIF(TRIM(CAST(activity_type AS VARCHAR)), ''), 'Unknown') as fActivityType,
            COALESCE(NULLIF(TRIM(CAST(semantic_type AS VARCHAR)), ''), 'Unknown') as fSemanticType,
            CAST(DAYOFWEEK(timestamp) AS VARCHAR) as dow,
            CAST(YEAR(timestamp) AS VARCHAR) as year,
            CAST(duration_seconds / 60.0 AS DOUBLE) as mins,
            CAST(COALESCE(distance_meters, 0) AS DOUBLE) as distanceMeters,
            COALESCE(CAST(place_id AS VARCHAR), '') as placeId,
            COALESCE(country, 'Unknown') as country,
            COALESCE(region, 'Unknown') as region,
            COALESCE(department, 'Unknown') as department,
            COALESCE(nearest_city, 'Unknown') as nearestCity,
            COALESCE(arrondissement, 'Unknown') as arrondissement,
            CASE WHEN timestamp = MIN(timestamp) OVER (PARTITION BY ROUND(lat, 3), ROUND(lon, 3))
                 THEN 'New' ELSE 'Seen' END as fNovelty,
            ${SPEED_BUCKET_SQL} as fSpeed,
            ${AZIMUTH_BUCKET_SQL} as fAzimuth,
            lat,
            lon
        FROM positions
        WHERE timestamp IS NOT NULL
        ORDER BY x ASC
    `;

    try {
        const result = await query<{
            segId: SqlNumber;
            x: SqlNumber;
            y: SqlNumber;
            mins: SqlNumber;
            distanceMeters: SqlNumber;
            lat: SqlNumber;
            lon: SqlNumber;
            fSource: SqlText;
            fSegmentType: SqlText;
            fActivityType: SqlText;
            fSemanticType: SqlText;
            dow: SqlText;
            year: SqlText;
            placeId: SqlText;
            country: SqlText;
            region: SqlText;
            department: SqlText;
            nearestCity: SqlText;
            arrondissement: SqlText;
            fNovelty: SqlText;
            fSpeed: SqlText;
            fAzimuth: SqlText;
            playedAt: string;
        }>(sql);
        const points: LocationBasePoint[] = result.map((row) => ({
            segId: Number(row.segId),
            x: Number(row.x),
            y: Number(row.y),
            matched: true,
            metadata: {
                source: row.fSource,
                segmentType: row.fSegmentType,
                activityType: row.fActivityType,
                semanticType: row.fSemanticType,
                durationMinutes: Number(row.mins) || 0,
                playedAt: row.playedAt,
                lat: Number(row.lat),
                lon: Number(row.lon),
                country: row.country || 'Unknown',
                region: row.region || 'Unknown',
                department: row.department || 'Unknown',
                nearestCity: row.nearestCity || 'Unknown',
                arrondissement: row.arrondissement || 'Unknown',
            },
            fSource: row.fSource || 'Unknown',
            fSegmentType: row.fSegmentType || 'Unknown',
            fActivityType: row.fActivityType || 'Unknown',
            fSemanticType: row.fSemanticType || 'Unknown',
            dow: row.dow ?? 'Unknown',
            year: row.year ?? 'Unknown',
            mins: Number(row.mins) || 0,
            distanceMeters: Number(row.distanceMeters) || 0,
            placeId: row.placeId || '',
            country: row.country || 'Unknown',
            region: row.region || 'Unknown',
            department: row.department || 'Unknown',
            nearestCity: row.nearestCity || 'Unknown',
            arrondissement: row.arrondissement || 'Unknown',
            presenceMins: 0,
            fNovelty: row.fNovelty === 'New' ? 'New' : 'Seen',
            fSpeed: row.fSpeed || 'Unknown',
            fAzimuth: row.fAzimuth || 'Unknown',
        }));
        annotatePresenceMinutes(points);
        return points;
    } catch (error) {
        console.error('Error fetching Google Maps base points:', error);
        return [];
    }
}

/**
 * Write the geo columns onto points already loaded by
 * {@link getPositionsExplorerBasePoints}, once the background attribution has
 * filled them in. Patches in place, keyed by `seg_id`: the array reference is
 * left untouched, so the map keeps its viewport and the constellation its
 * quadtree instead of refitting on a fresh point set.
 *
 * Columnar (like buildDays) — six columns over every segment, so the per-row
 * toJSON + camelCase churn of query() is worth avoiding.
 */
export async function patchGeoAttributes(points: LocationBasePoint[]): Promise<void> {
    if (points.length === 0) return;

    const sql = `
        SELECT
            seg_id AS segId,
            COALESCE(country, 'Unknown') AS country,
            COALESCE(region, 'Unknown') AS region,
            COALESCE(department, 'Unknown') AS department,
            COALESCE(nearest_city, 'Unknown') AS nearestCity,
            COALESCE(arrondissement, 'Unknown') AS arrondissement
        FROM positions
        WHERE timestamp IS NOT NULL
    `;

    try {
        const { numRows, columns } = await queryColumnar(sql);
        const byId = new Map<number, LocationBasePoint>();
        for (const p of points) byId.set(p.segId, p);

        const segId = columns.segId,
            country = columns.country,
            region = columns.region;
        const department = columns.department,
            nearestCity = columns.nearestCity;
        const arrondissement = columns.arrondissement;

        for (let i = 0; i < numRows; i++) {
            const p = byId.get(Number(segId[i]));
            if (!p) continue;
            p.country = String(country[i]);
            p.region = String(region[i]);
            p.department = String(department[i]);
            p.nearestCity = String(nearestCity[i]);
            p.arrondissement = String(arrondissement[i]);
            // The tooltip reads its geo line off `metadata`, so keep both in sync.
            p.metadata.country = p.country;
            p.metadata.region = p.region;
            p.metadata.department = p.department;
            p.metadata.nearestCity = p.nearestCity;
            p.metadata.arrondissement = p.arrondissement;
        }
    } catch (error) {
        console.error('Error patching geo attributes:', error);
    }
}

/** Reconstructed local instant (ms) of a point: midnight epoch + fractional hour. */
function instantMs(p: LocationBasePoint): number {
    return p.x + p.y * 3_600_000;
}

/**
 * Fill each point's `presenceMins` = the time until the NEXT point in the merged,
 * time-sorted series, capped at 24h (the last point gets 0). Treating the base
 * points as one piecewise-constant-position series makes Σ presence telescope to
 * the tracked span, so overlapping source layers can never double-count. Mutates
 * in place; the array order is left untouched — the chain is walked over a
 * time-sorted index because the SQL orders by day, not by instant.
 *
 * A point from an {@link isContinuousSource | episodic} source never reaches
 * across the gap that follows it: it is additionally capped at its own recorded
 * duration. The gap after a watch's last fix of the day is the watch being off,
 * not eight hours spent at the end of the run, and crediting it as presence is
 * how a Garmin-only import came to report weeks of standing still — the run's
 * final point swallowing every hour until the next one.
 */
export function annotatePresenceMinutes(points: LocationBasePoint[]): void {
    const GAP_CAP_MIN = 24 * 60;
    const order = points
        .map((_, i) => i)
        .sort((a, b) => instantMs(points[a]) - instantMs(points[b]));
    for (let k = 0; k < order.length; k++) {
        const p = points[order[k]];
        if (k + 1 >= order.length) {
            p.presenceMins = 0;
            continue;
        }
        const gapMin = (instantMs(points[order[k + 1]]) - instantMs(p)) / 60_000;
        const cap = isContinuousSource(p.fSource) ? GAP_CAP_MIN : p.mins;
        p.presenceMins = Math.min(Math.max(0, gapMin), cap);
    }
}

/** One (month, place) bucket: hours spent in that place during that month. */
export interface MonthlyDurationData {
    month: string; // 'YYYY-MM-DD' (month bucket start)
    name: string; // country or region label
    hours: number; // duration during the month, in hours
}

/**
 * Monthly duration (in hours) spent per geographic bucket, for a bar chart race.
 * `dimension` selects the column: country or region. Rows are grouped into the
 * segment's start month; the caller accumulates them into a cumulative race.
 */
async function getMonthlyDurationByDimension(
    dimension: 'country' | 'region'
): Promise<MonthlyDurationData[]> {
    const sql = `
        SELECT
            CAST(CAST(DATE_TRUNC('month', timestamp) AS DATE) AS VARCHAR) as month,
            COALESCE(NULLIF(TRIM(${dimension}), ''), 'Unknown') as name,
            CAST(SUM(duration_seconds) / 3600.0 AS DOUBLE) as hours
        FROM positions
        WHERE timestamp IS NOT NULL
          AND ${dimension} IS NOT NULL
          AND TRIM(${dimension}) <> ''
        GROUP BY month, name
        ORDER BY month ASC, hours DESC, name ASC
    `;

    try {
        const result = await query<{ month: SqlText; name: SqlText; hours: SqlNumber }>(sql);
        return result.map((row) => ({
            month: row.month || '',
            name: row.name || 'Unknown',
            hours: Number(row.hours) || 0,
        }));
    } catch (error) {
        console.error(`Error fetching monthly duration by ${dimension}:`, error);
        return [];
    }
}

/** Monthly cumulative duration per country, for the bar chart race. */
export function getMonthlyDurationByCountry(): Promise<MonthlyDurationData[]> {
    return getMonthlyDurationByDimension('country');
}

/** Monthly cumulative duration per region (the level just below country). */
export function getMonthlyDurationByRegion(): Promise<MonthlyDurationData[]> {
    return getMonthlyDurationByDimension('region');
}

/** Fine-grained derived-speed histogram over the moving segments. */
export interface SpeedDistribution {
    // bins[i] = count of moving segments whose speed falls in [i, i+1) km/h, for
    // i in 0..SPEED_MAX_KMH-1; the final index (SPEED_MAX_KMH) is the '300+'
    // overflow (up to the glitch threshold).
    bins: number[];
    maxKmh: number; // overflow threshold (SPEED_MAX_KMH); bins.length === maxKmh + 1
    medianKmh: number;
    totalLegs: number; // total segments counted (all bins)
}

// Google Timeline has no native speed field, so we derive it from the segment's
// travelled distance over its duration (see sources/googleTimeline/parse). Values above this
// are GPS glitches — the tail reaches into the thousands of km/h — so we drop
// them as noise.
const SPEED_GLITCH_KMH = 400;

// Top of the 1-km/h histogram; everything from here up (to the glitch cap) folds
// into the '300+' overflow bin.
const SPEED_MAX_KMH = 300;

// Every moving segment's derived speed, glitches excluded (shared by the queries).
const SPEED_MOVING_CTE = `
    moving AS (
        SELECT speed_kmh AS kmh
        FROM positions
        WHERE speed_kmh IS NOT NULL
          AND speed_kmh >= 0
          AND speed_kmh <= ${SPEED_GLITCH_KMH}
    )
`;

/**
 * Fine (1-km/h) distribution of derived travel speed across the moving segments.
 * Speed is `speed_kmh` (path-leg distance / duration, or the routed distance /
 * duration for a lone activity — see sources/googleTimeline/parse); stationary segments carry
 * none and are excluded. Speeds ≥ {@link SPEED_MAX_KMH} fold into a single
 * overflow bin; clearly non-physical ones (> {@link SPEED_GLITCH_KMH}) are
 * dropped as GPS noise.
 */
export async function getSpeedDistribution(): Promise<SpeedDistribution | null> {
    const sql = `
        WITH ${SPEED_MOVING_CTE}
        SELECT
            CAST(LEAST(FLOOR(kmh), ${SPEED_MAX_KMH}) AS INTEGER) AS bin,
            CAST(COUNT(*) AS BIGINT) AS count
        FROM moving
        GROUP BY bin
        ORDER BY bin
    `;
    const medianSql = `
        WITH ${SPEED_MOVING_CTE}
        SELECT median(kmh) AS medianKmh, CAST(COUNT(*) AS BIGINT) AS total FROM moving
    `;

    try {
        const [rows, stats] = await Promise.all([
            query<{ bin: number; count: number }>(sql),
            query<{ medianKmh: number; total: number }>(medianSql),
        ]);
        const bins = new Array<number>(SPEED_MAX_KMH + 1).fill(0);
        for (const r of rows) {
            const i = Number(r.bin);
            if (i >= 0 && i <= SPEED_MAX_KMH) bins[i] = Number(r.count);
        }
        return {
            bins,
            maxKmh: SPEED_MAX_KMH,
            medianKmh: Number(stats[0]?.medianKmh) || 0,
            totalLegs: Number(stats[0]?.total) || 0,
        };
    } catch (error) {
        console.error('Error fetching speed distribution:', error);
        return null;
    }
}

/** One row of the derived per-day mobility dataset (`position_days`). */
export interface DayRecord {
    day: string;
    startPlaceId: string;
    startSemanticType: string;
    startLat: number;
    startLon: number;
    startCity: string;
    startCountry: string;
    startPlaceKm: number;
    startFill: string; // 'visit' | 'interpolated' | 'edge'
    kmTraveled: number;
    maxDistFromStartKm: number;
    distinctPlaces: number;
    visitCount: number;
    movingMinutes: number;
    stationaryMinutes: number;
    segmentCount: number;
    departureHour: number | null;
    returnHour: number | null;
    amplitudeHours: number | null;
    discoveredNew: boolean;
}

/**
 * Read the materialised per-day dataset built by `buildDays` during upload.
 * Returns [] if the table doesn't exist yet (e.g. geo attribution was skipped).
 */
export async function getDays(): Promise<DayRecord[]> {
    const sql = `
        SELECT
            CAST(day AS VARCHAR) AS day,
            COALESCE(start_place_id, '') AS startPlaceId,
            COALESCE(start_semantic_type, 'Unknown') AS startSemanticType,
            start_lat AS startLat,
            start_lon AS startLon,
            COALESCE(start_city, 'Unknown') AS startCity,
            COALESCE(start_country, 'Unknown') AS startCountry,
            start_place_km AS startPlaceKm,
            start_fill AS startFill,
            km_traveled AS kmTraveled,
            max_dist_from_start_km AS maxDistFromStartKm,
            distinct_places AS distinctPlaces,
            visit_count AS visitCount,
            moving_minutes AS movingMinutes,
            stationary_minutes AS stationaryMinutes,
            segment_count AS segmentCount,
            departure_hour AS departureHour,
            return_hour AS returnHour,
            amplitude_hours AS amplitudeHours,
            discovered_new AS discoveredNew
        FROM position_days
        ORDER BY day ASC
    `;

    try {
        const result = await query<{
            startLat: SqlNumber;
            startLon: SqlNumber;
            startPlaceKm: SqlNumber;
            kmTraveled: SqlNumber;
            maxDistFromStartKm: SqlNumber;
            distinctPlaces: SqlNumber;
            visitCount: SqlNumber;
            movingMinutes: SqlNumber;
            stationaryMinutes: SqlNumber;
            segmentCount: SqlNumber;
            departureHour: SqlNumber;
            returnHour: SqlNumber;
            amplitudeHours: SqlNumber;
            day: SqlText;
            startPlaceId: SqlText;
            startSemanticType: SqlText;
            startCity: SqlText;
            startCountry: SqlText;
            startFill: SqlText;
            discoveredNew: boolean | null;
        }>(sql);
        return result.map((row) => ({
            day: String(row.day),
            startPlaceId: row.startPlaceId || '',
            startSemanticType: row.startSemanticType || 'Unknown',
            startLat: Number(row.startLat),
            startLon: Number(row.startLon),
            startCity: row.startCity || 'Unknown',
            startCountry: row.startCountry || 'Unknown',
            startPlaceKm: Number(row.startPlaceKm),
            startFill: row.startFill || 'edge',
            kmTraveled: Number(row.kmTraveled) || 0,
            maxDistFromStartKm: Number(row.maxDistFromStartKm) || 0,
            distinctPlaces: Number(row.distinctPlaces) || 0,
            visitCount: Number(row.visitCount) || 0,
            movingMinutes: Number(row.movingMinutes) || 0,
            stationaryMinutes: Number(row.stationaryMinutes) || 0,
            segmentCount: Number(row.segmentCount) || 0,
            departureHour: row.departureHour == null ? null : Number(row.departureHour),
            returnHour: row.returnHour == null ? null : Number(row.returnHour),
            amplitudeHours: row.amplitudeHours == null ? null : Number(row.amplitudeHours),
            discoveredNew: Boolean(row.discoveredNew),
        }));
    } catch (error) {
        console.error('Error fetching days dataset:', error);
        return [];
    }
}

/**
 * All timestamped segments as struct-of-arrays typed columns, for the "day race"
 * map (one animated dot per logical day). Mirrors the columnar load `buildDays`
 * uses; the caller buckets these into per-day tracks in JS. BIGINT columns arrive
 * as BigInt — coerce with Number() at the use site.
 */
export interface DayRaceSegmentRows {
    numRows: number;
    startMs: Float64Array | number[];
    endMs: Float64Array | number[];
    lat: Float64Array | number[];
    lon: Float64Array | number[];
    isStationary: Uint8Array | number[];
    /** 1 → recorded by a watch, 0 → by the phone. See getDayRaceSegments. */
    isGarmin: Uint8Array | number[];
    /**
     * 1 → the point comes from a source meant to be a complete record, so the
     * silence around it can be read as "still there". See `sources/coverage`.
     */
    isContinuous: Uint8Array | number[];
    /** {@link ACTIVITY_KINDS} index of the leg starting at this point. */
    activity: Uint8Array | number[];
}

const EMPTY_DAY_RACE_SEGMENTS: DayRaceSegmentRows = {
    numRows: 0,
    startMs: [],
    endMs: [],
    lat: [],
    lon: [],
    isStationary: [],
    isGarmin: [],
    isContinuous: [],
    activity: [],
};

/**
 * Every point the day race animates.
 *
 * Provider overlap is already resolved by the `positions` view, minute by
 * minute, so a day reads as one continuous track that switches to the watch
 * wherever it was recording and back to the phone around it. `isGarmin` rides
 * along so the race can colour by who recorded each stretch.
 */
export async function getDayRaceSegments(): Promise<DayRaceSegmentRows> {
    // The activity string is folded down in the CTE so the bucketing CASE reads
    // it once under a short name instead of repeating the lower(trim(…)).
    const sql = `
        WITH s AS (
            SELECT *, lower(trim(COALESCE(CAST(activity_type AS VARCHAR), ''))) AS a
            FROM positions
            WHERE timestamp IS NOT NULL AND lat IS NOT NULL AND lon IS NOT NULL
        )
        SELECT
            CAST(epoch(timestamp) * 1000 AS BIGINT) AS startMs,
            CAST(epoch(end_timestamp) * 1000 AS BIGINT) AS endMs,
            lat, lon,
            CAST(segment_type = 'stationary' AS INTEGER) AS isStationary,
            CAST(source = 'garmin' AS INTEGER) AS isGarmin,
            CAST(${IS_CONTINUOUS_SOURCE_SQL} AS INTEGER) AS isContinuous,
            CAST(${ACTIVITY_KIND_SQL} AS INTEGER) AS activity
        FROM s
        ORDER BY startMs ASC
    `;

    try {
        const { numRows, columns } = await queryColumnar(sql);
        return {
            numRows,
            startMs: columns.startMs as Float64Array | number[],
            endMs: columns.endMs as Float64Array | number[],
            lat: columns.lat as Float64Array | number[],
            lon: columns.lon as Float64Array | number[],
            isStationary: columns.isStationary as Uint8Array | number[],
            isGarmin: columns.isGarmin as Uint8Array | number[],
            isContinuous: columns.isContinuous as Uint8Array | number[],
            activity: columns.activity as Uint8Array | number[],
        };
    } catch (error) {
        console.error('Error fetching day-race segments:', error);
        return EMPTY_DAY_RACE_SEGMENTS;
    }
}

/** Full time range of the constellation (loaded once, unfiltered). */
export async function getPositionsConstellationTimeDomain(): Promise<ConstellationTimeDomain | null> {
    const sql = `
        SELECT
            CAST(epoch(MIN(timestamp)) * 1000 AS BIGINT) as minX,
            CAST(epoch(MAX(timestamp)) * 1000 AS BIGINT) as maxX
        FROM positions
        WHERE timestamp IS NOT NULL
    `;

    try {
        const result = await query<{ minX: SqlNumber; maxX: SqlNumber }>(sql);
        if (!result.length) return null;
        const minX = Number(result[0].minX);
        const maxX = Number(result[0].maxX);
        if (!Number.isFinite(minX) || !Number.isFinite(maxX)) return null;
        return { minX, maxX };
    } catch (error) {
        console.error('Error fetching Google Maps time domain:', error);
        return null;
    }
}
