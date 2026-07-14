import { query } from '../db';
import type { ConnectablePoint, ConstellationTimeDomain } from './behaviorQueries';

/**
 * A constellation point for the Google Maps explorer, plus the normalized
 * dimension fields used to recompute `matched`/pies in JS (mirror of Spotify's
 * ExplorerBasePoint). Constellation x/y use the same scheme as Spotify:
 * x = day epoch (ms), y = fractional hour of day.
 */
export interface LocationBasePoint extends ConnectablePoint {
    // Passes the active dimension filters, ignoring the map's geographic viewport
    // (unlike `matched`, which also folds the viewport box in). The map trail reads
    // this so it can span points outside the current view.
    matchedDims?: boolean;
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
}

/**
 * All constellation points, loaded once. The point set never changes with
 * filters (the `matched` flag is recomputed in JS), so the quadtree is built
 * only once. Mirror of getExplorerBasePoints.
 */
export async function getGoogleMapsExplorerBasePoints(): Promise<LocationBasePoint[]> {
    const sql = `
        SELECT
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
            lat,
            lon
        FROM google_maps_segments
        WHERE timestamp IS NOT NULL
        ORDER BY x ASC
    `;

    try {
        const result = await query<any>(sql);
        const points: LocationBasePoint[] = result.map((row) => ({
            x: Number(row.x),
            y: Number(row.y),
            matched: true,
            metadata: {
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
        }));
        annotatePresenceMinutes(points);
        return points;
    } catch (error) {
        console.error('Error fetching Google Maps base points:', error);
        return [];
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
 */
export function annotatePresenceMinutes(points: LocationBasePoint[]): void {
    const GAP_CAP_MIN = 24 * 60;
    const order = points.map((_, i) => i).sort((a, b) => instantMs(points[a]) - instantMs(points[b]));
    for (let k = 0; k < order.length; k++) {
        const p = points[order[k]];
        if (k + 1 >= order.length) {
            p.presenceMins = 0;
            continue;
        }
        const gapMin = (instantMs(points[order[k + 1]]) - instantMs(p)) / 60_000;
        p.presenceMins = Math.min(Math.max(0, gapMin), GAP_CAP_MIN);
    }
}

/** One place ranked by how many distinct nights were spent there. */
export interface NightsPerPlace {
    key: string;        // place_id, or a rounded-coord fallback when place_id is null
    city: string;
    department: string;
    semanticType: string;
    lat: number;
    lon: number;
    nights: number;
}

/**
 * Rank places by the number of distinct nights spent there. A "night" for a
 * stationary visit = the visit's interval covers the 04:00 local mark of a
 * given calendar night; multi-day stays count each night they cover. Places
 * are keyed by place_id (fallback: rounded lat/lon when place_id is missing),
 * labelled with the most common nearest city / department.
 */
export async function getNightsPerPlace(limit = 25): Promise<NightsPerPlace[]> {
    const sql = `
        WITH nights AS (
            SELECT
                COALESCE(NULLIF(place_id, ''),
                         'geo:' || ROUND(lat, 3) || ',' || ROUND(lon, 3)) AS key,
                nearest_city, department, semantic_type, lat, lon,
                CAST(anchor AS DATE) AS night
            FROM google_maps_segments s,
                 generate_series(
                     date_trunc('day', s.timestamp) + INTERVAL 4 HOUR,
                     date_trunc('day', s.end_timestamp) + INTERVAL 4 HOUR,
                     INTERVAL 1 DAY
                 ) AS t(anchor)
            WHERE s.segment_type = 'stationary'
              AND anchor BETWEEN s.timestamp AND s.end_timestamp
        )
        SELECT
            key,
            COALESCE(NULLIF(TRIM(mode(nearest_city)), ''), 'Unknown') AS city,
            COALESCE(NULLIF(TRIM(mode(department)), ''), 'Unknown') AS department,
            COALESCE(NULLIF(TRIM(mode(semantic_type)), ''), 'Unknown') AS semanticType,
            AVG(lat) AS lat,
            AVG(lon) AS lon,
            COUNT(DISTINCT night) AS nights
        FROM nights
        GROUP BY key
        ORDER BY nights DESC
        LIMIT ${Math.max(1, Math.floor(limit))}
    `;

    try {
        const result = await query<any>(sql);
        return result.map((row) => ({
            key: String(row.key),
            city: row.city || 'Unknown',
            department: row.department || 'Unknown',
            semanticType: row.semanticType || 'Unknown',
            lat: Number(row.lat),
            lon: Number(row.lon),
            nights: Number(row.nights) || 0,
        }));
    } catch (error) {
        console.error('Error fetching nights per place:', error);
        return [];
    }
}

/** Coverage breakdown of the "presence at 04:00" night heuristic. */
export interface NightCoverage {
    totalNights: number;      // calendar nights across the tracked span
    stationaryNights: number; // a stationary visit covers 04:00 (counted by the ranking)
    movingOnlyNights: number; // only a moving segment covers 04:00 (overnight travel)
    uncoveredNights: number;  // no segment at all covers 04:00 (tracking gap)
}

/**
 * How many nights the "presence at 04:00" heuristic actually captures. Walks
 * every calendar night between the first and last tracked day and checks, at
 * that night's 04:00 local mark, whether a stationary / moving / no segment
 * covers it — so the caller can tell how many nights the ranking misses.
 */
export async function getNightCoverage(): Promise<NightCoverage | null> {
    const sql = `
        WITH bounds AS (
            SELECT date_trunc('day', MIN(timestamp)) AS d0,
                   date_trunc('day', MAX(end_timestamp)) AS d1
            FROM google_maps_segments
            WHERE timestamp IS NOT NULL
        ),
        anchors AS (
            SELECT gs + INTERVAL 4 HOUR AS anchor
            FROM bounds, generate_series(d0, d1, INTERVAL 1 DAY) AS t(gs)
        ),
        classified AS (
            SELECT a.anchor,
                MAX(CASE WHEN s.segment_type = 'stationary' THEN 1 ELSE 0 END) AS has_stationary,
                MAX(CASE WHEN s.segment_type = 'moving' THEN 1 ELSE 0 END) AS has_moving
            FROM anchors a
            LEFT JOIN google_maps_segments s
                ON a.anchor BETWEEN s.timestamp AND s.end_timestamp
            GROUP BY a.anchor
        )
        SELECT
            COUNT(*) AS totalNights,
            CAST(SUM(has_stationary) AS BIGINT) AS stationaryNights,
            CAST(SUM(CASE WHEN has_stationary = 0 AND has_moving = 1 THEN 1 ELSE 0 END) AS BIGINT) AS movingOnlyNights,
            CAST(SUM(CASE WHEN has_stationary = 0 AND has_moving = 0 THEN 1 ELSE 0 END) AS BIGINT) AS uncoveredNights
        FROM classified
    `;

    try {
        const result = await query<any>(sql);
        if (!result.length) return null;
        const r = result[0];
        return {
            totalNights: Number(r.totalNights) || 0,
            stationaryNights: Number(r.stationaryNights) || 0,
            movingOnlyNights: Number(r.movingOnlyNights) || 0,
            uncoveredNights: Number(r.uncoveredNights) || 0,
        };
    } catch (error) {
        console.error('Error fetching night coverage:', error);
        return null;
    }
}

/** One night the "presence at 04:00" heuristic fails to attribute to a place. */
export interface UncoveredNight {
    night: string;   // 'YYYY-MM-DD' (the 04:00 mark's day)
    year: string;
    country: string; // country of the nearest-in-time segment ('None' if none within ±2 days)
    region: string;
    kind: 'travel' | 'gap'; // travel = a moving segment covers 04:00; gap = nothing does
    gapHours: number | null; // hours to the nearest segment (null when none nearby)
}

/**
 * List every night with no stationary visit covering its 04:00 local mark, and
 * for each attach the country/region of the nearest segment in time (±2 days)
 * so the caller can see WHERE and WHEN the ranking loses nights. `kind` tells a
 * night spent in transit (a moving segment covers 04:00) apart from a plain
 * tracking gap. Lets us test whether misses cluster abroad / across timezones.
 */
export async function getUncoveredNights(): Promise<UncoveredNight[]> {
    const sql = `
        WITH bounds AS (
            SELECT date_trunc('day', MIN(timestamp)) AS d0,
                   date_trunc('day', MAX(end_timestamp)) AS d1
            FROM google_maps_segments
            WHERE timestamp IS NOT NULL
        ),
        anchors AS (
            SELECT gs + INTERVAL 4 HOUR AS anchor
            FROM bounds, generate_series(d0, d1, INTERVAL 1 DAY) AS t(gs)
        ),
        cls AS (
            SELECT a.anchor,
                MAX(CASE WHEN s.segment_type = 'stationary' THEN 1 ELSE 0 END) AS has_stat,
                MAX(CASE WHEN s.segment_type = 'moving' THEN 1 ELSE 0 END) AS has_mov
            FROM anchors a
            LEFT JOIN google_maps_segments s
                ON a.anchor BETWEEN s.timestamp AND s.end_timestamp
            GROUP BY a.anchor
        ),
        uncovered AS (SELECT anchor, has_mov FROM cls WHERE has_stat = 0),
        near AS (
            SELECT u.anchor, u.has_mov, s.country, s.region,
                ROW_NUMBER() OVER (PARTITION BY u.anchor
                    ORDER BY abs(epoch(s.timestamp) - epoch(u.anchor))) AS rn,
                abs(epoch(s.timestamp) - epoch(u.anchor)) / 3600.0 AS gap_h
            FROM uncovered u
            LEFT JOIN google_maps_segments s
                ON s.timestamp BETWEEN u.anchor - INTERVAL 2 DAY AND u.anchor + INTERVAL 2 DAY
        )
        SELECT
            CAST(CAST(anchor AS DATE) AS VARCHAR) AS night,
            CAST(YEAR(anchor) AS VARCHAR) AS year,
            COALESCE(country, 'None') AS country,
            COALESCE(region, 'None') AS region,
            CASE WHEN has_mov = 1 THEN 'travel' ELSE 'gap' END AS kind,
            ROUND(gap_h, 1) AS gapHours
        FROM near
        WHERE rn = 1
        ORDER BY night
    `;

    try {
        const result = await query<any>(sql);
        return result.map((row) => ({
            night: String(row.night),
            year: String(row.year),
            country: row.country || 'None',
            region: row.region || 'None',
            kind: row.kind === 'travel' ? 'travel' : 'gap',
            gapHours: row.gapHours == null ? null : Number(row.gapHours),
        }));
    } catch (error) {
        console.error('Error fetching uncovered nights:', error);
        return [];
    }
}

/** One (month, place) bucket: hours spent in that place during that month. */
export interface MonthlyDurationData {
    month: string; // 'YYYY-MM-DD' (month bucket start)
    name: string;  // country or region label
    hours: number; // duration during the month, in hours
}

/**
 * Monthly duration (in hours) spent per geographic bucket, for a bar chart race.
 * `dimension` selects the column: country or region. Rows are grouped into the
 * segment's start month; the caller accumulates them into a cumulative race.
 */
async function getMonthlyDurationByDimension(
    dimension: 'country' | 'region',
): Promise<MonthlyDurationData[]> {
    const sql = `
        SELECT
            CAST(CAST(DATE_TRUNC('month', timestamp) AS DATE) AS VARCHAR) as month,
            COALESCE(NULLIF(TRIM(${dimension}), ''), 'Unknown') as name,
            CAST(SUM(duration_seconds) / 3600.0 AS DOUBLE) as hours
        FROM google_maps_segments
        WHERE timestamp IS NOT NULL
          AND ${dimension} IS NOT NULL
          AND TRIM(${dimension}) <> ''
        GROUP BY month, name
        ORDER BY month ASC, hours DESC, name ASC
    `;

    try {
        const result = await query<any>(sql);
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

/** One bar of the speed histogram: legs whose derived speed falls in [lo, hi). */
export interface SpeedBucket {
    label: string;     // '5–10', '120+', …
    lo: number;        // lower bound (km/h, inclusive)
    hi: number | null; // upper bound (km/h, exclusive); null = open top bucket
    count: number;     // number of path legs in the bucket
}

/** Derived-speed distribution over the raw GPS path legs. */
export interface SpeedDistribution {
    buckets: SpeedBucket[];
    medianKmh: number;
    totalLegs: number;
}

// Histogram edges (km/h). The last edge opens an unbounded top bucket ('120+').
// Fine-grained at the low end (walking/cycling), coarser once on the road.
const SPEED_EDGES = [0, 2, 5, 10, 15, 25, 40, 60, 90, 120];

// Google Timeline has no native speed field, so we derive it from the raw path
// legs (haversine distance to the next point / its duration). Legs faster than
// this are GPS glitches — consumer travel tops out well below it and the tail
// reaches into the thousands of km/h — so we drop them as noise.
const SPEED_GLITCH_KMH = 400;

// Derived km/h of every moving leg, glitches excluded (shared by both queries).
const SPEED_LEGS_CTE = `
    legs AS (
        SELECT distance_meters / duration_seconds * 3.6 AS kmh
        FROM google_maps_segments
        WHERE segment_type = 'moving'
          AND distance_meters IS NOT NULL
          AND duration_seconds > 0
          AND distance_meters / duration_seconds * 3.6 <= ${SPEED_GLITCH_KMH}
    )
`;

/**
 * Distribution of derived travel speed across the raw GPS path legs. Speed for a
 * `timelinePath` leg = its haversine distance (`distance_meters`) over its
 * duration; visits and routed activities carry no leg distance and are excluded.
 * Legs are bucketed by km/h into {@link SPEED_EDGES}; clearly non-physical legs
 * (> {@link SPEED_GLITCH_KMH}) are dropped as GPS noise.
 */
export async function getSpeedDistribution(): Promise<SpeedDistribution | null> {
    const bucketCase = SPEED_EDGES.slice(1)
        .map((hi, i) => `WHEN kmh < ${hi} THEN ${i}`)
        .join(' ');
    const sql = `
        WITH ${SPEED_LEGS_CTE}
        SELECT
            CASE ${bucketCase} ELSE ${SPEED_EDGES.length - 1} END AS bucket,
            CAST(COUNT(*) AS BIGINT) AS count
        FROM legs
        GROUP BY bucket
        ORDER BY bucket
    `;
    const medianSql = `
        WITH ${SPEED_LEGS_CTE}
        SELECT median(kmh) AS medianKmh FROM legs
    `;

    try {
        const [rows, stats] = await Promise.all([
            query<{ bucket: number; count: number }>(sql),
            query<{ medianKmh: number }>(medianSql),
        ]);
        const counts = new Map(rows.map((r) => [Number(r.bucket), Number(r.count)]));
        const buckets: SpeedBucket[] = SPEED_EDGES.map((lo, i) => {
            const hi = i < SPEED_EDGES.length - 1 ? SPEED_EDGES[i + 1] : null;
            return {
                label: hi === null ? `${lo}+` : `${lo}–${hi}`,
                lo,
                hi,
                count: counts.get(i) ?? 0,
            };
        });
        return {
            buckets,
            medianKmh: Number(stats[0]?.medianKmh) || 0,
            totalLegs: buckets.reduce((sum, b) => sum + b.count, 0),
        };
    } catch (error) {
        console.error('Error fetching speed distribution:', error);
        return null;
    }
}

/** One row of the derived per-day mobility dataset (`google_maps_days`). */
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
            segment_count AS segmentCount
        FROM google_maps_days
        ORDER BY day ASC
    `;

    try {
        const result = await query<any>(sql);
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
        }));
    } catch (error) {
        console.error('Error fetching days dataset:', error);
        return [];
    }
}

/** Full time range of the constellation (loaded once, unfiltered). */
export async function getGoogleMapsConstellationTimeDomain(): Promise<ConstellationTimeDomain | null> {
    const sql = `
        SELECT
            CAST(epoch(MIN(timestamp)) * 1000 AS BIGINT) as minX,
            CAST(epoch(MAX(timestamp)) * 1000 AS BIGINT) as maxX
        FROM google_maps_segments
        WHERE timestamp IS NOT NULL
    `;

    try {
        const result = await query<any>(sql);
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
