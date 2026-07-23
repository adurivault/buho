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

/** Initial great-circle bearing a→b in degrees (0 = North, 90 = East, 0..360). */
export function bearingDegrees(a: LatLon, b: LatLon): number {
    const toRad = (deg: number) => (deg * Math.PI) / 180;
    const lat1 = toRad(a.lat);
    const lat2 = toRad(b.lat);
    const dLon = toRad(b.lon - a.lon);
    const y = Math.sin(dLon) * Math.cos(lat2);
    const x =
        Math.cos(lat1) * Math.sin(lat2) -
        Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
    return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}
