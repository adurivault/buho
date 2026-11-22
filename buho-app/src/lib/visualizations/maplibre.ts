import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';

/**
 * MapLibre and its stylesheet, ready to draw a map.
 *
 * MapLibre looks for its worker next to its own module file. Once Vite folds
 * the library into a hashed chunk, nothing sits there and the map stays blank.
 * Importing the worker with `?url` makes it a file of the build, served from
 * our origin (so `worker-src 'self'` admits it) and precached with the rest of
 * the code by the service worker.
 */
export async function loadMaplibre() {
    const [maplibre] = await Promise.all([
        import('maplibre-gl'),
        import('maplibre-gl/dist/maplibre-gl.css'),
    ]);
    maplibre.setWorkerUrl(workerUrl);
    return maplibre;
}
