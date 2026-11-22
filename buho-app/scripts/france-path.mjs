/**
 * Derives a heavily simplified France outline for the landing-page mark.
 *
 * Source: buho-app/static/geo/geo_zones.topojson (the app's own zone geometry),
 * departments only, mainland bounding box, merged into one outline, projected
 * with the conic conformal projection France is normally drawn in, then reduced
 * with Douglas-Peucker until it is small enough to paste into a component.
 */
import fs from 'node:fs';
import { merge } from 'topojson-client';
import * as d3 from 'd3';

const BOX = 56;
const topo = JSON.parse(fs.readFileSync('static/geo/geo_zones.topojson', 'utf8'));

const departments = topo.objects.in.geometries.filter(
    (g) => g.properties?.country_code === 'FRA' && g.properties?.level === 'department'
);

const merged = merge(topo, departments);

// Mainland (plus Corsica): the overseas departments would otherwise set the
// bounds and shrink the hexagon to a speck.
const mainland = {
    type: 'MultiPolygon',
    coordinates: merged.coordinates.filter((polygon) => {
        const [lon, lat] = d3.geoCentroid({ type: 'Polygon', coordinates: polygon });
        return lon > -6 && lon < 10.5 && lat > 41 && lat < 52;
    }),
};

const projection = d3
    .geoConicConformal()
    .parallels([44, 49])
    .rotate([-3, 0])
    .fitSize([BOX, BOX], mainland);

/** Perpendicular distance from `p` to the segment ab. */
function deviation(p, a, b) {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    if (len === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
    return Math.abs(dy * p[0] - dx * p[1] + b[0] * a[1] - b[1] * a[0]) / len;
}

function douglasPeucker(points, tolerance) {
    if (points.length < 3) return points;
    let worst = 0;
    let at = 0;
    for (let i = 1; i < points.length - 1; i += 1) {
        const d = deviation(points[i], points[0], points[points.length - 1]);
        if (d > worst) {
            worst = d;
            at = i;
        }
    }
    if (worst <= tolerance) return [points[0], points[points.length - 1]];
    return [
        ...douglasPeucker(points.slice(0, at + 1), tolerance).slice(0, -1),
        ...douglasPeucker(points.slice(at), tolerance),
    ];
}

const rings = mainland.coordinates
    .map((polygon) => polygon[0].map((c) => projection(c)))
    .filter(Boolean);

function build(tolerance) {
    const kept = rings
        .map((ring) => douglasPeucker(ring, tolerance))
        .filter((ring) => {
            const xs = ring.map((p) => p[0]);
            const ys = ring.map((p) => p[1]);
            // Anything smaller than two units is a smudge at 36 pixels.
            return Math.max(...xs) - Math.min(...xs) > 2 && Math.max(...ys) - Math.min(...ys) > 2;
        })
        .sort((a, b) => b.length - a.length);

    const path = kept
        .map(
            (ring) =>
                'M' +
                ring
                    .slice(0, -1)
                    .map((p) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`)
                    .join(' L') +
                ' Z'
        )
        .join(' ');

    return { path, points: kept.reduce((n, r) => n + r.length - 1, 0), rings: kept.length };
}

/**
 * 0.9 is where the hexagon survives and the coastline noise does not: coarser
 * and Brittany starts losing its point, finer and it is hundreds of vertices
 * for detail nobody can see at 36 pixels.
 */
const { path, points, rings: count } = build(0.9);
console.error(`${points} points, ${count} rings, ${path.length} chars`);
console.log(path);
