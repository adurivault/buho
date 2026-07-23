import { queryColumnar, createTable, dropTable, insertData } from '../db';
import { computeDays, type DaySegment } from './daysDataset';

const DAYS_TABLE = 'google_maps_days';
const DAYS_SCHEMA = `
    day VARCHAR, start_place_id VARCHAR, start_semantic_type VARCHAR,
    start_lat DOUBLE, start_lon DOUBLE, start_city VARCHAR, start_country VARCHAR,
    start_place_km DOUBLE, start_fill VARCHAR,
    km_traveled DOUBLE, max_dist_from_start_km DOUBLE,
    distinct_places INTEGER, visit_count INTEGER,
    moving_minutes DOUBLE, stationary_minutes DOUBLE, segment_count INTEGER,
    departure_hour DOUBLE, return_hour DOUBLE, amplitude_hours DOUBLE, discovered_new BOOLEAN
`;

/**
 * Build (or rebuild) the `google_maps_days` table from `google_maps_segments`.
 * Run after `attributeZones` so the start place carries geo labels. Loads the
 * segments once (as epoch-ms, mirroring the other Google Maps queries), computes
 * the day rows in JS (see `daysDataset.ts`), and materialises them.
 */
export async function buildDays(): Promise<void> {
    // Columnar load (see queryColumnar): avoids the per-row toJSON + camelCase
    // churn of query() over ~140k segments — the whole set crosses as typed
    // column arrays and becomes DaySegment[] in a single allocation pass.
    const { numRows, columns } = await queryColumnar(`
        SELECT
            CAST(epoch(timestamp) * 1000 AS BIGINT) AS startMs,
            CAST(epoch(end_timestamp) * 1000 AS BIGINT) AS endMs,
            lat, lon,
            segment_type AS segmentType,
            COALESCE(place_id, '') AS placeId,
            COALESCE(semantic_type, '') AS semanticType,
            CAST(COALESCE(duration_seconds, 0) AS DOUBLE) AS durationSeconds,
            CAST(COALESCE(distance_meters, 0) AS DOUBLE) AS distanceMeters,
            COALESCE(nearest_city, 'Unknown') AS nearestCity,
            COALESCE(country, 'Unknown') AS country
        FROM google_maps_segments
        WHERE timestamp IS NOT NULL AND lat IS NOT NULL AND lon IS NOT NULL
        ORDER BY startMs ASC
    `);

    const startMs = columns.startMs, endMs = columns.endMs, lat = columns.lat, lon = columns.lon;
    const segmentType = columns.segmentType, placeId = columns.placeId, semanticType = columns.semanticType;
    const durationSeconds = columns.durationSeconds, distanceMeters = columns.distanceMeters;
    const nearestCity = columns.nearestCity, country = columns.country;

    const norm: DaySegment[] = new Array(numRows);
    for (let i = 0; i < numRows; i++) {
        norm[i] = {
            startMs: Number(startMs[i]),   // BIGINT → BigInt → Number
            endMs: Number(endMs[i]),
            lat: Number(lat[i]),
            lon: Number(lon[i]),
            segmentType: String(segmentType[i]),
            placeId: placeId[i] ? String(placeId[i]) : '',
            semanticType: semanticType[i] ? String(semanticType[i]) : '',
            durationSeconds: Number(durationSeconds[i]) || 0,
            distanceMeters: Number(distanceMeters[i]) || 0,
            nearestCity: nearestCity[i] ? String(nearestCity[i]) : 'Unknown',
            country: country[i] ? String(country[i]) : 'Unknown',
        };
    }

    const rows = computeDays(norm);

    await dropTable(DAYS_TABLE);
    await createTable(DAYS_TABLE, DAYS_SCHEMA);
    await insertData(DAYS_TABLE, rows);
}
