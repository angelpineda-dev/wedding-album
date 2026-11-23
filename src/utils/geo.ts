const EARTH_RADIUS_METERS = 6_371_008.8;

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

export interface Coordinates {
    latitude: number;
    longitude: number;
}

/** Great-circle distance in meters (haversine). Accurate to well under 0.5 % — plenty for a geofence. */
export function distanceMeters(a: Coordinates, b: Coordinates): number {
    const dLat = toRadians(b.latitude - a.latitude);
    const dLon = toRadians(b.longitude - a.longitude);
    const h = Math.sin(dLat / 2) ** 2
        + Math.cos(toRadians(a.latitude)) * Math.cos(toRadians(b.latitude)) * Math.sin(dLon / 2) ** 2;

    return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
}
