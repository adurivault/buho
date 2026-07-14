/** A geographic point in decimal degrees. */
export interface LatLon {
    lat: number;
    lon: number;
}

/** Great-circle distance in meters between two lat/lon points. */
export function haversineMeters(a: LatLon, b: LatLon): number {
    const R = 6_371_000; // Earth radius (m)
    const toRad = (deg: number) => (deg * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLon = toRad(b.lon - a.lon);
    const lat1 = toRad(a.lat);
    const lat2 = toRad(b.lat);
    const h =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
